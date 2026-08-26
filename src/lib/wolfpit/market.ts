import { createServerFn } from "@tanstack/react-start";
import type { Candle } from "./types";
import type { Listing } from "./desk";

export type ChartInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export type LiveFeed = {
  eth: number;
  ethBid: number;
  ethAsk: number;
  btc: number;
  candles: Candle[];
  at: number;
  source: string;
  interval: ChartInterval;
};

const GRAN: Record<ChartInterval, { coinbase: number; binance: string }> = {
  "1m": { coinbase: 60, binance: "1m" },
  "5m": { coinbase: 300, binance: "5m" },
  "15m": { coinbase: 900, binance: "15m" },
  "1h": { coinbase: 3600, binance: "1h" },
  "1d": { coinbase: 86400, binance: "1d" },
};

export const getLiveMarket = createServerFn({ method: "GET" })
  .validator((d: { interval?: ChartInterval } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<LiveFeed> => {
    const interval: ChartInterval = data.interval ?? "1m";
    const cob = await coinbase(interval);
    if (cob) return cob;
    const bin = await binance(interval);
    if (bin) return bin;
    const cg = await coingecko();
    if (cg) return cg;
    throw new Error("All public price feeds failed.");
  });

async function coinbase(interval: ChartInterval): Promise<LiveFeed | null> {
  try {
    const g = GRAN[interval].coinbase;
    const [candlesRes, tickRes, btcRes] = await Promise.all([
      fetch(`https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=${g}`, {
        headers: { Accept: "application/json" },
      }),
      fetch("https://api.exchange.coinbase.com/products/ETH-USD/ticker", { headers: { Accept: "application/json" } }),
      fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { headers: { Accept: "application/json" } }),
    ]);
    if (!candlesRes.ok || !tickRes.ok) return null;
    const raw = (await candlesRes.json()) as number[][];
    const tick = (await tickRes.json()) as { price: string; bid?: string; ask?: string };
    const btc = btcRes.ok ? ((await btcRes.json()) as { price: string }) : { price: "0" };
    const candles = raw
      .map((r) => ({
        t: r[0]! * 1000,
        l: r[1]!,
        h: r[2]!,
        o: r[3]!,
        c: r[4]!,
        v: r[5]!,
      }))
      .sort((a, b) => a.t - b.t);
    const eth = Number(tick.price) || candles.at(-1)?.c || 0;
    if (!eth || candles.length < 10) return null;
    const ethBid = Number(tick.bid) || eth;
    const ethAsk = Number(tick.ask) || eth;
    return { eth, ethBid, ethAsk, btc: Number(btc.price) || 0, candles, at: Date.now(), source: "Coinbase", interval };
  } catch {
    return null;
  }
}

async function binance(interval: ChartInterval): Promise<LiveFeed | null> {
  try {
    const iv = GRAN[interval].binance;
    const [k, t, b, book] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=${iv}&limit=300`),
      fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT"),
      fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
      fetch("https://api.binance.com/api/v3/ticker/bookTicker?symbol=ETHUSDT"),
    ]);
    if (!k.ok || !t.ok) return null;
    const raw = (await k.json()) as (string | number)[][];
    const tick = (await t.json()) as { price: string };
    const btc = b.ok ? ((await b.json()) as { price: string }) : { price: "0" };
    const candles: Candle[] = raw.map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
    }));
    const eth = Number(tick.price) || candles.at(-1)?.c || 0;
    if (!eth) return null;
    let ethBid = eth;
    let ethAsk = eth;
    if (book.ok) {
      const bk = (await book.json()) as { bidPrice?: string; askPrice?: string };
      ethBid = Number(bk.bidPrice) || eth;
      ethAsk = Number(bk.askPrice) || eth;
    }
    return { eth, ethBid, ethAsk, btc: Number(btc.price) || 0, candles, at: Date.now(), source: "Binance", interval };
  } catch {
    return null;
  }
}

async function coingecko(): Promise<LiveFeed | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd",
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { ethereum?: { usd: number }; bitcoin?: { usd: number } };
    const eth = j.ethereum?.usd ?? 0;
    if (!eth) return null;
    const now = Date.now();
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
      t: now - (59 - i) * 60_000,
      o: eth,
      h: eth,
      l: eth,
      c: eth,
      v: 0,
    }));
    return { eth, ethBid: eth, ethAsk: eth, btc: j.bitcoin?.usd ?? 0, candles, at: now, source: "CoinGecko", interval: "1m" };
  } catch {
    return null;
  }
}

const COINBASE_MAP: Record<string, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  DOGE: "DOGE-USD",
  ADA: "ADA-USD",
  AVAX: "AVAX-USD",
  LINK: "LINK-USD",
  SUI: "SUI-USD",
  DOT: "DOT-USD",
  NEAR: "NEAR-USD",
  APT: "APT-USD",
  UNI: "UNI-USD",
  AAVE: "AAVE-USD",
  LTC: "LTC-USD",
  SHIB: "SHIB-USD",
  ATOM: "ATOM-USD",
  FIL: "FIL-USD",
  BCH: "BCH-USD",
  PEPE: "PEPE-USD",
};

const BINANCE_MAP: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
  BNB: "BNBUSDT",
  DOGE: "DOGEUSDT",
  ADA: "ADAUSDT",
  AVAX: "AVAXUSDT",
  LINK: "LINKUSDT",
  SUI: "SUIUSDT",
  PEPE: "PEPEUSDT",
  TON: "TONUSDT",
  DOT: "DOTUSDT",
  NEAR: "NEARUSDT",
  APT: "APTUSDT",
  ARB: "ARBUSDT",
  OP: "OPUSDT",
  UNI: "UNIUSDT",
  AAVE: "AAVEUSDT",
  LTC: "LTCUSDT",
  TRX: "TRXUSDT",
  SHIB: "SHIBUSDT",
  WLD: "WLDUSDT",
  INJ: "INJUSDT",
  TIA: "TIAUSDT",
  FET: "FETUSDT",
  ATOM: "ATOMUSDT",
  FIL: "FILUSDT",
  HYPE: "HYPEUSDT",
  WIF: "WIFUSDT",
};

const CHAIN_HINT: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Base / Ethereum",
  SOL: "Solana",
  BNB: "BNB Chain",
  AVAX: "Avalanche",
  SUI: "Sui",
  TON: "TON",
  TRX: "Tron",
  ARB: "Arbitrum",
  OP: "Optimism",
  DOT: "Polkadot",
  NEAR: "NEAR",
  APT: "Aptos",
  ATOM: "Cosmos",
};

export const CHAINS: { id: string; label: string }[] = [
  { id: "eth", label: "Ethereum" },
  { id: "bsc", label: "BNB" },
  { id: "base", label: "Base" },
  { id: "solana", label: "Solana" },
  { id: "arbitrum", label: "Arbitrum" },
  { id: "optimism", label: "Optimism" },
  { id: "polygon_pos", label: "Polygon" },
  { id: "avax", label: "Avalanche" },
  { id: "fantom", label: "Fantom" },
  { id: "cronos", label: "Cronos" },
  { id: "blast", label: "Blast" },
  { id: "linea", label: "Linea" },
  { id: "scroll", label: "Scroll" },
  { id: "zksync", label: "zkSync" },
  { id: "mantle", label: "Mantle" },
  { id: "sui-network", label: "Sui" },
  { id: "ton", label: "TON" },
  { id: "aptos", label: "Aptos" },
  { id: "hyperliquid", label: "Hyperliquid" },
  { id: "sonic", label: "Sonic" },
  { id: "berachain", label: "Berachain" },
  { id: "unichain", label: "Unichain" },
  { id: "world-chain", label: "World" },
  { id: "celo", label: "Celo" },
  { id: "gnosis", label: "Gnosis" },
  { id: "mode", label: "Mode" },
];

export const getChainTape = createServerFn({ method: "GET" })
  .validator((d: { network: string }) => d)
  .handler(async ({ data }): Promise<Listing[]> => geckoTerminalTape(data.network));

export const getUniverse = createServerFn({ method: "GET" }).handler(async (): Promise<Listing[]> => {
  const cg = await geckoMarkets();
  if (cg.length) return cg;
  return binanceTickers();
});


export const searchTokens = createServerFn({ method: "GET" })
  .validator((d: { q: string }) => d)
  .handler(async ({ data }): Promise<Listing[]> => {
    const q = data.q.trim();
    if (!q) return [];
    if (/^wpit$/i.test(q) || /^wolf/i.test(q)) {
      return [
        {
          symbol: "WPIT",
          name: "WolfPit",
          price: 0,
          change24: 0,
          volume24: 0,
          chain: "Base",
        },
      ];
    }
    const dex = await dexSearch(q);
    if (dex.length) return dex;
    const g = await geckoSearch(q);
    return g ? [g] : [];
  });

export const lookupToken = createServerFn({ method: "GET" })
  .validator((d: { q: string }) => d)
  .handler(async ({ data }): Promise<Listing> => {
    const q = data.q.trim();
    if (/^wpit$/i.test(q) || /^wolfpit$/i.test(q)) {
      return {
        symbol: "WPIT",
        name: "WolfPit",
        price: 0,
        change24: 0,
        volume24: 0,
        chain: "Base",
      };
    }
    if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
      const dex = await dexToken(q);
      if (dex) return dex;
    }
    const hits = await dexSearch(q);
    if (hits[0]) return hits[0];
    const search = await geckoSearch(q);
    if (search) return search;
    throw new Error("Token not found.");
  });

export const getSymbolCandles = createServerFn({ method: "GET" })
  .validator((d: { symbol: string; interval?: ChartInterval; binance?: string; geckoId?: string; network?: string; poolAddress?: string }) => d)
  .handler(async ({ data }): Promise<Candle[]> => {
    const interval: ChartInterval = data.interval ?? "1m";
    const sym = data.symbol.toUpperCase();
    const cb = COINBASE_MAP[sym];
    if (cb) {
      const bars = await coinbaseKlines(cb, interval);
      if (bars.length) return bars;
    }
    const pair = data.binance || BINANCE_MAP[sym];
    if (pair) {
      const bars = await binanceKlines(pair, interval);
      if (bars.length) return bars;
    }
    if (data.geckoId) {
      const bars = await geckoOhlc(data.geckoId, interval);
      if (bars.length) return bars;
    }
    if (data.network && data.poolAddress) {
      const bars = await geckoTerminalOhlcv(data.network, data.poolAddress, interval);
      if (bars.length) return bars;
    }
    return [];
  });

const candleJobs = new Map<string, Promise<Candle[]>>();

export function loadSymbolCandles(d: {
  symbol: string;
  interval?: ChartInterval;
  binance?: string;
  geckoId?: string;
  network?: string;
  poolAddress?: string;
}): Promise<Candle[]> {
  const interval = d.interval ?? "1m";
  const key = `${d.symbol}:${interval}:${d.binance ?? ""}:${d.geckoId ?? ""}:${d.network ?? ""}:${d.poolAddress ?? ""}`;
  const hit = candleJobs.get(key);
  if (hit) return hit;
  const job = getSymbolCandles({ data: { ...d, interval } }).catch(() => [] as Candle[]);
  candleJobs.set(key, job);
  return job;
}

async function geckoMarkets(): Promise<Listing[]> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=40&page=1&price_change_percentage=24h",
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      id: string;
      symbol: string;
      name: string;
      image?: string;
      current_price: number;
      price_change_percentage_24h: number;
      total_volume: number;
    }[];
    return j.map((c) => {
      const symbol = c.symbol.toUpperCase();
      return {
        symbol,
        name: c.name,
        price: c.current_price,
        change24: (c.price_change_percentage_24h ?? 0) / 100,
        volume24: c.total_volume,
        image: c.image,
        chain: CHAIN_HINT[symbol] ?? "Multi-chain",
        binance: BINANCE_MAP[symbol],
        geckoId: c.id,
      };
    });
  } catch {
    return [];
  }
}

async function dexSearch(q: string): Promise<Listing[]> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const j = (await res.json()) as {
      pairs?: {
        chainId: string;
        pairAddress?: string;
        priceUsd?: string;
        priceChange?: { h24?: number };
        volume?: { h24?: number };
        baseToken: { symbol: string; name: string; address: string };
      }[];
    };
    const seen = new Set<string>();
    const out: Listing[] = [];
    for (const p of j.pairs ?? []) {
      const symbol = p.baseToken.symbol.toUpperCase();
      const key = `${p.chainId}:${p.baseToken.address}`;
      if (seen.has(key) || out.length >= 12) continue;
      seen.add(key);
      out.push({
        symbol,
        name: p.baseToken.name,
        price: Number(p.priceUsd) || 0,
        change24: (p.priceChange?.h24 ?? 0) / 100,
        volume24: p.volume?.h24 ?? 0,
        chain: p.chainId,
        contract: p.baseToken.address,
        network: p.chainId === "ethereum" ? "eth" : p.chainId,
        poolAddress: p.pairAddress,
        binance: BINANCE_MAP[symbol],
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function geckoSearch(q: string): Promise<Listing | null> {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { coins?: { id: string; symbol: string; name: string; large?: string }[] };
    const c = j.coins?.[0];
    if (!c) return null;
    return {
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: 0,
      change24: 0,
      volume24: 0,
      image: c.large,
      geckoId: c.id,
      binance: BINANCE_MAP[c.symbol.toUpperCase()],
      chain: CHAIN_HINT[c.symbol.toUpperCase()] ?? "Multi-chain",
    };
  } catch {
    return null;
  }
}

async function dexToken(addr: string): Promise<Listing | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      pairs?: {
        chainId: string;
        priceUsd?: string;
        priceChange?: { h24?: number };
        volume?: { h24?: number };
        baseToken: { symbol: string; name: string; address: string };
      }[];
    };
    const p = j.pairs?.[0];
    if (!p) return null;
    const symbol = p.baseToken.symbol.toUpperCase();
    return {
      symbol,
      name: p.baseToken.name,
      price: Number(p.priceUsd) || 0,
      change24: (p.priceChange?.h24 ?? 0) / 100,
      volume24: p.volume?.h24 ?? 0,
      chain: p.chainId,
      contract: p.baseToken.address,
      binance: BINANCE_MAP[symbol],
    };
  } catch {
    return null;
  }
}

async function binanceTickers(): Promise<Listing[]> {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (!res.ok) return [];
    const j = (await res.json()) as { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }[];
    const want = new Set(Object.values(BINANCE_MAP));
    return j
      .filter((t) => want.has(t.symbol))
      .map((t) => {
        const symbol = Object.keys(BINANCE_MAP).find((k) => BINANCE_MAP[k] === t.symbol) ?? t.symbol.replace("USDT", "");
        return {
          symbol,
          name: symbol,
          price: Number(t.lastPrice),
          change24: Number(t.priceChangePercent) / 100,
          volume24: Number(t.quoteVolume),
          binance: t.symbol,
          chain: CHAIN_HINT[symbol] ?? "CEX",
        };
      })
      .sort((a, b) => b.volume24 - a.volume24);
  } catch {
    return [];
  }
}

async function binanceKlines(pair: string, interval: ChartInterval): Promise<Candle[]> {
  try {
    const iv = GRAN[interval].binance;
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${iv}&limit=300`);
    if (!res.ok) return [];
    const raw = (await res.json()) as (string | number)[][];
    return raw.map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
    }));
  } catch {
    return [];
  }
}

async function coinbaseKlines(product: string, interval: ChartInterval): Promise<Candle[]> {
  try {
    const g = GRAN[interval].coinbase;
    const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${g}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as number[][];
    return raw
      .map((r) => ({
        t: r[0]! * 1000,
        l: r[1]!,
        h: r[2]!,
        o: r[3]!,
        c: r[4]!,
        v: r[5]!,
      }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

async function geckoOhlc(id: string, interval: ChartInterval): Promise<Candle[]> {
  try {
    const days = interval === "1d" ? 90 : interval === "1h" ? 14 : 1;
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`);
    if (!res.ok) return [];
    const raw = (await res.json()) as number[][];
    return raw.map((r) => ({
      t: r[0]!,
      o: r[1]!,
      h: r[2]!,
      l: r[3]!,
      c: r[4]!,
      v: 0,
    }));
  } catch {
    return [];
  }
}

async function geckoTerminalTape(network: string): Promise<Listing[]> {
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools?include=base_token`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      data?: {
        id: string;
        attributes: {
          name: string;
          address: string;
          base_token_price_usd?: string;
          price_change_percentage?: { h24?: string };
          volume_usd?: { h24?: string };
        };
        relationships?: { base_token?: { data?: { id: string } } };
      }[];
      included?: { id: string; attributes?: { symbol?: string; name?: string; address?: string; image_url?: string } }[];
    };
    const tokens = new Map((j.included ?? []).map((t) => [t.id, t.attributes ?? {}]));
    const label = CHAINS.find((c) => c.id === network)?.label ?? network;
    return (j.data ?? [])
      .map((p) => {
        const tok = tokens.get(p.relationships?.base_token?.data?.id ?? "") ?? {};
        const symbol = (tok.symbol ?? p.attributes.name.split(" / ")[0] ?? "?").toUpperCase();
        return {
          symbol,
          name: tok.name ?? symbol,
          price: Number(p.attributes.base_token_price_usd ?? 0),
          change24: Number(p.attributes.price_change_percentage?.h24 ?? 0) / 100,
          volume24: Number(p.attributes.volume_usd?.h24 ?? 0),
          image: tok.image_url,
          chain: label,
          contract: tok.address,
          network,
          poolAddress: p.attributes.address,
        } satisfies Listing;
      })
      .filter((r) => r.price > 0)
      .slice(0, 40);
  } catch {
    return [];
  }
}

async function geckoTerminalOhlcv(network: string, pool: string, interval: ChartInterval): Promise<Candle[]> {
  try {
    const tf = interval === "1d" ? "day" : interval === "1h" ? "hour" : "minute";
    const agg = interval === "5m" ? 5 : interval === "15m" ? 15 : 1;
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=200`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const rows = j.data?.attributes?.ohlcv_list ?? [];
    return rows
      .map((r) => ({
        t: (r[0] ?? 0) * (r[0]! < 1e12 ? 1000 : 1),
        o: r[1] ?? 0,
        h: r[2] ?? 0,
        l: r[3] ?? 0,
        c: r[4] ?? 0,
        v: r[5] ?? 0,
      }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}



