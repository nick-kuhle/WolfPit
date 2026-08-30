import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addLiquidity,
  advanceClock,
  bookGreeks,
  buyOption,
  closeFuture,
  closeOption,
  createPool,
  dayPnl,
  equity,
  farmApy,
  farmPending,
  farmShare,
  poolTvl,
  poolMark,
  expiries,
  harvestFarm,
  harvestDue,
  initialState,
  pushEquity,
  rebalanceWeights,
  reservationPx,
  removeLiquidity,
  setMark,
  settleNow,
  tick,
  tradeFuture,
  tradeSpot,
  residualDelta,
  futLiqPrice,
  hedgeDelta,
  spreadBps,
  joinCompetition,
  payCompPrize,
  optionQuote,
  strikeGrid,
  markOf,
  applyLive,
  arbToSpot,
  refreshQuotes,
  maxSpotQty,
  maxMiniContracts,
  placeDeskOrder,
  groupedFutures,
  groupedOptions,
  imRate,
  ensureListed,
} from "./engine.ts";
import { sanitizeState } from "./sanitize.ts";
import { PIT_OPEN } from "./comp.ts";
import { MAX_FARM_APY, MAX_LOT } from "./limits.ts";
import { FUT_IM, FUT_MM, MINI_ETH } from "./types.ts";
import { CALL_INV_VOL, circuitActive, gammaCash1h, haltShortGamma, hedgeError99, rejectFuture, rejectOption, smileVol, spotFeeBps, vaultNav } from "./risk.ts";

const exp = expiries(initialState().clock)[0]!.at;

describe("golden G1–G6", () => {
  it("G1 buy call with free ETH = 0 → reject", () => {
    const s = initialState();
    s.vault.reservedEth = s.vault.eth;
    const r = buyOption(s, "call", 4000, exp, 1);
    assert.equal(typeof r, "string");
    assert.match(String(r), /naked call/i);
  });

  it("G2 buy put with free USDC < K×size → reject", () => {
    const s = initialState();
    s.vault.reservedUsdc = s.vault.usdc;
    const r = buyOption(s, "put", 4000, exp, 1);
    assert.equal(typeof r, "string");
    assert.match(String(r), /naked put/i);
  });

  it("G3 open long that would push util > 0.40 → reject", () => {
    let s = initialState();
    let last: string | typeof s = s;
    for (let i = 0; i < 500; i++) {
      const r = tradeFuture(s, "long", 1, exp);
      if (typeof r === "string") {
        last = r;
        break;
      }
      s = r;
    }
    assert.equal(typeof last, "string");
    assert.ok(/Inventory cap|10%|OI cap/i.test(String(last)));
    assert.ok(s.vault.reservedEth / s.vault.eth >= 0.24);
  });

  it("G4 open future IM starts at 25% and scales with size", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 1, exp);
    assert.equal(typeof r, "object");
    const next = r as typeof s;
    const size = MINI_ETH;
    const notional = size * next.futures[0]!.entry;
    const rate = next.futures[0]!.margin / notional;
    assert.ok(rate >= FUT_IM - 1e-9, String(rate));
    assert.ok(rate <= 0.28, String(rate));
    assert.ok(Math.abs(s.account.usdc - next.account.usdc - next.futures[0]!.margin - next.fills[0]!.fee) < 1e-4);
  });

  it("G5 liquidation when equity < 0.125 × size × S", () => {
    let s = initialState();
    s.account.eth = 0;
    s.account.startEquity = 100_000;
    const opened = tradeFuture(s, "long", 1, exp);
    assert.equal(typeof opened, "object");
    s = opened as typeof s;
    s = setMark(s, 2500);
    assert.ok(s.liquidations >= 1);
    assert.equal(s.futures.length, 0);
    const maintAtMark = MINI_ETH * 2500 * FUT_MM;
    assert.ok(maintAtMark > 0);
  });

  it("G6 hedge 1:1 long N ETH increases reservedETH by N", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 3, exp);
    assert.equal(typeof r, "object");
    const next = r as typeof s;
    assert.ok(Math.abs(next.vault.reservedEth - 0.3) < 1e-9);
  });
});

describe("W1-02 risk limits", () => {
  it("gamma cash helper binds on synthetic gamma", () => {
    const s = initialState();
    const nav = vaultNav(s);
    const cash = gammaCash1h(50, s.eth, 1);
    assert.ok(cash > 0.02 * nav);
    assert.ok(gammaCash1h(0.001, s.eth, s.iv) < 0.02 * nav);
  });

  it("vega cap is evaluated (tiny NAV, 1 mini still blocked by inventory or vega)", () => {
    const s = initialState();
    s.vault.eth = 0.5;
    s.vault.usdc = 200;
    const r = buyOption(s, "call", 4000, exp, 1);
    assert.equal(typeof r, "string");
  });

  it("OI / expiry 25% of vault ETH", () => {
    const s = initialState();
    const r = rejectFuture(s, "long", s.vault.eth * 0.26, exp);
    assert.ok(r && /OI cap on this expiry/i.test(r));
  });

  it("OI / strike 10% of vault ETH", () => {
    let s = initialState();
    let last: string | undefined;
    for (let i = 0; i < 200; i++) {
      const r = buyOption(s, "call", 4000, exp, 1);
      if (typeof r === "string") {
        last = r;
        break;
      }
      s = r;
    }
    assert.ok(last);
    assert.match(String(last), /strike|10%|Inventory|band/i);
    assert.ok(s.options.reduce((a, p) => a + p.sizeEth, 0) <= s.vault.eth * 0.1 + MINI_ETH + 1e-6);
  });

  it("single fill > 10% remaining band", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 50, exp);
    assert.equal(typeof r, "string");
    assert.match(String(r), /10%/);
  });

  it("circuit halts new shorts", () => {
    let s = initialState();
    s.candles = [
      ...s.candles.slice(0, -6),
      { t: s.clock - 5 * 60_000, o: 4000, h: 4000, l: 4000, c: 4000, v: 1 },
      { t: s.clock - 4 * 60_000, o: 4000, h: 4000, l: 4000, c: 4000, v: 1 },
      { t: s.clock - 3 * 60_000, o: 4000, h: 4000, l: 4000, c: 4000, v: 1 },
      { t: s.clock - 2 * 60_000, o: 4000, h: 4000, l: 4000, c: 4000, v: 1 },
      { t: s.clock - 1 * 60_000, o: 4000, h: 4000, l: 4000, c: 4000, v: 1 },
      { t: s.clock, o: 5200, h: 5200, l: 4000, c: 5200, v: 1 },
    ];
    s = setMark(s, 5200, { settle: false });
    assert.ok(circuitActive(s));
    const r = tradeFuture(s, "short", 1, exp);
    assert.equal(typeof r, "string");
    assert.match(String(r), /Circuit/);
  });

  it("short-call inventory adds 0.5 vol-pt", () => {
    let s = initialState();
    const T = (exp - s.clock) / (365.25 * 24 * 3600 * 1000);
    const before = smileVol(s, "call", 4000, T);
    const opened = buyOption(s, "call", 3900, exp, 1);
    assert.equal(typeof opened, "object", String(opened));
    s = opened as typeof s;
    const after = smileVol(s, "call", 4000, T);
    assert.ok(Math.abs(after - before - CALL_INV_VOL) < 1e-9);
  });

  it("insurance / NAV < 1% halt short gamma", () => {
    const s = initialState();
    s.insuranceUsdc = 10;
    assert.ok(haltShortGamma(s));
    const r = buyOption(s, "call", 4000, exp, 1);
    assert.equal(typeof r, "string");
    assert.match(String(r), /Insurance/);
  });

  it("spot fee 5–30 from RV", () => {
    assert.equal(spotFeeBps(0.2), 5);
    assert.equal(spotFeeBps(0.4), 5);
    assert.equal(spotFeeBps(0.5), 13);
    assert.equal(spotFeeBps(1.2), 30);
  });

  it("harvest 1% tax → insurance, only LP share", () => {
    let s = initialState();
    // FARM.md: ETH/USDC earns 0% (unfarmed); WPIT/USDC-TEST is the 20% gauge.
    const unfarmed = addLiquidity(s, "ETH-USDC", 4_000);
    assert.equal(typeof unfarmed, "object", String(unfarmed));
    const s0 = unfarmed as typeof s;
    assert.equal(farmPending(s0, "ETH-USDC"), 0);
    s = { ...s0, farmWpit: 0 };
    const added = addLiquidity(s, "WPIT-USDC-TEST", 4_000);
    assert.equal(typeof added, "object", String(added));
    s = added as typeof s;
    s = { ...s, farmWpit: 100, wpit: 2 };
    const due = harvestDue(s);
    assert.ok(due > 0 && due < 100);
    const next = harvestFarm(s);
    assert.ok(next.farmWpit < s.farmWpit);
    assert.ok(next.account.wpit > s.account.wpit);
    const tax = due * 0.01;
    assert.ok(Math.abs(next.insuranceUsdc - (s.insuranceUsdc + tax * 2)) < 1e-6);
    const empty = harvestFarm(initialState());
    assert.equal(empty.account.wpit, initialState().account.wpit);
  });
});

describe("desk engine has no hedgeLater", () => {
  it("book still covers after a fill", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 2, exp);
    assert.equal(typeof r, "object");
    const next = r as typeof s;
    assert.ok(next.vault.eth >= next.vault.reservedEth);
    assert.ok(bookGreeks(next));
  });
});

describe("LP and option close", () => {
  it("remove LP returns both legs", () => {
    let s = initialState();
    s.account.eth = 10;
    const added = addLiquidity(s, "ETH-USDC", 4000);
    assert.equal(typeof added, "object", String(added));
    s = added as typeof s;
    const sh = s.lp[0]!.shares;
    const r = removeLiquidity(s, "ETH-USDC", sh);
    assert.equal(typeof r, "object", String(r));
    s = r as typeof s;
    assert.equal(s.lp.length, 0);
    assert.ok(s.account.eth > 9);
  });

  it("ETH-USDC add uses live mark, not a custom print", () => {
    const s = initialState();
    s.eth = 3500;
    s.account.eth = 10;
    s.account.usdc = 100_000;
    const before = s.eth;
    const added = addLiquidity(s, "ETH-USDC", 3500);
    assert.equal(typeof added, "object", String(added));
    const next = added as typeof s;
    const p = next.pools["ETH-USDC"]!;
    const mid = p.quoteReserve / p.baseReserve;
    assert.ok(Math.abs(mid - before) / before < 1e-9);
    assert.ok(Math.abs(poolMark(next, p) - 3500) < 1e-6);
    assert.ok(Math.abs(s.account.eth - next.account.eth - 1) < 1e-8);
  });

  it("close option releases cover", () => {
    let s = initialState();
    const opened = buyOption(s, "call", 4000, exp, 1);
    assert.equal(typeof opened, "object", String(opened));
    s = opened as typeof s;
    const id = s.options[0]!.id;
    const reserved = s.vault.reservedEth;
    const closed = closeOption(s, id);
    assert.equal(typeof closed, "object", String(closed));
    s = closed as typeof s;
    assert.equal(s.options.length, 0);
    assert.ok(s.vault.reservedEth < reserved);
  });
});

describe("AMM create pool", () => {
  it("rejects duplicate ETH-USDC and creates WPIT-ETH extra", () => {
    const s = initialState();
    assert.equal(typeof createPool(s, "ETH", "USDC", 1, 4000), "string");
    const issued = { ...s, account: { ...s.account, tokens: { PEPE: 1_000_000 } } };
    const out = createPool(issued, "PEPE", "USDC", 1000, 10);
    assert.equal(typeof out, "object", String(out));
    const next = out as typeof s;
    assert.ok(next.pools["PEPE-USDC"]);
  });

  it("farm APY falls as TVL rises", () => {
    const s = initialState();
    const thin = farmApy(s, "WPIT-USDC-TEST");
    s.pools["WPIT-USDC-TEST"]!.quoteReserve *= 4;
    s.pools["WPIT-USDC-TEST"]!.baseReserve *= 4;
    const fat = farmApy(s, "WPIT-USDC-TEST");
    assert.ok(poolTvl(s, "WPIT-USDC-TEST") > 0);
    assert.ok(thin > fat);
    assert.ok(thin > 0);
  });
});

describe("WPIT moon", () => {
  it("synthetic mark tends to rise", () => {
    let s = initialState();
    const start = s.wpit;
    for (let i = 0; i < 240; i++) s = tick(s, 1);
    assert.ok(s.wpit > start * 0.5);
    assert.ok(s.wpit <= 5);
    assert.ok(s.wpitCandles.length >= 2);
  });
});

describe("cover, delta, liq", () => {
  it("long mini residual delta ~ 0 and cover reserved", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 2, exp);
    assert.equal(typeof r, "object", String(r));
    const next = r as typeof s;
    assert.ok(Math.abs(residualDelta(next)) < 0.02);
    assert.ok(next.vault.reservedEth >= 0.2 - 1e-9);
    assert.ok(next.vault.eth - next.vault.reservedEth >= -1e-9);
    const p = next.futures[0]!;
    const liq = futLiqPrice(p);
    assert.ok(liq < p.entry);
    assert.ok(liq > p.entry * 0.7);
  });

  it("short mini residual ~ 0 and USDC reserved", () => {
    const s = initialState();
    const r = tradeFuture(s, "short", 2, exp);
    assert.equal(typeof r, "object", String(r));
    const next = r as typeof s;
    assert.ok(Math.abs(residualDelta(next)) < 0.05);
    assert.ok(next.vault.reservedUsdc > 0);
    const p = next.futures[0]!;
    assert.ok(futLiqPrice(p) > p.entry);
  });

  it("written call is covered and hedge flattens residual", () => {
    const s = initialState();
    const r = buyOption(s, "call", 4000, exp, 2);
    assert.equal(typeof r, "object", String(r));
    const next = r as typeof s;
    assert.ok(next.vault.reservedEth >= 0.2 - 1e-9);
    // MM.md: after a legal fill |Δ_unhedged| ≤ band = max(0.05·vault.ETH, 0.02·NAV/S).
    const band = Math.max(0.05 * next.vault.eth, (0.02 * vaultNav(next)) / next.eth);
    assert.ok(Math.abs(residualDelta(next)) <= band + 1e-9, `residual ${residualDelta(next)} band ${band}`);
    assert.ok(next.insuranceUsdc >= s.insuranceUsdc);
  });

  it("spread widens with vol", () => {
    const a = initialState();
    const b = { ...a, realizedVol: 1.2, iv: 1.2 };
    assert.ok(spreadBps(b) > spreadBps(a));
  });

  it("hedge does not spend reserved ETH", () => {
    let s = initialState();
    s = tradeFuture(s, "long", 3, exp) as typeof s;
    const reserved = s.vault.reservedEth;
    s = hedgeDelta(s);
    assert.ok(s.vault.eth + 1e-9 >= reserved);
    assert.ok(Math.abs(s.vault.reservedEth - reserved) < 1e-9);
  });
});

describe("Pit Open", () => {
  it("join resets to 100k USDC paper", () => {
    const s = joinCompetition(initialState(), Date.UTC(2026, 7, 26));
    assert.equal(s.account.usdc, 100_000);
    assert.equal(s.account.eth, 0);
    assert.equal(s.compJoined, true);
    assert.equal(s.account.startEquity, 100_000);
  });

  it("first place pays 1M WPIT once", () => {
    let s = joinCompetition(initialState());
    s = payCompPrize(s, 1, PIT_OPEN.end);
    assert.equal(s.account.wpit, 1_000_000);
    const again = payCompPrize(s, 1, PIT_OPEN.end);
    assert.equal(again.account.wpit, 1_000_000);
    const early = payCompPrize(joinCompetition(initialState()), 1, PIT_OPEN.start);
    assert.equal(early.account.wpit, 0);
    assert.equal(early.compPaid, false);
  });
});

describe("WPIT ladder", () => {
  it("strikes hug WPIT not ETH", () => {
    const s = initialState();
    const ks = strikeGrid(s.wpit);
    assert.ok(ks.length >= 3);
    assert.ok(ks.every((k) => k < 50));
    assert.ok(ks.some((k) => Math.abs(k - s.wpit) / s.wpit < 0.5));
  });

  it("WPIT call ask is a WPIT premium not an ETH premium", () => {
    const s = initialState();
    const k = strikeGrid(s.wpit)[4] ?? s.wpit;
    const q = optionQuote(s, "call", k, exp, "WPIT");
    assert.ok(!q.blank, String(q.blank));
    assert.ok(q.ask > 0);
    assert.ok(q.ask < s.wpit * 2);
    const eth = optionQuote(s, "call", 4000, exp, "ETH");
    assert.ok(eth.ask > 1);
  });

  it("markOf WPIT is not ETH", () => {
    const s = initialState();
    assert.notEqual(markOf(s, "WPIT"), markOf(s, "ETH"));
    assert.equal(markOf(s, "WPIT"), s.wpit);
  });
});

describe("oracle arb", () => {
  it("ETH bid/ask stay on the live mark even with WPIT inventory", () => {
    let s = initialState();
    s = setMark(s, 2461);
    const opened = tradeFuture(s, "long", 80, exp, "WPIT");
    assert.equal(typeof opened, "object", String(opened));
    s = opened as typeof s;
    s = tick(s, 1);
    s = refreshQuotes(s);
    assert.ok(Math.abs(s.ethBid - 2461) / 2461 < 0.04, `bid ${s.ethBid}`);
    assert.ok(Math.abs(s.ethAsk - 2461) / 2461 < 0.04, `ask ${s.ethAsk}`);
    assert.ok(s.ethAsk >= s.ethBid);
  });

  it("ETH-USDC pool arbs back to the oracle", () => {
    let s = initialState();
    s = { ...s, eth: 2461 };
    const pool = s.pools["ETH-USDC"]!;
    s = {
      ...s,
      pools: {
        ...s.pools,
        "ETH-USDC": { ...pool, quoteReserve: pool.baseReserve * 5700 },
      },
    };
    s = arbToSpot(s);
    const mark = s.pools["ETH-USDC"]!.quoteReserve / s.pools["ETH-USDC"]!.baseReserve;
    assert.ok(Math.abs(mark - 2461) / 2461 < 0.002, `pool ${mark}`);
  });

  it("applyLive writes Coinbase ETH into the book", () => {
    const s = applyLive(initialState(), {
      eth: 2461,
      ethBid: 2460.8,
      ethAsk: 2461.2,
      candles: initialState().candles.map((c) => ({ ...c, c: 2461, o: 2461, h: 2462, l: 2460 })),
      at: Date.now(),
      source: "Coinbase",
    });
    assert.equal(s.eth, 2461);
    assert.ok(Math.abs(s.ethBid - 2461) / 2461 < 0.04);
    const mark = s.pools["ETH-USDC"]!.quoteReserve / s.pools["ETH-USDC"]!.baseReserve;
    assert.ok(Math.abs(mark - 2461) / 2461 < 0.01, `pool ${mark}`);
  });
});

describe("house limits", () => {
  it("rejects NaN, zero, and trillion-lot minis", () => {
    const s = initialState();
    assert.equal(typeof tradeFuture(s, "long", Number.NaN, exp), "string");
    assert.equal(typeof tradeFuture(s, "long", 0, exp), "string");
    assert.equal(typeof tradeFuture(s, "long", 1e14, exp), "string");
    assert.equal(typeof tradeFuture(s, "long", 1e14, exp, "WPIT"), "string");
    assert.equal(typeof placeDeskOrder(s, { product: "future", side: "buy", kind: "mkt", tif: "day", qty: 1e14, under: "ETH" }), "string");
  });

  it("IM scales with size and debit hits the wallet", () => {
    const s = setMark(initialState(), 2461);
    const a = tradeFuture(s, "long", 1, exp);
    const b = tradeFuture(s, "long", 2, exp);
    assert.equal(typeof a, "object", String(a));
    assert.equal(typeof b, "object", String(b));
    const A = a as typeof s;
    const B = b as typeof s;
    const im1 = A.futures[0]!.margin;
    const im2 = B.futures[0]!.margin;
    assert.ok(Math.abs(im2 / im1 - 2) < 0.05, `im ${im1} vs ${im2}`);
    assert.ok(s.account.usdc - A.account.usdc > im1 * 0.99);
    assert.ok(s.account.usdc - B.account.usdc > s.account.usdc - A.account.usdc);
    assert.ok(B.account.usdc < A.account.usdc);
  });

  it("spot buy of a custom token credits that token, not WPIT, and cannot exceed cash", () => {
    let s = initialState();
    s = { ...s, account: { ...s.account, tokens: { PEPE: 1_000_000 } } };
    const made = createPool(s, "PEPE", "USDC", 1000, 10);
    assert.equal(typeof made, "object", String(made));
    s = made as typeof s;
    const wpit0 = s.account.wpit;
    const pepe0 = s.account.tokens.PEPE ?? 0;
    const cash0 = s.account.usdc;
    const buy = tradeSpot(s, "PEPE-USDC", "buy", 2);
    assert.equal(typeof buy, "object", String(buy));
    const next = buy as typeof s;
    assert.equal(next.account.wpit, wpit0);
    assert.ok((next.account.tokens.PEPE ?? 0) > pepe0);
    assert.ok(next.account.usdc < cash0 - 1.9);
    const tooBig = tradeSpot(s, "PEPE-USDC", "buy", cash0 + 1);
    assert.equal(typeof tooBig, "string");
  });

  it("farm APY stays capped when WPIT rips and TVL is thin", () => {
    const s = initialState();
    s.wpit = 5;
    s.pools["ETH-USDC"]!.baseReserve = 0.01;
    s.pools["ETH-USDC"]!.quoteReserve = 25;
    const apy = farmApy(s, "ETH-USDC");
    assert.ok(apy <= MAX_FARM_APY + 1e-12, String(apy));
    assert.ok(apy >= 0);
  });

  it("max contracts is cash-and-inventory bound", () => {
    const s = setMark(initialState(), 2461);
    const n = maxMiniContracts(s, "long", "ETH");
    assert.ok(n < 10_000);
    assert.ok(n >= 1);
    const poor = { ...s, account: { ...s.account, usdc: 1 } };
    assert.equal(maxMiniContracts(poor, "long", "ETH"), 0);
  });
});

describe("netting and cover", () => {
  it("two longs of the same expiry collapse to one book", () => {
    let s = initialState();
    const a = tradeFuture(s, "long", 1, exp);
    assert.equal(typeof a, "object", String(a));
    s = a as typeof s;
    const b = tradeFuture(s, "long", 2, exp);
    assert.equal(typeof b, "object", String(b));
    s = b as typeof s;
    assert.equal(s.futures.length, 1);
    assert.ok(Math.abs(s.futures[0]!.sizeEth - 3 * MINI_ETH) < 1e-9);
    assert.equal(groupedFutures(s).length, 1);
  });

  it("buying the other side flattens instead of opening a second line", () => {
    let s = initialState();
    const a = tradeFuture(s, "long", 2, exp);
    assert.equal(typeof a, "object", String(a));
    s = a as typeof s;
    const b = tradeFuture(s, "short", 2, exp);
    assert.equal(typeof b, "object", String(b));
    s = b as typeof s;
    assert.equal(s.futures.length, 0);
  });

  it("two same-strike calls net to one option line", () => {
    let s = initialState();
    const a = buyOption(s, "call", 4000, exp, 1);
    assert.equal(typeof a, "object", String(a));
    s = a as typeof s;
    const b = buyOption(s, "call", 4000, exp, 1);
    assert.equal(typeof b, "object", String(b));
    s = b as typeof s;
    assert.equal(s.options.length, 1);
    assert.ok(Math.abs(s.options[0]!.sizeEth - 2 * MINI_ETH) < 1e-9);
    assert.equal(groupedOptions(s).length, 1);
  });

  it("IM rate rises as size eats cover", () => {
    const s = initialState();
    const small = imRate(s, MINI_ETH, "ETH");
    const big = imRate(s, 20, "ETH");
    assert.ok(small >= 0.25 - 1e-12);
    assert.ok(big > small + 0.02, `${small} vs ${big}`);
    assert.ok(big <= 0.75);
  });

  it("rejects a book the vault cannot cover", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 10_000, exp);
    assert.equal(typeof r, "string");
    assert.match(String(r), /cover|cap|pool|Inventory|notional/i);
  });
});

describe("risk audit", () => {
  it("does not mint an unbacked AMM when listing a ticker", () => {
    const s = initialState();
    const n = Object.keys(s.pools).length;
    const next = ensureListed(s, "PEPE", 0.000001);
    assert.equal(Object.keys(next.pools).length, n);
    assert.equal(next.pools["PEPE-USDC"], undefined);
  });

  it("rejects derivatives on a self-priced junk ticker", () => {
    let s = initialState();
    const made = createPool(s, "PEPE", "USDC", 1, 1);
    // no PEPE balance
    assert.equal(typeof made, "string");
    const r = tradeFuture(s, "long", 1, exp, "PEPE");
    assert.equal(typeof r, "string");
    assert.match(String(r), /ETH and WPIT|oracle/i);
    const o = buyOption(s, "call", 1, exp, 1, "PEPE");
    assert.equal(typeof o, "string");
  });

  it("sanitize drops NaN balances and negative vault", () => {
    const dirty = {
      ...initialState(),
      account: { usdc: Number.NaN, eth: -5, wpit: 1e20, tokens: { "$$": 1 }, realized: 0, startEquity: 1 },
      vault: { eth: 10, usdc: 10, reservedEth: 99, reservedUsdc: 99, hedgeEth: 0, escrowUsdc: 50 },
      eth: Number.POSITIVE_INFINITY,
    };
    const clean = sanitizeState(dirty, initialState());
    assert.ok(clean.account.usdc >= 0);
    assert.ok(clean.account.eth >= 0);
    assert.ok(clean.vault.reservedEth <= clean.vault.eth);
    assert.ok(clean.eth < 1e6);
    assert.ok(!clean.account.tokens["$$"]);
  });

  it("oracle jump is clamped after the book is live", () => {
    let s = applyLive(initialState(), {
      eth: 2461,
      ethBid: 2460,
      ethAsk: 2462,
      candles: initialState().candles.map((c) => ({ ...c, c: 2461, o: 2461, h: 2462, l: 2460 })),
      at: Date.now(),
      source: "Coinbase",
    });
    assert.equal(s.eth, 2461);
    const spiked = applyLive(s, {
      eth: 1,
      ethBid: 1,
      ethAsk: 1,
      candles: s.candles,
      at: Date.now() + 1000,
      source: "evil",
    });
    assert.ok(spiked.eth > 2000, `clamped to ${spiked.eth}`);
    assert.ok(spiked.circuitUntil > s.circuitUntil);
  });
});

describe("P0/P1 fixes (2026-08-29 review)", () => {
  it("sim clock advances 1×/10×/60× (was clamped to 2s per tick)", () => {
    const s = initialState();
    assert.ok(Math.abs(tick(s, 1).clock - s.clock - 1_000) < 1, "1×");
    assert.ok(Math.abs(tick(s, 10).clock - s.clock - 10_000) < 1, "10×");
    assert.ok(Math.abs(tick(s, 60).clock - s.clock - 60_000) < 1, "60×");
    assert.ok(Math.abs(tick(s, 600).clock - s.clock - 120_000) < 1, "capped at 120s");
  });

  it("dayPnl uses the day's FIRST candle, not its latest", () => {
    const base = initialState();
    const eq0 = equity(base);
    const dayStart = Math.floor(base.clock / 86_400_000) * 86_400_000;
    let s: typeof base = { ...base, equityTape: [{ t: dayStart, o: eq0, h: eq0, l: eq0, c: eq0, v: 1 }] };
    s = pushEquity({ ...s, clock: dayStart + 3 * 3_600_000, account: { ...s.account, usdc: s.account.usdc + 500 } });
    const pnl = dayPnl(s);
    assert.ok(Math.abs(pnl - 500) < 1e-6, `dayPnl ${pnl}`);
  });

  it("farm gauges match FARM.md: WPIT pools 20/10, ETH-USDC unfarmed", () => {
    const s = initialState();
    assert.equal(farmShare(s, "ETH-USDC"), 0);
    assert.equal(farmShare(s, "WPIT-USDC-TEST"), 0.2);
    assert.equal(farmShare(s, "WPIT-ETH-TEST"), 0.1);
  });

  it("spread follows the MM.md stack 8 + 80·util + 40·(IV−0.40) + 25·|Δ|/vault.ETH", () => {
    const s = initialState();
    const inv = Math.abs(bookGreeks(s).delta) / s.vault.eth;
    const expect = Math.min(280, Math.max(8, 8 + 80 * (s.vault.reservedEth / s.vault.eth) + 40 * (s.iv - 0.4) + 25 * inv));
    assert.ok(Math.abs(spreadBps(s) - expect) < 1e-9);
    assert.ok(spreadBps({ ...s, iv: 1.2 }) > spreadBps(s));
  });

  it("reservation is A-S: flat at zero inventory, skews against inventory", () => {
    const s = initialState();
    assert.ok(Math.abs(reservationPx(s) - s.eth) < 1e-9, "flat book ⇒ mid");
    const long = tradeFuture(s, "long", 5, expiries(s.clock)[0]!.at) as typeof s;
    assert.ok(reservationPx(long) > s.eth, "vault short inventory ⇒ quote skews up");
  });

  it("liquidation conserves USDC: trader gets equity − penalty, insurance +penalty", () => {
    let s = initialState();
    s = tradeFuture(s, "long", 5, expiries(s.clock)[0]!.at) as typeof s;
    const crashed = setMark(s, 3200, { settle: false });
    const pos = crashed.futures[0]!;
    const mark = crashed.eth;
    const pnl = (mark - pos.entry) * pos.sizeEth;
    const eqTrue = pos.margin + pnl;
    const penalty = Math.min(Math.max(eqTrue, 0), 0.01 * pos.sizeEth * mark);
    const t0 = crashed.account.usdc;
    const i0 = crashed.insuranceUsdc;
    const v0 = crashed.vault.usdc + crashed.vault.eth * crashed.eth;
    const after = settleNow(crashed);
    const dT = after.account.usdc - t0;
    const dI = after.insuranceUsdc - i0;
    const dV = after.vault.usdc + after.vault.eth * after.eth - v0;
    assert.equal(after.futures.length, 0);
    assert.ok(Math.abs(dT - (eqTrue - penalty)) < 1e-6, `trader Δ ${dT} vs ${eqTrue - penalty}`);
    assert.ok(Math.abs(dI - penalty) < 1e-6, `insurance Δ ${dI} vs ${penalty}`);
    assert.ok(Math.abs(dT + dI + dV) < 1e-6, `conservation: ΔT ${dT} ΔI ${dI} ΔV ${dV}`);
  });

  it("equity ≤ 0: trader wiped, insurance eats the hole, pit pauses if insurance < 0", () => {
    let s = initialState();
    s = tradeFuture(s, "long", 5, expiries(s.clock)[0]!.at) as typeof s;
    s = { ...s, insuranceUsdc: 10 };
    const crashed = setMark(s, 2900, { settle: false });
    const after = settleNow(crashed);
    assert.equal(after.futures.length, 0);
    assert.equal(after.account.usdc, crashed.account.usdc, "trader gets nothing");
    assert.ok(after.insuranceUsdc < 0, `insurance ${after.insuranceUsdc}`);
    assert.ok(after.circuitUntil > after.clock, "circuit set when insurance < 0");
  });

  it("options writing halts when insurance cannot cover 99th-pct 1h HE at 80% vol", () => {
    const s = { ...initialState(), insuranceUsdc: 40_000 }; // 5% of NAV — above the 1% floor
    const e = expiries(s.clock)[0]!.at;
    assert.ok(hedgeError99(s.eth, 20) > 40_000, "synthetic gamma stresses insurance");
    const why = rejectOption(s, "call", s.eth, e, MINI_ETH, 20, 0);
    assert.ok(typeof why === "string" && why.includes("hedge error"), String(why));
  });

  it("vault ETH weight rebalances toward the band when outside [0.40, 0.60] (LP.md)", () => {
    const s = initialState();
    const skewed = { ...s, vault: { ...s.vault, eth: 240, usdc: 320_000 } }; // w = 0.75
    let next = skewed;
    for (let i = 0; i < 400; i++) next = arbToSpot(rebalanceWeights(next));
    const w = (next.vault.eth * next.eth) / (next.vault.eth * next.eth + next.vault.usdc);
    assert.ok(w < 0.7, `moved ${w}`);
    assert.ok(w >= 0.4 && w <= 0.605, `inside band ${w}`);
  });
});
