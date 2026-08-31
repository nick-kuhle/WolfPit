import { createServerFn } from "@tanstack/react-start";
import type { QuoteRequest, QuoteResult } from "./types";
import { DEFAULT_CHAIN_ID, isSupportedChain } from "./chains";

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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
      slippageBps:
        typeof d.slippageBps === "number" && Number.isFinite(d.slippageBps)
          ? Math.min(500, Math.max(1, Math.round(d.slippageBps)))
          : undefined,
      holdsWpit: Boolean(d.holdsWpit),
    };
  })
  .handler(async ({ data }): Promise<QuoteResult> => {
    const { fetchSpotQuote } = await import("./quote.server");
    return fetchSpotQuote(data);
  });
