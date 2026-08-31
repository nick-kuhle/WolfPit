import { createServerFn } from "@tanstack/react-start";
import type { QuoteRequest, QuoteResult } from "./types";
import { DEFAULT_CHAIN_ID, isSupportedChain } from "./chains";
import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS } from "./config";

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Per-IP throttle for the aggregator proxy server fns. The 0x API key is a
 * paid, rate-limited quota and DexScreener's keyless fallback is a SHARED
 * public limit (300 req/min across all consumers) — an unthrottled endpoint
 * could be hammered into exhausting either, breaking swaps app-wide
 * (review fix F10). Counters live in the same DB table as the auth throttles
 * (shared across instances). FAIL-OPEN on store errors: a DB hiccup must not
 * take down live swaps — the cost of a missed throttle is quota spend, not
 * account compromise.
 */
async function throttled(ip: string | undefined, kind: "rpcq" | "rpcs"): Promise<boolean> {
  const { bumpLimit } = await import("../auth/rate-limit.server");
  return bumpLimit(kind, ip ?? "unknown", kind === "rpcq" ? 120 : 60, 60);
}

/** Caller IP from the server-function request (cf-connecting-ip first). */
async function callerIpOf(): Promise<string | undefined> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { clientIp } = await import("../auth/rate-limit.server");
    return clientIp(getRequest());
  } catch {
    return undefined;
  }
}

/**
 * Server function: get a DEX-aggregator quote for a spot swap (any supported
 * chain). The aggregator API key stays server-side (see quote.server.ts).
 * Indicative pricing omits `taker`; a firm executable quote requires the
 * connected wallet address in `taker`.
 */
export const spotQuote = createServerFn({ method: "POST" })
  .validator((d: QuoteRequest): QuoteRequest => {
    return {
      chainId: typeof d.chainId === "number" && isSupportedChain(d.chainId) ? d.chainId : DEFAULT_CHAIN_ID,
      sellToken: clean(d.sellToken),
      buyToken: clean(d.buyToken),
      sellAmount: clean(d.sellAmount),
      taker: d.taker ? clean(d.taker) : undefined,
      // Same bounds the UI clamps to (config.SLIPPAGE_MIN/MAX_BPS): the
      // tolerance a user sees is the tolerance that executes (review fix F2).
      slippageBps:
        typeof d.slippageBps === "number" && Number.isFinite(d.slippageBps)
          ? Math.min(SLIPPAGE_MAX_BPS, Math.max(SLIPPAGE_MIN_BPS, Math.round(d.slippageBps)))
          : undefined,
      holdsWpit: Boolean(d.holdsWpit),
    };
  })
  .handler(async ({ data }): Promise<QuoteResult> => {
    if (await throttled(await callerIpOf(), "rpcq")) {
      return { ok: false, error: "Too many quote requests. Wait a moment and try again." };
    }
    const { fetchSpotQuote } = await import("./quote.server");
    return fetchSpotQuote(data);
  });
