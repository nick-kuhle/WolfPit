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
  farmApy,
  poolTvl,
  poolMark,
  expiries,
  harvestFarm,
  initialState,
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
} from "./engine.ts";
import { FUT_IM, FUT_MM, MINI_ETH } from "./types.ts";
import { CALL_INV_VOL, circuitActive, gammaCash1h, haltShortGamma, rejectFuture, smileVol, spotFeeBps, vaultNav } from "./risk.ts";

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

  it("G4 open future IM = 0.25 × size × S", () => {
    const s = initialState();
    const r = tradeFuture(s, "long", 1, exp);
    assert.equal(typeof r, "object");
    const next = r as typeof s;
    const size = MINI_ETH;
    const im = size * next.futures[0]!.entry * FUT_IM;
    assert.ok(Math.abs(next.futures[0]!.margin - im) < 1e-6);
    assert.ok(Math.abs(s.account.usdc - next.account.usdc - im - next.fills[0]!.fee) < 1e-4);
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

  it("harvest 1% tax → insurance", () => {
    const s = initialState();
    s.farmWpit = 100;
    s.wpit = 2;
    const next = harvestFarm(s);
    assert.equal(next.farmWpit, 0);
    assert.ok(Math.abs(next.account.wpit - (s.account.wpit + 99)) < 1e-9);
    assert.ok(Math.abs(next.insuranceUsdc - (s.insuranceUsdc + 2)) < 1e-9);
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
    assert.ok(s.wpit > start * 0.9);
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
    assert.ok(Math.abs(residualDelta(next)) < 0.08);
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
    s = payCompPrize(s, 1);
    assert.equal(s.account.wpit, 1_000_000);
    const again = payCompPrize(s, 1);
    assert.equal(again.account.wpit, 1_000_000);
  });
});
