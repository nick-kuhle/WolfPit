/**
 * Token search implementation (server-side only — talks to the aggregator).
 * Called by the server fn in token-search.ts via dynamic import.
 */

import type { FoundToken, TokenSearchResult } from "./types";
import { chainById, nativeTokenOf, readErc20Meta } from "./chains";

const TOKENS_URL = "https://api.0x.org/tokens/v1";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type ZeroXToken = {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  chainId?: number;
};

function apiKey(): string | undefined {
  const k = process.env.ZEROX_API_KEY;
  return k && k.trim() ? k.trim() : undefined;
}

async function aggregatorSearch(chainId: number, q: string): Promise<FoundToken[]> {
  const key = apiKey();
  if (!key) return [];
  try {
    const url = `${TOKENS_URL}?chainIds=${chainId}&search=${encodeURIComponent(q)}&limit=20`;
    const res = await fetch(url, { headers: { "0x-api-key": key, "0x-version": "v2" } });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: ZeroXToken[] } | ZeroXToken[];
    const rows = Array.isArray(j) ? j : (j.data ?? []);
    return rows
      .filter((t) => t.address && t.symbol && Number.isFinite(t.decimals) && (t.chainId ?? chainId) === chainId)
      .map((t) => ({
        chainId,
        address: t.address!,
        symbol: t.symbol!,
        name: t.name ?? t.symbol!,
        decimals: t.decimals!,
      }));
  } catch {
    return [];
  }
}

export async function searchTokensImpl(chainId: number, qRaw: string): Promise<TokenSearchResult> {
  const chain = chainById(chainId);
  if (!chain) return { ok: false, error: `Unsupported chain (${chainId}).` };
  const q = qRaw.trim();
  const native = nativeTokenOf(chainId)!;
  const out: FoundToken[] = [];

  // Native asset always matches its own symbol/name (and is always offered).
  if (
    !q ||
    native.symbol.toLowerCase().includes(q.toLowerCase()) ||
    native.name.toLowerCase().includes(q.toLowerCase())
  ) {
    out.push({ chainId, ...native });
  }

  if (ADDRESS_RE.test(q)) {
    // Contract paste: aggregator index first, then direct on-chain metadata.
    const indexed = await aggregatorSearch(chainId, q);
    if (indexed.length) return { ok: true, tokens: indexed, source: "aggregator" };
    const meta = await readErc20Meta(chainId, q);
    if (meta) return { ok: true, tokens: [...out, { chainId, address: q, ...meta }], source: "fallback" };
    return {
      ok: false,
      error: `Not an ERC-20 on ${chain.label} (or the RPC is unreachable). Check the address and chain.`,
    };
  }

  if (!q) return { ok: true, tokens: out, source: "aggregator" };

  const hits = await aggregatorSearch(chainId, q);
  const seen = new Set(out.map((t) => t.address.toLowerCase()));
  for (const t of hits) {
    if (!seen.has(t.address.toLowerCase())) {
      out.push(t);
      seen.add(t.address.toLowerCase());
    }
  }
  if (!out.length) {
    return { ok: false, error: "No tokens matched — try a symbol, name, or paste a contract address." };
  }
  return { ok: true, tokens: out.slice(0, 20), source: hits.length ? "aggregator" : "fallback" };
}
