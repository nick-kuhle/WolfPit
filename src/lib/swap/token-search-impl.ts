/**
 * Token search implementation (server-side only).
 *
 * Cascade per chain, so symbol/name search works with OR without the
 * aggregator key:
 *   1. 0x Tokens API index (best results; needs ZEROX_API_KEY),
 *   2. DexScreener public search (keyless, 300 req/min) filtered to the
 *      selected chain — matching base OR quote side of each pair, since
 *      stables/WETH usually appear as the quote — ranked by pool liquidity,
 *      with decimals filled by direct on-chain ERC-20 reads,
 *   3. CoinGecko public search + per-coin platform addresses (keyless) as the
 *      last resort when the pair index has nothing on this chain,
 *   4. contract-address paste → on-chain metadata resolve,
 *   plus the chain-native asset, always.
 * Results are cached 5 minutes per (chain, query).
 *
 * Called by the server fn in token-search.ts via dynamic import.
 */

import type { FoundToken, TokenSearchResult } from "./types";
import { chainById, nativeTokenOf, readErc20Meta } from "./chains";

const TOKENS_URL = "https://api.0x.org/tokens/v1";
const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex/search";
const CG_SEARCH_URL = "https://api.coingecko.com/api/v3/search";
const CG_COIN_URL = "https://api.coingecko.com/api/v3/coins";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** CoinGecko platform ids → our chain ids (variants included). */
const CG_PLATFORMS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  "arbitrum-one": 42161,
  "optimistic-ethereum": 10,
  "polygon-pos": 137,
  "binance-smart-chain": 56,
  avalanche: 43114,
  gnosis: 100,
  xdai: 100,
  celo: 42220,
  mantle: 5000,
  blast: 81457,
  linea: 59144,
  scroll: 534352,
  zksync: 324,
  unichain: 130,
  berachain: 80094,
};

type SearchSource = "aggregator" | "dexscreener" | "coingecko" | "fallback";
const searchCache = new Map<string, { at: number; hits: FoundToken[]; via: SearchSource }>();

/**
 * Curated launch tokens (address + decimals known offline, zero RPC). These
 * guarantee the headline tokens are always findable even when the pair index
 * returns nothing for the chain (common for quote-side tokens like USDC).
 */
const CURATED: Record<number, { address: string; symbol: string; name: string; decimals: number }[]> = {
  8453: [
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6 },
  ],
};

function curatedMatches(chainId: number, q: string): FoundToken[] {
  const ql = q.toLowerCase();
  return (CURATED[chainId] ?? [])
    .filter((t) => t.symbol.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql))
    .map((t) => ({ chainId, ...t }));
}

/** GET JSON with one retry on rate-limit / transient failure. */
async function getJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* retry once */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** DexScreener chain slugs for each supported chain id (variants included). */
const DS_SLUGS: Record<number, string[]> = {
  8453: ["base"],
  1: ["ethereum"],
  42161: ["arbitrum"],
  10: ["optimism"],
  137: ["polygon", "matic"],
  56: ["bsc", "binance-smart-chain"],
  43114: ["avalanche", "avax"],
  100: ["gnosis", "xdai"],
  42220: ["celo"],
  5000: ["mantle"],
  81457: ["blast"],
  59144: ["linea"],
  534352: ["scroll"],
  324: ["zksync", "zksync-era"],
  130: ["unichain"],
  80094: ["berachain", "bera"],
};

type ZeroXToken = {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  chainId?: number;
};

type DSToken = { address?: string; name?: string; symbol?: string };
type DSPair = {
  chainId?: string;
  baseToken?: DSToken;
  quoteToken?: DSToken;
  liquidity?: { usd?: number };
};

function matchesQuery(t: DSToken | undefined, q: string): boolean {
  if (!t?.address || !t.symbol) return false;
  const ql = q.toLowerCase();
  return t.symbol.toLowerCase().includes(ql) || (t.name ?? "").toLowerCase().includes(ql);
}

function apiKey(): string | undefined {
  const k = process.env.ZEROX_API_KEY;
  return k && k.trim() ? k.trim() : undefined;
}

async function aggregatorSearch(chainId: number, q: string): Promise<FoundToken[]> {
  const key = apiKey();
  if (!key) return [];
  try {
    const url = `${TOKENS_URL}?chainIds=${chainId}&search=${encodeURIComponent(q)}&limit=20`;
    const j = await getJson<{ data?: ZeroXToken[] } | ZeroXToken[]>(url, {
      "0x-api-key": key,
      "0x-version": "v2",
    });
    if (!j) return [];
    const rows = Array.isArray(j) ? j : (j.data ?? []);
    return rows
      .filter((t) => t.address && t.symbol && Number.isFinite(t.decimals) && (t.chainId ?? chainId) === chainId)
      .map((t) => ({
        chainId,
        address: t.address!,
        symbol: t.symbol!,
        name: t.name ?? t.symbol!,
        decimals: t.decimals!,
        // Indexed by 0x's curated token list — trustworthy enough to verify.
        verified: true,
      }));
  } catch {
    return [];
  }
}

/**
 * Keyless fallback: DexScreener pair search, filtered to the chain, deduped
 * by base token, ranked by best-pair liquidity. Decimals (DexScreener does
 * not return them) are filled with parallel on-chain reads; tokens whose
 * metadata cannot be read are dropped — a wrong decimals value would break
 * amount math, a missing token is just a shorter list.
 */
async function dexScreenerSearch(chainId: number, q: string): Promise<FoundToken[]> {
  const slugs = DS_SLUGS[chainId] ?? [];
  if (!slugs.length) return [];
  try {
    const j = await getJson<{ pairs?: DSPair[] }>(`${DEXSCREENER_URL}?q=${encodeURIComponent(q)}`, {
      Accept: "application/json",
    });
    if (!j) return [];
    const best = new Map<string, { address: string; symbol: string; name: string; liq: number }>();
    for (const p of j.pairs ?? []) {
      const slug = String(p.chainId ?? "").toLowerCase();
      if (!slugs.includes(slug)) continue;
      const liq = p.liquidity?.usd ?? 0;
      // The query can name either side of the pair (stables/WETH usually sit
      // on the quote side) — consider both tokens, matching on symbol/name.
      for (const t of [p.baseToken, p.quoteToken]) {
        if (!t?.address || !t.symbol || !matchesQuery(t, q)) continue;
        const key = t.address.toLowerCase();
        const prev = best.get(key);
        if (!prev || liq > prev.liq) {
          best.set(key, { address: t.address, symbol: t.symbol, name: t.name ?? t.symbol, liq });
        }
      }
    }
    const top = [...best.values()].sort((a, b) => b.liq - a.liq).slice(0, 8);
    const metas = await Promise.all(
      top.map(async (t): Promise<FoundToken | null> => {
        const meta = await readErc20Meta(chainId, t.address);
        return meta
          ? { chainId, address: t.address, symbol: t.symbol, name: t.name, decimals: meta.decimals, verified: false }
          : null;
      }),
    );
    return metas.filter((x): x is FoundToken => x !== null);
  } catch {
    return [];
  }
}

/** Symbol/name substring match (the same predicate the upstream uses). */
function tokenMatches(t: FoundToken, ql: string): boolean {
  return t.symbol.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql);
}

/**
 * Reuse cached results of a shorter PREFIX query. Typing sequences ("u",
 * "us", "usd", "usdc") produce overlapping upstream queries; a token matching
 * "usdc" also matches "usd", so filtering the cached prefix result set is
 * EXACT (not an approximation) for symbol/name-contains matching. Only fires
 * for queries of length >= 4 with a cached prefix of length >= 3.
 */
function cachedPrefix(chainId: number, q: string): { hits: FoundToken[]; via: SearchSource } | null {
  const ql = q.toLowerCase();
  const maxLen = Math.min(ql.length - 1, 32);
  for (let len = maxLen; len >= 3; len -= 1) {
    const c = searchCache.get(`${chainId}:${ql.slice(0, len)}`);
    if (!c || Date.now() - c.at >= CACHE_TTL_MS) continue;
    const filtered = c.hits.filter((t) => tokenMatches(t, ql));
    if (filtered.length) return { hits: filtered, via: c.via };
  }
  return null;
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
    out.push({ chainId, ...native, verified: true });
  }

  if (ADDRESS_RE.test(q)) {
    // Contract paste: aggregator index first, then direct on-chain metadata.
    const indexed = await aggregatorSearch(chainId, q);
    if (indexed.length) return { ok: true, tokens: indexed, source: "aggregator" };
    const meta = await readErc20Meta(chainId, q);
    if (meta) return { ok: true, tokens: [...out, { chainId, address: q, ...meta, verified: false }], source: "fallback" };
    return {
      ok: false,
      error: `Not an ERC-20 on ${chain.label} (or the RPC is unreachable). Check the address and chain.`,
    };
  }

  if (!q) return { ok: true, tokens: out, source: "aggregator" };

  // Curated headline tokens first (offline, no RPC, immune to rate limits).
  const curated = curatedMatches(chainId, q);
  for (const t of curated) out.push(t);
  let via: SearchSource = curated.length ? "fallback" : "aggregator";

  // Symbol/name search: aggregator index (keyed) → DexScreener (keyless) →
  // CoinGecko platforms (keyless). Cached per (chain, query) for 5 minutes.
  const cacheKey = `${chainId}:${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  let hits: FoundToken[] = [];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    hits = cached.hits;
    via = cached.via;
  } else {
    // Typing "usdc" fires "u", "us", "usd", "usdc" as separate queries; each
    // unique query hits upstream (0x Tokens / DexScreener / CoinGecko).
    // Substring matching means a longer query's results are a SUBSET of its
    // prefix's — reuse the cached prefix results filtered locally and only go
    // upstream when nothing matches locally (review fix F10).
    const prefixHit = cachedPrefix(chainId, q);
    if (prefixHit) {
      hits = prefixHit.hits;
      via = prefixHit.via;
    }
    if (!hits.length) {
      hits = await aggregatorSearch(chainId, q);
      if (hits.length) {
        via = "aggregator";
      } else {
        hits = await dexScreenerSearch(chainId, q);
        if (hits.length) {
          via = "dexscreener";
        } else {
          const cg = await coinGeckoSearch(chainId, q);
          if (cg.length) {
            via = "coingecko";
            hits = cg;
          }
        }
        // Thin pair-index results (quote-side tokens often miss the top-30
        // pair set)? Merge in CoinGecko platform hits, deduped by address.
        if (hits.length && hits.length < 3) {
          const cg = await coinGeckoSearch(chainId, q);
          const seen = new Set(hits.map((t) => t.address.toLowerCase()));
          for (const t of cg) {
            if (!seen.has(t.address.toLowerCase())) {
              hits.push(t);
              seen.add(t.address.toLowerCase());
            }
          }
        }
      }
    }
    if (searchCache.size > 300) searchCache.clear();
    searchCache.set(cacheKey, { at: Date.now(), hits, via });
  }
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
  return { ok: true, tokens: out.slice(0, 20), source: via };
}

/**
 * Keyless last resort: CoinGecko search → per-coin platform addresses on the
 * selected chain → on-chain decimals. Only reached when both aggregator and
 * pair-index searches came up empty for this chain.
 */
async function coinGeckoSearch(chainId: number, q: string): Promise<FoundToken[]> {
  try {
    const j = await getJson<{ coins?: { id?: string; symbol?: string; name?: string }[] }>(
      `${CG_SEARCH_URL}?query=${encodeURIComponent(q)}`,
      { Accept: "application/json" },
    );
    if (!j) return [];
    const coins = (j.coins ?? []).filter((c) => c.id && c.symbol).slice(0, 5);
    const found: { symbol: string; name: string; address: string }[] = [];
    const details = await Promise.all(
      coins.map(async (c) => {
        const d = await getJson<{ platforms?: Record<string, string> }>(`${CG_COIN_URL}/${c.id}`, {
          Accept: "application/json",
        });
        return d?.platforms ?? null;
      }),
    );
    const seen = new Set<string>();
    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i]!;
      const platforms = details[i];
      if (!platforms) continue;
      for (const [platform, addr] of Object.entries(platforms)) {
        if (CG_PLATFORMS[platform] !== chainId || !ADDRESS_RE.test(addr)) continue;
        const key = addr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ symbol: coin.symbol!, name: coin.name ?? coin.symbol!, address: addr });
        break; // one address per coin is enough
      }
    }
    if (!found.length) return [];
    // Fill real decimals on-chain (a wrong guess would corrupt amount math).
    const metas = await Promise.all(
      found.map(async (t): Promise<FoundToken | null> => {
        const meta = await readErc20Meta(chainId, t.address);
        return meta ? { ...t, chainId, decimals: meta.decimals, verified: false } : null;
      }),
    );
    return metas.filter((x): x is FoundToken => x !== null);
  } catch {
    return [];
  }
}
