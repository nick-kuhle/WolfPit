/**
 * Chart feed resolution for the LIVE swap desk.
 *
 * The bug this module exists to kill
 * ---------------------------------
 * `loadSymbolCandles()` (src/lib/wolfpit/market.ts) can only reach a real feed
 * when it is told HOW to reach it: a CEX pair from its symbol maps, a CoinGecko
 * id, or a `network` + `poolAddress` for on-chain tokens. The simulation desk
 * passes all four (desk.tsx) because its `Listing` rows come from the
 * GeckoTerminal tape / DexScreener search and already carry the pool. The live
 * swap chart passed ONLY the symbol, so every long-tail token — anything that
 * is not one of the ~30 CEX-listed majors — resolved to zero candles and the
 * chart silently fell back to a synthetic series anchored at 1.00.
 *
 * Measured against the live APIs on 2026-08-31 (Basecat, Base 8453,
 * 0xB2000000000000000000004c27f6523082f41D01):
 *   loadSymbolCandles({ symbol: "Basecat" })                        →   0 bars
 *   loadSymbolCandles({ symbol: "Basecat", network, poolAddress })  → 200 bars
 *
 * So the live desk was not "failing to load" — it was drawing a fabricated
 * random walk around 1.00 with a "sim · indicative" badge on it. That is what
 * the screenshot shows.
 *
 * What this module does
 * ---------------------
 *  • Maps a swap chainId to the GeckoTerminal / DexScreener network slug.
 *  • Resolves a token CONTRACT to its deepest real pool, so any token the
 *    aggregator can route is also a token we can chart.
 *  • Picks which leg of the pair is the subject of the chart.
 *
 * Every price series it points at is quoted in USD (GeckoTerminal OHLCV
 * defaults to the base token's USD price), which is what the simulation desk
 * charts too — the two surfaces now show the same series for the same token.
 */

import { CHAINS, hasSymbolFeed } from "@/lib/wolfpit/market";
import type { SpotToken } from "./config";

/** Stablecoins we price *against* rather than chart. */
/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDBC",
  "USDT",
  "DAI",
  "USD",
  "USDS",
  "FDUSD",
  "USDE",
  "PYUSD",
  "LUSD",
  "TUSD",
  "USDC.E",
  "EURC",
]);

/**
 * Majors: real feeds exist for these, but when they are paired against a
 * long-tail token the long-tail token is the interesting one to chart.
 */
const MAJOR_SYMBOLS = new Set([
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
  "CBBTC",
  "BNB",
  "WBNB",
  "POL",
  "MATIC",
  "AVAX",
  "WAVAX",
  "CELO",
  "MNT",
  "BERA",
  "XDAI",
]);

export function isStableSymbol(symbol: string): boolean {
  return STABLE_SYMBOLS.has(symbol.trim().toUpperCase());
}

export function isMajorSymbol(symbol: string): boolean {
  return MAJOR_SYMBOLS.has(symbol.trim().toUpperCase());
}

/**
 * Chart-worthiness rank. Higher wins:
 *   2 — a long-tail token (the thing the user is actually taking a view on)
 *   1 — a major / native asset
 *   0 — a stablecoin (that is the unit, not the subject)
 */
export function subjectRank(token: { symbol: string }): 0 | 1 | 2 {
  if (isStableSymbol(token.symbol)) return 0;
  if (isMajorSymbol(token.symbol)) return 1;
  return 2;
}

/**
 * Which leg to chart. Ties go to the SELL leg so the choice is stable while
 * the user is still picking the buy side.
 *
 * ETH → Basecat  ⇒ Basecat (rank 2 beats 1) — the screenshot's pair.
 * USDC → ETH     ⇒ ETH
 * ETH → USDC     ⇒ ETH
 * USDC → USDT    ⇒ USDC (tie at 0 → sell leg)
 */
export function pickSubject<T extends { symbol: string }>(sell: T, buy: T): { subject: T; quote: T } {
  return subjectRank(buy) > subjectRank(sell) ? { subject: buy, quote: sell } : { subject: sell, quote: buy };
}

/** 0x sentinel for the chain-native asset. */
/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export function isNativeAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  return a === NATIVE_SENTINEL || a === "0x0000000000000000000000000000000000000000";
}

/**
 * chainId → GeckoTerminal network slug. Only slugs that exist in
 * `CHAINS` (market.ts) are usable: `loadSymbolCandles` rejects anything else
 * via `safeNetwork()`, so an unknown slug would silently disable the feed.
 */
const GT_NETWORK: Record<number, string> = {
  1: "eth",
  10: "optimism",
  56: "bsc",
  100: "gnosis",
  130: "unichain",
  137: "polygon_pos",
  324: "zksync",
  5000: "mantle",
  8453: "base",
  42161: "arbitrum",
  42220: "celo",
  43114: "avax",
  59144: "linea",
  80094: "berachain",
  81457: "blast",
  534352: "scroll",
};

const KNOWN_NETWORKS = new Set(CHAINS.map((c) => c.id));

export function gtNetwork(chainId: number): string {
  const slug = GT_NETWORK[chainId];
  return slug && KNOWN_NETWORKS.has(slug) ? slug : "";
}

/** chainId → DexScreener chain slug (its own naming, not GeckoTerminal's). */
const DS_CHAIN: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  100: "gnosischain",
  130: "unichain",
  137: "polygon",
  324: "zksync",
  5000: "mantle",
  8453: "base",
  42161: "arbitrum",
  42220: "celo",
  43114: "avalanche",
  59144: "linea",
  80094: "berachain",
  81457: "blast",
  534352: "scroll",
};

export function dsChain(chainId: number): string {
  return DS_CHAIN[chainId] ?? "";
}

/**
 * CoinGecko ids for native assets that have no CEX pair in market.ts's maps,
 * so a native-asset chart still has a real series on those chains.
 */
const NATIVE_GECKO_ID: Record<string, string> = {
  ETH: "ethereum",
  BNB: "binancecoin",
  POL: "matic-network",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  CELO: "celo",
  MNT: "mantle",
  BERA: "berachain-bera",
  XDAI: "xdai",
};

export type TokenFeed = {
  /** GeckoTerminal network slug, when the series is an on-chain pool. */
  network?: string;
  /** Pool the OHLCV is read from (base token = the token we asked about). */
  poolAddress?: string;
  /** CoinGecko id, for natives/majors without a pool lookup. */
  geckoId?: string;
  /** Spot USD price from the resolver — used to anchor a fallback series. */
  priceUsd?: number;
  source: "symbol" | "geckoterminal" | "dexscreener" | "none";
};

type Fetcher = typeof fetch;

type GtPool = {
  attributes?: {
    address?: string;
    name?: string;
    base_token_price_usd?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
  };
};

/**
 * Pick the pool to chart: the token must be the pool's BASE token (GeckoTerminal
 * OHLCV reports the base token's price — charting a pool where our token is the
 * quote side would draw the OTHER token's price, which is exactly the class of
 * bug this module exists to prevent). Among those, deepest 24h volume wins, with
 * reserves as the tiebreak.
 */
export function pickPool(pools: GtPool[], network: string, address: string): { poolAddress: string; priceUsd: number } | null {
  const want = `${network}_${address.trim().toLowerCase()}`;
  let best: { poolAddress: string; priceUsd: number; vol: number; res: number } | null = null;
  for (const p of pools) {
    const a = p.attributes ?? {};
    const pool = (a.address ?? "").trim();
    if (!pool) continue;
    if ((p.relationships?.base_token?.data?.id ?? "").toLowerCase() !== want) continue;
    const vol = Number(a.volume_usd?.h24 ?? 0) || 0;
    const res = Number(a.reserve_in_usd ?? 0) || 0;
    const priceUsd = Number(a.base_token_price_usd ?? 0) || 0;
    if (!best || vol > best.vol || (vol === best.vol && res > best.res)) {
      best = { poolAddress: pool, priceUsd, vol, res };
    }
  }
  return best ? { poolAddress: best.poolAddress, priceUsd: best.priceUsd } : null;
}

type DsPair = {
  chainId?: string;
  pairAddress?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  baseToken?: { address?: string };
};

/** DexScreener fallback: same rule — our token must be the pair's base token. */
export function pickDexPair(pairs: DsPair[], chain: string, address: string): { poolAddress: string; priceUsd: number } | null {
  const want = address.trim().toLowerCase();
  let best: { poolAddress: string; priceUsd: number; liq: number } | null = null;
  for (const p of pairs) {
    if (chain && (p.chainId ?? "").toLowerCase() !== chain) continue;
    if ((p.baseToken?.address ?? "").toLowerCase() !== want) continue;
    const pool = (p.pairAddress ?? "").trim();
    if (!pool) continue;
    const liq = Number(p.liquidity?.usd ?? 0) || 0;
    if (!best || liq > best.liq) best = { poolAddress: pool, priceUsd: Number(p.priceUsd ?? 0) || 0, liq };
  }
  return best ? { poolAddress: best.poolAddress, priceUsd: best.priceUsd } : null;
}

const NO_FEED: TokenFeed = { source: "none" };

const feedCache = new Map<string, { at: number; feed: TokenFeed }>();
const feedJobs = new Map<string, Promise<TokenFeed>>();
/** Pools change slowly; a 10-minute memo keeps the public APIs happy. */
const FEED_TTL_MS = 10 * 60_000;

/**
 * Resolve how to chart a swap token.
 *
 * Order: known CEX symbol (majors, no network call) → GeckoTerminal pools for
 * the contract → DexScreener pairs. A miss returns `{ source: "none" }` and the
 * caller draws a clearly-badged indicative series; it must never pretend.
 */
export function resolveTokenFeed(
  t: { chainId: number; address: string; symbol: string; native?: boolean },
  fetchImpl: Fetcher = fetch,
): Promise<TokenFeed> {
  const symbol = t.symbol.trim().toUpperCase();
  const address = t.address.trim();

  // Majors: market.ts already knows a Coinbase/Binance pair for these.
  if (hasSymbolFeed(symbol)) {
    return Promise.resolve({ source: "symbol", geckoId: NATIVE_GECKO_ID[symbol] });
  }
  // Native asset with no CEX pair (e.g. BERA/MNT): CoinGecko id or nothing.
  if (t.native || isNativeAddress(address)) {
    const geckoId = NATIVE_GECKO_ID[symbol];
    return Promise.resolve(geckoId ? { source: "symbol", geckoId } : NO_FEED);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Promise.resolve(NO_FEED);

  const key = `${t.chainId}:${address.toLowerCase()}`;
  const hit = feedCache.get(key);
  if (hit && Date.now() - hit.at < FEED_TTL_MS) return Promise.resolve(hit.feed);
  const inflight = feedJobs.get(key);
  if (inflight) return inflight;

  const job = lookup(t.chainId, address, fetchImpl)
    .then((feed) => {
      feedCache.set(key, { at: Date.now(), feed });
      return feed;
    })
    .catch(() => NO_FEED)
    .finally(() => {
      feedJobs.delete(key);
    });
  feedJobs.set(key, job);
  return job;
}

async function lookup(chainId: number, address: string, fetchImpl: Fetcher): Promise<TokenFeed> {
  const network = gtNetwork(chainId);
  if (network) {
    try {
      const res = await fetchImpl(
        `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address}/pools`,
        { headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const j = (await res.json()) as { data?: GtPool[] };
        const best = pickPool(j.data ?? [], network, address);
        if (best) {
          return { network, poolAddress: best.poolAddress, priceUsd: best.priceUsd, source: "geckoterminal" };
        }
      }
    } catch {
      /* fall through to DexScreener */
    }
  }

  const chain = dsChain(chainId);
  try {
    const res = await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const j = (await res.json()) as { pairs?: DsPair[] };
      const best = pickDexPair(j.pairs ?? [], chain, address);
      // DexScreener pool ids are chartable through GeckoTerminal only when we
      // also know the GeckoTerminal slug for the chain.
      if (best && network) {
        return { network, poolAddress: best.poolAddress, priceUsd: best.priceUsd, source: "dexscreener" };
      }
      if (best) return { priceUsd: best.priceUsd, source: "dexscreener" };
    }
  } catch {
    /* no feed */
  }
  return NO_FEED;
}

/** Convenience wrapper used by the chart: token → args for loadSymbolCandles. */
export function candleArgsFor(token: SpotToken, feed: TokenFeed) {
  return {
    symbol: token.symbol,
    geckoId: feed.geckoId,
    network: feed.network,
    poolAddress: feed.poolAddress,
  };
}
