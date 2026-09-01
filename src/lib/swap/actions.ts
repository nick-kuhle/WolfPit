import { createServerFn } from "@tanstack/react-start";
import type { QuoteRequest, QuoteResult } from "./types";
import { DEFAULT_CHAIN_ID, isSupportedChain } from "./chains";
import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS } from "./config";

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * WP-10 / #14: the validator used to pass `sellToken`, `buyToken` and `taker`
 * straight through as trimmed strings. They are forwarded to a PAID, billed
 * aggregator endpoint (and `taker` is used as an on-chain `balanceOf` argument),
 * so garbage must be rejected here rather than spending quota on a request that
 * cannot succeed — and a malformed `taker` must never reach an RPC call.
 */
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function cleanAddress(v: unknown): string {
  const s = clean(v);
  return EVM_ADDRESS.test(s) ? s : "";
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
      sellToken: cleanAddress(d.sellToken),
      buyToken: cleanAddress(d.buyToken),
      sellAmount: clean(d.sellAmount),
      taker: d.taker ? cleanAddress(d.taker) || undefined : undefined,
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
    // WP-10 / #14: validate BEFORE the throttle counter and before any upstream
    // 0x call — a malformed request must cost nothing, billed or otherwise.
    if (!data.sellToken || !data.buyToken) {
      return { ok: false, error: "Both tokens must be valid contract addresses." };
    }
    if (!/^\d+$/.test(data.sellAmount) || /^0+$/.test(data.sellAmount)) {
      return { ok: false, error: "Amount must be a positive integer in token base units." };
    }
    /*
     * WP-07 / #13: server-side pause/geo enforcement. A `taker` turns this into
     * a FIRM executable quote, i.e. the last step before an order, so the gate
     * belongs here and not only in the client store. Enforced from shared
     * server state, so flipping pause stops every session at once and no
     * localStorage edit can lift the geo-fence. Fails closed on store errors:
     * an operator who pauses the book must not get "store down, allowed".
     */
    const { checkTradingAllowed } = await import("../admin/policy.server");
    const gate = await checkTradingAllowed({ products: ["spot"] });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (await throttled(await callerIpOf(), "rpcq")) {
      return { ok: false, error: "Too many quote requests. Wait a moment and try again." };
    }
    const { fetchSpotQuote } = await import("./quote.server");
    return fetchSpotQuote(data);
  });
