import { createServerFn } from "@tanstack/react-start";
import type { Candle } from "./types";

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
