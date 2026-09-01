/**
 * Regression suite for the 2026-08-31 quantitative review (issues #20–#28).
 *
 * Every test here pins a number or a behaviour that a reviewer reproduced as
 * wrong. They exist so the same defect cannot drift back in through a
 * "cleanup": constants are compared against hand-computed values, the vol
 * estimator is checked by Monte-Carlo against a KNOWN σ, and the risk gates
 * are checked on the exact inputs that used to fail open.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAD_TO_SIGMA, bsCall, bsPut, ewmaLambda, ewmaRv, RV_HALF_LIFE_MIN } from "./math.ts";
import {
  freeVaultUsdc,
  gammaCash1h,
  haltShortGamma,
  hedgeError99,
  insuranceRatio,
  rejectOption,
  vaultNav,
} from "./risk.ts";
import { initialState, placeDeskOrder, tick, WORKING_ORDER_CAP } from "./engine.ts";
import type { EngineState } from "./types.ts";

// ---------------------------------------------------------------------------
// Deterministic RNG (same LCG the engine uses) so the Monte-Carlo is stable.
// ---------------------------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** GBM path of `bars` one-minute closes at a known annual σ. */
function gbmPath(seed: number, bars: number, sigma: number, start = 4000) {
  const r = rng(seed);
  const dt = 60 / (365.25 * 24 * 3600);
  const out: { t: number; c: number }[] = [];
  let p = start;
  for (let i = 0; i < bars; i++) {
    const u = Math.max(r(), 1e-12);
    const v = Math.max(r(), 1e-12);
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    p *= Math.exp(sigma * Math.sqrt(dt) * n);
    out.push({ t: i * 60_000, c: p });
  }
  return out;
}

function quantile(sorted: number[], q: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

const TRUE_SIGMA = 0.6;
const PATHS = 1500;

describe("M-01 / #20 — realised vol is unbiased for σ", () => {
  it("recovers a KNOWN σ instead of √(2/π)·σ", () => {
    const est: number[] = [];
    for (let i = 0; i < PATHS; i++) est.push(ewmaRv(gbmPath(1000 + i, 300, TRUE_SIGMA)));
    const mean = est.reduce((a, b) => a + b, 0) / est.length;
    const ratio = mean / TRUE_SIGMA;
    // The pre-fix estimator converged to E|r| = σ·√(2/π) ≈ 0.7979σ — a 20.2%
    // understatement that turned `IV = 1.08·rv` into a 13.8% DISCOUNT on a book
    // that is structurally short gamma.
    assert.ok(
      Math.abs(ratio - 1) < 0.03,
      `estimator bias: mean ${mean.toFixed(4)} is ${((ratio - 1) * 100).toFixed(1)}% off σ=${TRUE_SIGMA}`,
    );
    assert.ok(ratio > 0.95, `would have been ~0.798 before the √(π/2) correction (got ${ratio.toFixed(4)})`);
  });

  it("MAD_TO_SIGMA is exactly √(π/2), the inverse of E|r|/σ = √(2/π)", () => {
    assert.ok(Math.abs(MAD_TO_SIGMA - Math.sqrt(Math.PI / 2)) < 1e-12);
    assert.ok(Math.abs(MAD_TO_SIGMA - 1.253314) < 1e-5);
    assert.ok(Math.abs(1 / MAD_TO_SIGMA - 0.797885) < 1e-5, "√(2/π)");
  });

  it("IV = 1.08·rv is a PREMIUM over true σ again, not a discount", () => {
    const est: number[] = [];
    for (let i = 0; i < PATHS; i++) est.push(1.08 * ewmaRv(gbmPath(5000 + i, 300, TRUE_SIGMA)));
    const sorted = [...est].sort((a, b) => a - b);
    const median = quantile(sorted, 0.5);
    assert.ok(median > TRUE_SIGMA, `median quoted IV ${median.toFixed(4)} must exceed σ ${TRUE_SIGMA}`);
  });
});

describe("M-02 / #25 — λ is derived from time, and its limits are documented", () => {
  it("λ = 0.5^(bar/halfLife), independent of the bar interval", () => {
    // Same half-life in minutes must give the same MEMORY IN TIME whether the
    // tape arrives as 1-minute or 1-hour bars — that is the whole point of
    // deriving λ instead of inheriting RiskMetrics' daily-bar constant.
    const halfLifeMin = (lam: number, barSec: number) => (Math.log(0.5) / Math.log(lam)) * barSec / 60;
    const l1m = ewmaLambda(60, 240);
    const l1h = ewmaLambda(3600, 240);
    assert.ok(Math.abs(l1m - Math.pow(0.5, 1 / 240)) < 1e-12, "1-min bars, 4h half-life");
    assert.ok(Math.abs(l1h - Math.pow(0.5, 1 / 4)) < 1e-12, "1-hour bars, same 4h half-life");
    assert.ok(Math.abs(halfLifeMin(l1m, 60) - 240) < 1e-9, "memory is 240 min on 1-min bars");
    assert.ok(Math.abs(halfLifeMin(l1h, 3600) - 240) < 1e-9, "memory is 240 min on 1-hour bars");
    assert.ok(l1h < l1m, "coarser bars decay faster per bar for the same memory in time");
    // The inherited RiskMetrics constant had no such property: λ=0.94 is 17
    // minutes on 1-min bars and 17 DAYS on daily bars.
  });

  it("the default is a stated half-life in MINUTES, not a bare decimal", () => {
    assert.equal(RV_HALF_LIFE_MIN, 240);
  });

  it("the 17-day λ proposed in #25 is rejected: dispersion, measured", () => {
    // Lengthening λ does NOT reduce estimator noise unless the history covers
    // the window. The live feed supplies ~300 one-minute bars (~5 h). Measured
    // p05–p95 spread at σ=0.60 after the √(π/2) correction — this is the
    // evidence for the table in `math.ts` and the reason #25's λ is refused.
    const spread = (halfLifeMin: number) => {
      const v: number[] = [];
      for (let i = 0; i < 400; i++) v.push(ewmaRv(gbmPath(9000 + i, 300, TRUE_SIGMA), halfLifeMin));
      const s = [...v].sort((a, b) => a - b);
      return (quantile(s, 0.95) - quantile(s, 0.05)) / TRUE_SIGMA;
    };
    const proposed = spread(17 * 24 * 60); // #25's 17-day memory
    const chosen = spread(RV_HALF_LIFE_MIN);
    assert.ok(proposed > 2, `17-day λ on 5 h of tape: ${(proposed * 100).toFixed(0)}%σ — unusable`);
    assert.ok(chosen < proposed, `chosen ${(chosen * 100).toFixed(0)}%σ must beat ${(proposed * 100).toFixed(0)}%σ`);
  });
});

describe("M-03 / #24 — hedgeError99 uses the two-sided quantile", () => {
  it("matches a hand-computed value with z = 2.5758, not 2.326", () => {
    const S = 4000;
    const gamma = 10;
    const dt = 1 / (365.25 * 24);
    const dS = S * 0.8 * Math.sqrt(dt) * 2.5758; // two-sided Φ⁻¹(0.995)
    const expected = 0.5 * gamma * dS * dS;
    assert.ok(Math.abs(hedgeError99(S, gamma) - expected) / expected < 1e-6);
  });

  it("is 22.6% larger than the one-sided version it replaced", () => {
    const S = 4000;
    const gamma = 10;
    const dt = 1 / (365.25 * 24);
    const oneSided = 0.5 * gamma * Math.pow(S * 0.8 * Math.sqrt(dt) * 2.3263, 2);
    const ratio = hedgeError99(S, gamma) / oneSided;
    // (2.5758/2.3263)² = 1.2260 — the issue text says "18.4% too low", which is
    // 1 − 1/1.226, i.e. the same understatement read from the other side.
    assert.ok(Math.abs(ratio - 1.226) < 0.001, `ratio ${ratio.toFixed(4)}`);
  });
});

describe("M-04 / #27 — the two gamma metrics state their conventions", () => {
  it("gammaCash1h is exactly 2× the textbook expected gamma cash", () => {
    const S = 4000;
    const gamma = 12.5;
    const sigma = 0.7;
    const dt = 1 / (365.25 * 24);
    const textbook = 0.5 * gamma * S * S * sigma * sigma * dt;
    assert.ok(Math.abs(gammaCash1h(gamma, S, sigma) / textbook - 2) < 1e-9);
  });

  it("the 2× is a deliberate safety factor on GAMMA_NAV, so the cap is unchanged", () => {
    // GAMMA_NAV stays 2% NAV while gammaCash1h returns 2× the textbook number:
    // the Γ cap therefore binds at HALF the documented exposure. Both functions
    // now document this so a later "make them agree" cleanup cannot silently
    // halve the limit.
    const s = initialState();
    const nav = vaultNav(s);
    const bindsAt = (0.02 * nav) / (s.eth * s.eth * s.iv * s.iv * (1 / (365.25 * 24)));
    assert.ok(bindsAt > 0);
    const cap = 0.02 * nav;
    assert.ok(Math.abs(gammaCash1h(bindsAt, s.eth, s.iv) - cap) / cap < 1e-9, "binds exactly at the cap");
    assert.ok(gammaCash1h(bindsAt * 1.000001, s.eth, s.iv) > cap, "just over binds");
    assert.ok(gammaCash1h(bindsAt * 0.99, s.eth, s.iv) < cap, "just under passes");
    // Because the metric is 2× the textbook number, the textbook expected gamma
    // cash at the binding size is HALF the cap — the effective exposure limit is
    // 1% NAV, not the 2% the constant reads as.
    const textbook = 0.5 * bindsAt * s.eth * s.eth * s.iv * s.iv * (1 / (365.25 * 24));
    assert.ok(Math.abs(textbook - cap / 2) / cap < 1e-9);
  });
});

describe("M-05 / #28 — bsPut cannot return NaN", () => {
  it("guards non-finite and non-positive inputs exactly like bsCall", () => {
    const T = 7 / 365;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      assert.equal(bsPut(bad, 4000, T, 0.03, 0.6), 0, `S=${bad}`);
      assert.equal(bsPut(4000, bad, T, 0.03, 0.6), 0, `K=${bad}`);
      assert.equal(bsCall(bad, 4000, T, 0.03, 0.6), 0, `bsCall S=${bad}`);
    }
  });

  it("is finite at expiry too, where the old code returned K−S directly", () => {
    assert.equal(bsPut(Number.NaN, 4000, 0, 0.03, 0.6), 0);
    assert.equal(bsPut(4000, Number.NaN, 0, 0.03, 0.6), 0);
  });

  it("a sane put is still priced correctly", () => {
    const p = bsPut(4000, 4000, 7 / 365, 0.03, 0.6);
    assert.ok(p > 0 && Number.isFinite(p), `ATM put ${p}`);
    // Put-call parity: C − P = S − K·e^(−rT).
    const c = bsCall(4000, 4000, 7 / 365, 0.03, 0.6);
    assert.ok(Math.abs(c - p - (4000 - 4000 * Math.exp(-0.03 * (7 / 365)))) < 1e-9);
  });

  it("vaultNav can never hand a cap a NaN to compare against", () => {
    const s = initialState();
    assert.ok(Number.isFinite(vaultNav(s)));
    // Every comparison against NaN is false, which would disarm the Γ, ν and
    // insurance caps at once. insuranceRatio also fails closed on a non-finite
    // NAV rather than reporting full cover.
    assert.equal(insuranceRatio({ ...s, insuranceUsdc: Number.NaN }), 0);
    assert.ok(haltShortGamma({ ...s, insuranceUsdc: Number.NaN }));
  });
});

describe("M-06 / #21 — an insolvent vault reports ZERO cover, not full cover", () => {
  it("insuranceRatio is 0 and haltShortGamma is true when NAV <= 0", () => {
    const s: EngineState = {
      ...initialState(),
      vault: { eth: 0, usdc: 0, reservedEth: 0, reservedUsdc: 0, hedgeEth: 0, escrowUsdc: 0 },
      insuranceUsdc: 0,
    };
    assert.ok(vaultNav(s) <= 0, `nav ${vaultNav(s)}`);
    assert.equal(insuranceRatio(s), 0, "0 means no cover; the old code returned 1 = fully insured");
    assert.ok(haltShortGamma(s), "must halt — the old code kept writing short gamma");
  });

  it("agrees with DealerVault.haltShortGamma() on the failure case", () => {
    // The Solidity contract fails closed: `if (nav == 0) return true`. Two
    // implementations of one safety rule must not contradict each other on the
    // case that matters most.
    const insolvent: EngineState = {
      ...initialState(),
      vault: { eth: 1, usdc: 0, reservedEth: 0, reservedUsdc: 0, hedgeEth: 0, escrowUsdc: 0 },
      insuranceUsdc: 0,
    };
    insolvent.eth = -1e9; // force NAV negative
    assert.ok(vaultNav(insolvent) < 0, `nav ${vaultNav(insolvent)}`);
    assert.equal(insuranceRatio(insolvent), 0, "engine: no cover");
    assert.ok(haltShortGamma(insolvent), "engine: halt — Solidity returns true here too");
  });

  it("a healthy vault still reports its real ratio", () => {
    const s = initialState();
    const r = insuranceRatio(s);
    assert.ok(r > 0 && r < 1, `ratio ${r}`);
    assert.ok(!haltShortGamma(s));
  });
});

describe("M-07 / #23 — trader escrow cannot cash-secure a house put", () => {
  const withEscrow = (escrow: number): EngineState => {
    const s = initialState();
    return {
      ...s,
      vault: { ...s.vault, usdc: 10_000_000, reservedUsdc: 0, escrowUsdc: escrow },
      insuranceUsdc: 500_000,
    };
  };

  it("freeVaultUsdc subtracts reserved AND escrow — one definition", () => {
    assert.equal(freeVaultUsdc(withEscrow(9_999_000)), 1_000);
    assert.equal(freeVaultUsdc(withEscrow(0)), 10_000_000);
  });

  it("rejects a put the house cannot actually cover", () => {
    // 10,000,000 vault USDC of which 9,999,000 is TRADER MARGIN: only 1,000 is
    // deployable, so a 4,000 USDC cash-secure lock must be refused. The old
    // gate checked `usdc − reservedUsdc` and ACCEPTED it.
    const s = withEscrow(9_999_000);
    const why = rejectOption(s, "put", 4000, s.clock + 7 * 86_400_000, 1, 0, 0);
    assert.equal(typeof why, "string", "must reject");
    assert.match(String(why), /cash-secure/i);
  });

  it("accepts the same put once the escrow is the house's own cash", () => {
    const s = withEscrow(0);
    const why = rejectOption(s, "put", 4000, s.clock + 7 * 86_400_000, 1, 0, 0);
    assert.equal(why, null, String(why));
  });
});

describe("M-08 / #22 — a limit binds the realised average, not just the trigger", () => {
  it("a buy limit partial-fills at the limit instead of overpaying 25%", () => {
    // The reviewer's repro: BUY LIMIT @4000 for 500 ETH against 2,500 ETH of
    // depth filled at an average of 5,015.05. We use a limit above the mark so
    // a partial is possible, and assert on the realised average.
    const s0: EngineState = { ...initialState(), account: { ...initialState().account, usdc: 500_000 } };
    const filled = placeDeskOrder(s0, {
      product: "spot",
      poolId: "ETH-USDC",
      side: "buy",
      kind: "lmt",
      tif: "ioc",
      qty: 500, // the reviewer's size
      limit: 4100,
    });
    assert.equal(typeof filled, "object", String(filled));
    const s = filled as EngineState;
    const fill = s.fills[0]!;
    assert.ok(fill.size > 0 && fill.size < 500, `partial fill ${fill.size.toFixed(2)} of 500`);
    const spent = 500_000 - s.account.usdc;
    const avg = spent / fill.size;
    assert.ok(avg <= 4100 + 1e-6, `realised average ${avg.toFixed(2)} must respect the 4100 limit`);
    assert.ok(avg > s0.eth, "still pays above the mark, as a taker must");
    // The uncorrected engine took all 500 ETH at an average of 5,015.05 — 25.4%
    // through the limit. Prove the old behaviour would have breached it.
    const pool = s0.pools["ETH-USDC"]!;
    const f = 1 - pool.feeBps / 10_000;
    const oldAvg = pool.quoteReserve / (f * (pool.baseReserve - 500));
    assert.ok(oldAvg > 5000, `uncorrected average would be ${oldAvg.toFixed(2)}`);
    assert.ok(oldAvg > 4100, "…which is why the limit has to bind on the average");
  });

  it("a limit the book cannot honour at ANY size is rejected, not overfilled", () => {
    const s0: EngineState = { ...initialState(), account: { ...initialState().account, usdc: 500_000 } };
    const r = placeDeskOrder(s0, {
      product: "spot",
      poolId: "ETH-USDC",
      side: "buy",
      kind: "lmt",
      tif: "ioc",
      qty: 100,
      limit: 4000, // == the pool mark: any fill prints above it
    });
    assert.equal(typeof r, "string", "must reject");
    assert.match(String(r), /Limit not met/i);
  });

  it("a resting limit only executes once the market reaches it", () => {
    let s: EngineState = { ...initialState(), account: { ...initialState().account, usdc: 500_000 } };
    const placed = placeDeskOrder(s, {
      product: "spot",
      poolId: "ETH-USDC",
      side: "buy",
      kind: "lmt",
      tif: "gtc",
      qty: 5,
      limit: 3000,
    });
    assert.equal(typeof placed, "object", String(placed));
    s = placed as EngineState;
    assert.equal(s.working.length, 1, "rests while the market is above the limit");
    const crossed = tick({ ...s, eth: 2900 }, 60);
    assert.equal(crossed.working.length, 0, "fills once the market trades through");
    assert.ok(crossed.fills.length > 0);
  });
});

describe("M-09 / #26 — resting orders keep time priority and are never dropped", () => {
  const rest = (s: EngineState, limit: number) =>
    placeDeskOrder(s, {
      product: "spot",
      poolId: "ETH-USDC",
      side: "buy",
      kind: "lmt",
      tif: "gtc",
      qty: 1,
      limit,
    }) as EngineState;

  it("appends, so the OLDEST order is matched first", () => {
    let s: EngineState = { ...initialState(), account: { ...initialState().account, usdc: 10_000_000 } };
    const first = 3000;
    s = rest(s, first);
    s = rest(s, 2999);
    s = rest(s, 2998);
    assert.equal(s.working.length, 3);
    assert.equal(s.working[0]!.limit, first, "oldest at the head — was newest-first");
    // Cross all three at once: matchWorking iterates in list order, so the
    // first fill must be the oldest order.
    const crossed = tick({ ...s, eth: 2900 }, 60);
    assert.ok(crossed.fills.length >= 1);
    assert.equal(crossed.working.length, 0, "all three were crossable");
  });

  it(`rejects order ${WORKING_ORDER_CAP + 1} instead of silently evicting the oldest`, () => {
    let s: EngineState = { ...initialState(), account: { ...initialState().account, usdc: 10_000_000 } };
    for (let i = 0; i < WORKING_ORDER_CAP; i++) s = rest(s, 3000 - i);
    assert.equal(s.working.length, WORKING_ORDER_CAP);
    const oldest = s.working[0]!.id;
    const rejected = placeDeskOrder(s, {
      product: "spot",
      poolId: "ETH-USDC",
      side: "buy",
      kind: "lmt",
      tif: "gtc",
      qty: 1,
      limit: 2000,
    });
    assert.equal(typeof rejected, "string", "the 41st must be refused");
    assert.match(String(rejected), /Working order limit/);
    const after = s; // unchanged — placeDeskOrder returned an error string
    assert.equal(after.working.length, WORKING_ORDER_CAP, "all 40 survive");
    assert.equal(after.working[0]!.id, oldest, "the oldest resting order was not evicted");
  });
});

/* ------------------------------------------------------------------ *
 * CANDLE_LIMITS permanent fix — vol history and the quality gate
 * ------------------------------------------------------------------ */

import {
  ewmaRvAdaptive,
  halfLifeForHistory,
  rvQuality,
  RV_HALF_LIFE_DEEP_MIN,
  RV_PRIOR,
  RV_MIN_BARS,
} from "./math.ts";

/** A GBM series of `bars` bars at `barSec` spacing, known annual sigma.
 *  Seeded (same LCG as `gbmPath` above): the "unbiased on a deep series"
 *  assertion is a ±15% band on an estimate whose sampling noise is ~±9%, so
 *  an UNSEEDED draw fails a few percent of runs — a flake, not a signal. A
 *  fixed seed makes the test pin one representative draw; callers that need
 *  independent draws (the dispersion comparison) pass their own seeds. */
function gbm(bars: number, barSec: number, sigma = TRUE_SIGMA, s0 = 4000, seed = 0xc0ffee) {
  const r = rng(seed);
  const out: { t: number; c: number }[] = [];
  let s = s0;
  const dt = barSec / (365.25 * 24 * 3600);
  out.push({ t: 0, c: s });
  for (let i = 1; i < bars; i++) {
    let u = 0;
    let v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    s *= Math.exp(-0.5 * sigma * sigma * dt + sigma * Math.sqrt(dt) * z);
    out.push({ t: i * barSec * 1000, c: s });
  }
  return out;
}

describe("CANDLE_LIMITS — a flat series must not read as low vol", () => {
  it("flags a flat series instead of estimating from it", () => {
    const flat = Array.from({ length: 60 }, (_, i) => ({
      t: i * 60_000,
      c: 4000,
    }));
    const q = rvQuality(flat);
    assert.equal(q.ok, false);
    assert.equal(q.reason, "flat-series");
    assert.equal(q.distinct, 1, "one distinct close carries no information");
    // The regression that mattered: this used to return 0.15, the clamp floor,
    // so a dead feed priced options at IV 0.28 on a short-gamma book.
    assert.equal(ewmaRv(flat), RV_PRIOR);
    assert.notEqual(ewmaRv(flat), 0.15, "must not fall through to the floor");
  });

  it("flags a too-short series", () => {
    const q = rvQuality(gbm(RV_MIN_BARS - 1, 3600));
    assert.equal(q.ok, false);
    assert.equal(q.reason, "too-few-bars");
    assert.equal(ewmaRv(gbm(3, 3600)), RV_PRIOR);
  });

  it("flags a series with no usable positive closes", () => {
    const bad = Array.from({ length: 20 }, (_, i) => ({ t: i * 60_000, c: 0 }));
    const q = rvQuality(bad);
    assert.equal(q.ok, false);
    assert.equal(q.reason, "no-positive-closes");
  });

  it("accepts a real series and reports what it had", () => {
    const c = gbm(1000, 3600);
    const q = rvQuality(c);
    assert.equal(q.ok, true);
    assert.equal(q.reason, "ok");
    assert.equal(q.bars, 1000);
    assert.equal(q.barSec, 3600);
    assert.ok(Math.abs(q.spanHours - 999) < 1, `span was ${q.spanHours}`);
  });
});

describe("CANDLE_LIMITS — half-life is chosen from the history in hand", () => {
  it("keeps the shallow 4 h memory for a short series", () => {
    assert.equal(halfLifeForHistory(5), RV_HALF_LIFE_MIN);
    assert.equal(halfLifeForHistory(100), RV_HALF_LIFE_MIN);
  });

  it("uses 12 h in the middle regime", () => {
    assert.equal(halfLifeForHistory(120), 720);
    assert.equal(halfLifeForHistory(700), 720);
  });

  it("only uses the 24 h memory once history actually supports it", () => {
    assert.equal(halfLifeForHistory(720), RV_HALF_LIFE_DEEP_MIN);
    assert.equal(halfLifeForHistory(1000), RV_HALF_LIFE_DEEP_MIN);
    // The point of the whole fix: a deep series makes the long memory safe.
    // On ~5 h of tape the same memory reads 206% of true sigma.
    assert.ok(RV_HALF_LIFE_DEEP_MIN > RV_HALF_LIFE_MIN);
  });

  it("estimates unbiasedly from a deep 1h series with the adaptive memory", () => {
    const est = ewmaRvAdaptive(gbm(1000, 3600));
    assert.equal(est.quality.ok, true);
    assert.equal(est.quality.barSec, 3600);
    const ratio = est.rv / TRUE_SIGMA;
    assert.ok(
      ratio > 0.85 && ratio < 1.15,
      `adaptive rv/sigma = ${ratio.toFixed(4)} on 1000x1h, expected ~1`,
    );
  });

  it("is measurably tighter on a deep series than on 5 h of tape", () => {
    // The claim the fix rests on: same estimator, more history -> less noise.
    const runs = 120;
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    const shallow: number[] = [];
    const deep: number[] = [];
    for (let i = 0; i < runs; i++) {
      // Distinct seeds per run — the dispersion claim needs independent draws.
      shallow.push(ewmaRvAdaptive(gbm(300, 60, TRUE_SIGMA, 4000, 1_000 + i)).rv / TRUE_SIGMA);
      deep.push(ewmaRvAdaptive(gbm(1000, 3600, TRUE_SIGMA, 4000, 50_000 + i)).rv / TRUE_SIGMA);
    }
    const sdDeep = sd(deep);
    const sdShallow = sd(shallow);
    assert.ok(
      sdDeep < sdShallow,
      `deep sd ${sdDeep.toFixed(4)} should beat shallow sd ${sdShallow.toFixed(4)}`,
    );
  });

  it("returns the prior, not a number, when the series is degenerate", () => {
    const est = ewmaRvAdaptive(
      Array.from({ length: 60 }, (_, i) => ({ t: i * 3600_000, c: 4000 })),
    );
    assert.equal(est.quality.ok, false);
    assert.equal(est.rv, RV_PRIOR);
  });
});
