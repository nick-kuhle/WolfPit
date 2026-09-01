/**
 * Tests for the live-swap chart feed resolver.
 *
 * These lock the two failures the live desk actually shipped with:
 *   1. the chart subject was the sell leg, so ETH → Basecat charted ETH;
 *   2. the candle request carried no routing metadata, so any token without a
 *      CEX listing resolved to zero bars and the desk drew a synthetic series.
 *
 * Network calls are injected, so the suite is offline and deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  candleArgsFor,
  dsChain,
  gtNetwork,
  isMajorSymbol,
  isStableSymbol,
  pickDexPair,
  pickPool,
  pickSubject,
  resolveTokenFeed,
  subjectRank,
} from "./chart-feed";
import type { SpotToken } from "./config";

const ETH: SpotToken = {
  symbol: "ETH",
  name: "Ether",
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  decimals: 18,
  native: true,
};
const USDC: SpotToken = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
};
const BASECAT: SpotToken = {
  symbol: "Basecat",
  name: "Basecat",
  address: "0xB2000000000000000000004c27f6523082f41D01",
  decimals: 18,
};
const BASECAT_POOL = "0x8930762cccc36040f25fc29db58a8ec22e872a347260d992f39666a3cdce7e5a";

test("stable / major classification", () => {
  assert.equal(isStableSymbol("usdc"), true);
  assert.equal(isStableSymbol("USDbC"), true);
  assert.equal(isStableSymbol("Basecat"), false);
  assert.equal(isMajorSymbol("weth"), true);
  assert.equal(isMajorSymbol("Basecat"), false);
  assert.equal(subjectRank(USDC), 0);
  assert.equal(subjectRank(ETH), 1);
  assert.equal(subjectRank(BASECAT), 2);
});

test("the long-tail leg is the chart subject, not the sell leg", () => {
  // The screenshot's pair: selling ETH to buy Basecat must chart Basecat.
  assert.equal(pickSubject(ETH, BASECAT).subject.symbol, "Basecat");
  assert.equal(pickSubject(ETH, BASECAT).quote.symbol, "ETH");
  // …and the reverse direction charts the same token.
  assert.equal(pickSubject(BASECAT, ETH).subject.symbol, "Basecat");
  // A major against a stable charts the major, either way round.
  assert.equal(pickSubject(ETH, USDC).subject.symbol, "ETH");
  assert.equal(pickSubject(USDC, ETH).subject.symbol, "ETH");
  // Stable→stable is a tie: keep the sell leg so the header does not flicker.
  assert.equal(pickSubject(USDC, { ...USDC, symbol: "USDT" }).subject.symbol, "USDC");
});

test("chain slugs only ever resolve to networks market.ts accepts", () => {
  assert.equal(gtNetwork(8453), "base");
  assert.equal(gtNetwork(1), "eth");
  assert.equal(gtNetwork(137), "polygon_pos");
  assert.equal(gtNetwork(43114), "avax");
  assert.equal(gtNetwork(999999), "");
  assert.equal(dsChain(8453), "base");
  assert.equal(dsChain(1), "ethereum");
  assert.equal(dsChain(999999), "");
});

test("pickPool takes the deepest pool where our token is the BASE token", () => {
  // Charting a pool where the token is the QUOTE side would draw the other
  // token's price — the exact class of bug this module exists to prevent.
  const pools = [
    {
      attributes: { address: "0xquote", volume_usd: { h24: "9999999" }, reserve_in_usd: "9999999", base_token_price_usd: "2450" },
      relationships: { base_token: { data: { id: "base_0x4200000000000000000000000000000000000006" } } },
    },
    {
      attributes: { address: "0xthin", volume_usd: { h24: "1000" }, reserve_in_usd: "10", base_token_price_usd: "0.026" },
      relationships: { base_token: { data: { id: `base_${BASECAT.address.toLowerCase()}` } } },
    },
    {
      attributes: { address: BASECAT_POOL, volume_usd: { h24: "1525804" }, reserve_in_usd: "752460", base_token_price_usd: "0.02612" },
      relationships: { base_token: { data: { id: `base_${BASECAT.address.toLowerCase()}` } } },
    },
  ];
  const best = pickPool(pools, "base", BASECAT.address);
  assert.ok(best);
  assert.equal(best.poolAddress, BASECAT_POOL);
  assert.equal(best.priceUsd, 0.02612);
  // Nothing to chart when the token is only ever the quote side.
  assert.equal(pickPool([pools[0]!], "base", BASECAT.address), null);
  assert.equal(pickPool([], "base", BASECAT.address), null);
});

test("pickDexPair filters by chain and base token, then by liquidity", () => {
  const pairs = [
    { chainId: "ethereum", pairAddress: "0xwrongchain", liquidity: { usd: 1e9 }, priceUsd: "5", baseToken: { address: BASECAT.address } },
    { chainId: "base", pairAddress: "0xsmall", liquidity: { usd: 100 }, priceUsd: "0.0264", baseToken: { address: BASECAT.address } },
    { chainId: "base", pairAddress: "0xbig", liquidity: { usd: 315813 }, priceUsd: "0.02644", baseToken: { address: BASECAT.address.toLowerCase() } },
    { chainId: "base", pairAddress: "0xother", liquidity: { usd: 1e8 }, priceUsd: "2450", baseToken: { address: "0x4200000000000000000000000000000000000006" } },
  ];
  const best = pickDexPair(pairs, "base", BASECAT.address);
  assert.ok(best);
  assert.equal(best.poolAddress, "0xbig");
  assert.equal(best.priceUsd, 0.02644);
});

test("majors short-circuit: no network call, and no bogus pool", async () => {
  let calls = 0;
  const spy = (async () => {
    calls += 1;
    throw new Error("must not be called");
  }) as unknown as typeof fetch;
  const feed = await resolveTokenFeed({ chainId: 8453, address: ETH.address, symbol: "ETH", native: true }, spy);
  assert.equal(calls, 0);
  assert.equal(feed.source, "symbol");
  assert.equal(feed.network, undefined);
  assert.equal(feed.poolAddress, undefined);
  assert.equal(feed.geckoId, "ethereum");
});

test("a long-tail contract resolves to network + pool (the missing metadata)", async () => {
  const body = {
    data: [
      {
        attributes: {
          address: BASECAT_POOL,
          name: "Basecat / USDC 0.9%",
          base_token_price_usd: "0.02612843775",
          reserve_in_usd: "752460.4154",
          volume_usd: { h24: "1525804.18578964" },
        },
        relationships: { base_token: { data: { id: `base_${BASECAT.address.toLowerCase()}` } } },
      },
    ],
  };
  const urls: string[] = [];
  const spy = (async (url: string) => {
    urls.push(String(url));
    return { ok: true, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;

  const feed = await resolveTokenFeed({ chainId: 8453, address: BASECAT.address, symbol: "Basecat" }, spy);
  assert.equal(feed.source, "geckoterminal");
  assert.equal(feed.network, "base");
  assert.equal(feed.poolAddress, BASECAT_POOL);
  assert.ok(urls[0]!.includes(`/networks/base/tokens/${BASECAT.address}/pools`));

  // This is the shape the chart hands to loadSymbolCandles. Before the fix it
  // was `{ symbol }` alone, which returns zero bars for this token.
  const args = candleArgsFor(BASECAT, feed);
  assert.equal(args.symbol, "Basecat");
  assert.equal(args.network, "base");
  assert.equal(args.poolAddress, BASECAT_POOL);

  // Second call is served from the memo — one lookup per token, not per bar.
  const again = await resolveTokenFeed({ chainId: 8453, address: BASECAT.address, symbol: "Basecat" }, spy);
  assert.equal(again.poolAddress, BASECAT_POOL);
  assert.equal(urls.length, 1);
});

test("GeckoTerminal miss falls back to DexScreener", async () => {
  const addr = "0x1111111111111111111111111111111111111111";
  const spy = (async (url: string) => {
    const u = String(url);
    if (u.includes("geckoterminal")) return { ok: false, json: async () => ({}) } as unknown as Response;
    return {
      ok: true,
      json: async () => ({
        pairs: [{ chainId: "base", pairAddress: "0xpair", liquidity: { usd: 42_000 }, priceUsd: "1.25", baseToken: { address: addr } }],
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const feed = await resolveTokenFeed({ chainId: 8453, address: addr, symbol: "LONGTAIL" }, spy);
  assert.equal(feed.source, "dexscreener");
  assert.equal(feed.network, "base");
  assert.equal(feed.poolAddress, "0xpair");
  assert.equal(feed.priceUsd, 1.25);
});

test("no feed anywhere returns none rather than an invented pool", async () => {
  const addr = "0x2222222222222222222222222222222222222222";
  const spy = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
  const feed = await resolveTokenFeed({ chainId: 8453, address: addr, symbol: "NOPE" }, spy);
  assert.equal(feed.source, "none");
  assert.equal(feed.poolAddress, undefined);
  assert.equal(feed.priceUsd, undefined);
  // A malformed address never reaches the network at all.
  const bad = await resolveTokenFeed({ chainId: 8453, address: "not-an-address", symbol: "NOPE2" }, spy);
  assert.equal(bad.source, "none");
});
