/**
 * Server function: search tradeable tokens on a chain (multi-chain swap desk).
 *
 * Runs server-side so the aggregator API key (ZEROX_API_KEY) never reaches the
 * browser — same rule as quote.server.ts. See token-search-impl.ts for the
 * lookup order (aggregator index → native asset → on-chain address resolve).
 */

import { createServerFn } from "@tanstack/react-start";
import type { TokenSearchResult } from "./types";
import { DEFAULT_CHAIN_ID, isSupportedChain } from "./chains";

export const searchChainTokens = createServerFn({ method: "GET" })
  .validator((d: { chainId?: number; q?: string }): { chainId: number; q: string } => {
    const chainId = typeof d.chainId === "number" && isSupportedChain(d.chainId) ? d.chainId : DEFAULT_CHAIN_ID;
    const q = typeof d.q === "string" ? d.q.trim().slice(0, 80) : "";
    return { chainId, q };
  })
  .handler(async ({ data }): Promise<TokenSearchResult> => {
    // F10: search is an upstream-quota surface too (0x Tokens index,
    // DexScreener's shared 300/min). Throttle per IP; fail-open.
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { clientIp, bumpLimit } = await import("../auth/rate-limit.server");
      const ip = clientIp(getRequest());
      if (await bumpLimit("rpcs", ip ?? "unknown", 60, 60)) {
        return { ok: false, error: "Search rate limit reached. Try again in a moment." };
      }
    } catch {
      /* fail-open: a store error must not break token search */
    }
    const { searchTokensImpl } = await import("./token-search-impl");
    return searchTokensImpl(data.chainId, data.q);
  });
