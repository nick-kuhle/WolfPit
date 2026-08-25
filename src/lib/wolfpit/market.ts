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

export const getUniverse = createServerFn({ method: "GET" }).handler(async (): Promise<Listing[]> => {
  const cg = await geckoMarkets();
  if (cg.length) return cg;
  return binanceTickers();
});

export const lookupToken = createServerFn({ method: "GET" })
  .validator((d: { q: string }) => d)
  .handler(async ({ data }): Promise<Listing> => {
    const q = data.q.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
      const dex = await dexToken(q);
      if (dex) return dex;
    }
    const rows = await geckoMarkets();
    const hit = rows.find((r) => r.symbol === q.toUpperCase() || r.name.toLowerCase() === q.toLowerCase());
    if (hit) return hit;
    const search = await geckoSearch(q);
    if (search) return search;
    throw new Error("Token not found.");
  });

export const getSymbolCandles = createServerFn({ method: "GET" })
  .validator((d: { symbol: string; interval?: ChartInterval; binance?: string }) => d)
  .handler(async ({ data }): Promise<Candle[]> => {
    const interval: ChartInterval = data.interval ?? "1m";
    const pair = data.binance || BINANCE_MAP[data.symbol.toUpperCase()];
    if (pair) {
      const bars = await binanceKlines(pair, interval);
      if (bars.length) return bars;
    }
    return [];
  });

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

