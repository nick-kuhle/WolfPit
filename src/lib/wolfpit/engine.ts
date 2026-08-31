import { PIT_OPEN } from "./comp";
import {
  DERIV_FEE,
  DERIV_UNDERS,
  FUT_IM,
  INSURANCE_SEED,
  MINI_ETH,
  PoolId,
  STAKE_APR,
  START_ETH,
  START_USDC,
  START_WPIT,
  UTIL_CAP,
  WPIT_EMIT_PER_SEC,
  type EngineState,
  type FutSide,
  type OptType,
  type WorkingOrder,
} from "./types";
import {
  ammOut,
  bsCall,
  bsDelta,
  bsGamma,
  bsPut,
  bsVega,
  clamp,
  ewmaRv,
  ivSmile,
  monthEnd,
  nextFriday,
  uid,
  yearsTo,
} from "./math";
import {
  maybeCircuit,
  CIRCUIT_MS,
  freeVaultUsdc,
  rejectFuture,
  rejectOption,
  smileVol,
  spotFeeBps,
  vaultNav,
  imRate,
  poolDepth,
} from "./risk";

// Moved to risk.ts (F12): the reject path charges the same IM slope as the fill.
export { imRate } from "./risk";
import {
  APY_TVL_FLOOR,
  EMIT_PX_CAP,
  MAX_FARM_APY,
  MAX_LOT,
  MAX_NOTIONAL_USD,
  MAX_POOL_FRAC,
  MIN_IM_USD,
  WPIT_PX_MAX,
  WPIT_PX_MIN,
  requireFinitePositive,
  requireMoney,
} from "./limits";
import { ETH_MAX, ETH_MIN, ORACLE_JUMP } from "./sanitize";
import { emptyGames, ensureRaces, refundOpenBets, settleGames } from "./games";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function nrand(r: () => number) {
  const u = Math.max(r(), 1e-12);
  const v = Math.max(r(), 1e-12);
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const T0 = Date.UTC(2026, 7, 25, 20, 0, 0);

export function initialState(now = T0): EngineState {
  const eth = 4000;
  const wpit = 0.087;
  return {
    clock: now,
    eth,
    ethBid: eth,
    ethAsk: eth,
    wpit,
    btc: 0,
    liveAt: 0,
    liveSource: "sim-fallback",
    iv: 0.62,
    realizedVol: 0.55,
    candles: seedCandles(now, eth, "eth"),
    wpitCandles: seedCandles(now, wpit, "wpit"),
    account: {
      usdc: START_USDC,
      eth: START_ETH,
      wpit: START_WPIT,
      tokens: {},
      realized: 0,
      startEquity: START_USDC + START_ETH * eth + START_WPIT * wpit,
    },
    vault: {
      eth: 100,
      usdc: 400_000,
      reservedEth: 0,
      reservedUsdc: 0,
      hedgeEth: 0,
      escrowUsdc: 0,
    },
    pools: {
      "ETH-USDC": {
        id: "ETH-USDC",
        base: "ETH",
        quote: "USDC",
        // Depth models the *aggregated* external WETH/USDC book the desk routes
        // to (DEX aggregator), not house liquidity. House liquidity = 0 at launch.
        baseReserve: 2_500,
        quoteReserve: 2_500 * eth,
        lpSupply: 2_500,
        feeBps: 30,
      },
      "WPIT-USDC-TEST": {
        id: "WPIT-USDC-TEST",
        base: "WPIT",
        quote: "USDC",
        baseReserve: 2_000_000,
        quoteReserve: 2_000_000 * wpit,
        lpSupply: 2_000_000,
        feeBps: 30,
      },
      "WPIT-ETH-TEST": {
        id: "WPIT-ETH-TEST",
        base: "WPIT",
        quote: "ETH",
        baseReserve: 500_000,
        quoteReserve: (500_000 * wpit) / eth,
        lpSupply: 500_000,
        feeBps: 30,
      },
    },
    lp: [],
    stake: { amount: 0, since: now },
    futures: [],
    options: [],
    fills: [],
    working: [],
    farmWpit: 0,
    harvestedWpit: 0,
    insuranceUsdc: INSURANCE_SEED,
    circuitUntil: 0,
    simSpeed: 1,
    liquidations: 0,
    equityTape: [{ t: now, o: START_USDC + START_ETH * eth + START_WPIT * wpit, h: START_USDC + START_ETH * eth + START_WPIT * wpit, l: START_USDC + START_ETH * eth + START_WPIT * wpit, c: START_USDC + START_ETH * eth + START_WPIT * wpit, v: 1 }],
    compJoined: false,
    compPaid: false,
    games: emptyGames(),
  };
}

function seedCandles(now: number, px: number, kind: "eth" | "wpit") {
  const r = rng(kind === "eth" ? 0x0c0ffee : 0x0b00b1e);
  const out = [];
  let p = kind === "wpit" ? px * 0.18 : px * 0.985;
  const vol = kind === "eth" ? 0.008 : 0.03;
  for (let i = 180; i >= 0; i--) {
    const t = now - i * 60_000;
    let n: number;
    if (kind === "wpit") {
      n = r() < 0.9 ? 0.006 + r() * 0.018 : -(0.002 + r() * 0.01);
    } else {
      n = nrand(r) * vol;
    }
    const o = p;
    const c = Math.max(0.0001, p * (1 + n));
    const h = Math.max(o, c) * (1 + r() * vol * 0.35);
    const l = Math.min(o, c) * (1 - r() * vol * 0.35);
    out.push({ t, o, h, l, c, v: 20 + r() * 80 });
    p = c;
  }
  out[out.length - 1]!.c = px;
  out[out.length - 1]!.h = Math.max(out[out.length - 1]!.h, px);
  out[out.length - 1]!.l = Math.min(out[out.length - 1]!.l, px);
  return out;
}

function moonWpit(px: number, clock: number, dtSec: number) {
  const dt = Math.min(Math.max(dtSec, 0), 60);
  const r = rng(0x51a7e ^ (((clock / 1000) | 0) * 2654435761));
  const mu = 0.18 / 3600;
  const sig = 0.12 / Math.sqrt(3600);
  let ret = mu * dt + sig * Math.sqrt(dt) * (r() * 2 - 1);
  if (r() < 0.012) ret -= 0.002;
  return clamp(px * Math.exp(ret), WPIT_PX_MIN, WPIT_PX_MAX);
}

export function tick(s: EngineState, dtSec: number): EngineState {
  // Clock advances by the full simulated step (1×/10×/60×), capped at 120s per
  // tick so a stalled tab cannot teleport the sim. Stochastic per-step moves
  // (moonWpit) scale internally with sqrt(dt), so only the clock needs the cap.
  const dt = clamp(dtSec, 0, 120);
  const next = { ...s, account: { ...s.account }, vault: { ...s.vault }, pools: { ...s.pools } };
  next.clock = s.liveAt > 0 ? Date.now() : s.clock + dt * 1000;
  next.wpit = moonWpit(s.wpit, next.clock, dt);
  // Re-pin the WPIT pools k-conservingly (F7): the old quoteReserve = base·mark
  // rewrite broke x·y = k and destroyed/minted LP value every tick.
  const pool = s.pools["WPIT-USDC-TEST"];
  if (pool && pool.baseReserve > 0) {
    next.pools["WPIT-USDC-TEST"] = repinPool(pool, next.wpit);
  }
  const ethPoolWpit = s.pools["WPIT-ETH-TEST"];
  if (ethPoolWpit && ethPoolWpit.baseReserve > 0 && next.eth > 0) {
    next.pools["WPIT-ETH-TEST"] = repinPool(ethPoolWpit, next.wpit / next.eth);
  }
  next.wpitCandles = pushCandle(s.wpitCandles, next.clock, next.wpit);

  const u = utilEth(next);
  const emit = WPIT_EMIT_PER_SEC * dt * (0.3 + 0.7 * u);
  next.farmWpit = s.farmWpit + emit * 0.9;
  next.insuranceUsdc = (s.insuranceUsdc ?? INSURANCE_SEED) + emit * 0.1 * next.wpit;
  const ethPool = s.pools["ETH-USDC"];
  if (ethPool) {
    next.pools["ETH-USDC"] = { ...ethPool, feeBps: spotFeeBps(next.realizedVol) };
  }
  if (s.stake.amount > 0) {
    next.account = {
      ...next.account,
      wpit: next.account.wpit + (s.stake.amount * STAKE_APR * dt) / (365.25 * 24 * 3600),
    };
  }
  return matchWorking(pushEquity(arbToSpot(hedgeDelta(rebalanceWeights(settleAndLiq(maybeCircuit(settleGames(ensureRaces(next)))))))));
}

export function applyLive(
  s: EngineState,
  feed: {
    eth: number;
    candles: EngineState["candles"];
    btc?: number;
    at: number;
    source: string;
    ethBid?: number;
    ethAsk?: number;
  },
): EngineState {
  if (!(feed.eth > 0) || !Number.isFinite(feed.eth)) return s;
  let eth = clamp(feed.eth, ETH_MIN, ETH_MAX);
  let circuitUntil = s.circuitUntil ?? 0;
  if (s.liveAt > 0 && s.eth > 0) {
    const lo = s.eth * (1 - ORACLE_JUMP);
    const hi = s.eth * (1 + ORACLE_JUMP);
    if (eth < lo || eth > hi) {
      eth = clamp(eth, lo, hi);
      circuitUntil = Math.max(circuitUntil, (feed.at || s.clock) + 15 * 60 * 1000);
    }
  }
  const rv = ewmaRv(feed.candles);
  const next: EngineState = {
    ...s,
    eth,
    ethBid: clamp(feed.ethBid && feed.ethBid > 0 ? feed.ethBid : eth, ETH_MIN, ETH_MAX),
    ethAsk: clamp(feed.ethAsk && feed.ethAsk > 0 ? feed.ethAsk : eth, ETH_MIN, ETH_MAX),
    btc: feed.btc ?? s.btc,
    candles: feed.candles,
    realizedVol: clamp(rv, 0.15, 2),
    iv: clamp(1.08 * rv, 0.28, 1.6),
    clock: feed.at,
    liveAt: feed.at,
    liveSource: feed.source,
    circuitUntil,
    account: {
      ...s.account,
      startEquity: s.liveAt === 0 ? START_USDC + START_ETH * eth : s.account.startEquity,
    },
  };
  return matchWorking(pushEquity(arbToSpot(hedgeDelta(rebalanceWeights(refreshQuotes(settleAndLiq(maybeCircuit(next))))))));
}

function pushCandle(candles: EngineState["candles"], t: number, px: number) {
  const bucket = Math.floor(t / 60_000) * 60_000;
  const copy = candles.slice(-240);
  const last = copy[copy.length - 1];
  if (!last || last.t !== bucket) {
    copy.push({ t: bucket, o: px, h: px, l: px, c: px, v: 1 });
  } else {
    last.h = Math.max(last.h, px);
    last.l = Math.min(last.l, px);
    last.c = px;
    last.v += 1;
  }
  return copy;
}

export const BAR_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
} as const;

export function synthCandles(px: number, intervalMs: number, now: number, seed = 1, moon = false) {
  const n = 96;
  const r = rng((seed >>> 0) ^ (intervalMs >>> 0));
  const vol = moon ? 0.028 : 0.01;
  let p = moon ? Math.max(px * 0.12, 1e-6) : px * 0.96;
  const out: EngineState["candles"] = [];
  const bucket = Math.floor(now / intervalMs) * intervalMs;
  for (let i = n - 1; i >= 0; i--) {
    const t = bucket - i * intervalMs;
    const ret = moon ? (r() < 0.9 ? 0.005 + r() * 0.028 : -(0.002 + r() * 0.01)) : nrand(r) * vol;
    const o = p;
    const c = i === 0 ? px : Math.max(px * 0.04, o * (1 + ret));
    const h = Math.max(o, c) * (1 + r() * vol * 0.45);
    const l = Math.max(1e-8, Math.min(o, c) * (1 - r() * vol * 0.45));
    out.push({ t, o, h, l, c, v: 8 + r() * 80 });
    p = c;
  }
  return out;
}

/**
 * Display-only mark-to-market of the whole player book, INCLUDING WPIT at the
 * sim price (so emissions/stake yields appear here). No risk cap is enforced
 * on this number — caps run off `vaultNav` (see docs/RISK.md §equity vs
 * vault NAV vs emissions).
 */
export function equity(s: EngineState) {
  const spot = s.account.usdc + s.account.eth * s.eth + s.account.wpit * s.wpit;
  const extras = Object.entries(s.account.tokens ?? {}).reduce((a, [k, v]) => a + v * tokenPx(s, k), 0);
  const fut = s.futures.reduce((a, p) => a + p.margin + futPnl(p, markOf(s, p.under ?? "ETH")), 0);
  const opt = s.options.reduce((a, p) => a + optMark(s, p) * p.sizeEth, 0);
  const lpVal = s.lp.reduce((a, p) => a + lpValue(s, p.poolId, p.shares), 0);
  const tickets = (s.games?.bets ?? []).filter((b) => b.status === "open").reduce((a, b) => a + b.stake, 0);
  return spot + extras + fut + opt + lpVal + s.stake.amount * s.wpit + tickets * s.wpit;
}

export function pushEquity(s: EngineState): EngineState {
  const eq = equity(s);
  return { ...s, equityTape: pushCandle(s.equityTape ?? [], s.clock, eq) };
}

export function dayPnl(s: EngineState) {
  const eq = equity(s);
  const day = new Date(s.clock);
  day.setUTCHours(0, 0, 0, 0);
  const start = day.getTime();
  const tape = s.equityTape ?? [];
  // First candle recorded at/after the UTC day boundary is the day's opening
  // equity. (tape is chronological; scanning forward from the front is correct.)
  const first = tape.find((c) => c.t >= start) ?? tape[0];
  if (!first) return eq - s.account.startEquity;
  return eq - first.c;
}

export function liqHealth(s: EngineState) {
  if (s.futures.length === 0) return { label: "CLEAR", score: 2, tone: "up" as const };
  let worst = 99;
  for (const p of s.futures) {
    const mark = markOf(s, p.under ?? "ETH");
    const eq = p.margin + futPnl(p, mark);
    const maint = futMaint(p, mark);
    worst = Math.min(worst, eq / Math.max(maint, 1e-9));
  }
  if (worst < 1.05) return { label: "LIQ", score: worst, tone: "down" as const };
  if (worst < 1.4) return { label: "TIGHT", score: worst, tone: "warn" as const };
  return { label: "SOLID", score: worst, tone: "up" as const };
}

export function joinCompetition(s: EngineState, now = Date.now()): EngineState {
  let cur = refundOpenBets(s);
  for (const p of [...s.lp]) {
    const r = removeLiquidity(cur, p.poolId, p.shares);
    if (typeof r !== "string") cur = r;
  }
  cur = unstakeWpit(cur);
  for (const f of [...cur.futures]) {
    const r = closeFuture(cur, f.id);
    if (typeof r !== "string") cur = r;
  }
  for (const o of [...cur.options]) {
    const r = closeOption(cur, o.id);
    if (typeof r !== "string") cur = r;
  }
  const eq0 = PIT_OPEN.entryUsdc;
  return {
    ...cur,
    account: {
      usdc: PIT_OPEN.entryUsdc,
      eth: 0,
      wpit: 0,
      tokens: {},
      realized: 0,
      startEquity: eq0,
    },
    futures: [],
    options: [],
    working: [],
    fills: [],
    lp: [],
    stake: { amount: 0, since: now },
    farmWpit: 0,
    equityTape: [{ t: now, o: eq0, h: eq0, l: eq0, c: eq0, v: 1 }],
    clock: now,
    compJoined: true,
    compPaid: false,
  };
}

export function payCompPrize(s: EngineState, place: number, now = Date.now()): EngineState {
  if (s.compPaid || !s.compJoined) return s;
  if (now < PIT_OPEN.end) return s;
  if (place < 1 || place > 3) return { ...s, compPaid: true };
  const amt = PIT_OPEN.prize.find((p) => p.place === place)?.wpit ?? 0;
  return {
    ...s,
    compPaid: true,
    account: { ...s.account, wpit: s.account.wpit + amt },
  };
}

export function futPnl(p: EngineState["futures"][number], mark: number) {
  const dir = p.side === "long" ? 1 : -1;
  return dir * (mark - p.entry) * p.sizeEth;
}

export function optMark(s: EngineState, p: EngineState["options"][number]) {
  const spot = markOf(s, p.under ?? "ETH");
  const T = yearsTo(p.expiry, s.clock);
  const vol = ivSmile(s.iv, spot, p.strike, T);
  return p.type === "call" ? bsCall(spot, p.strike, T, 0.03, vol) : bsPut(spot, p.strike, T, 0.03, vol);
}

export function lpValue(s: EngineState, id: PoolId, shares: number) {
  const pool = s.pools[id];
  if (!pool || pool.lpSupply <= 0) return 0;
  const frac = shares / pool.lpSupply;
  return frac * poolTvl(s, id);
}

export function poolTvl(s: EngineState, id: PoolId) {
  const pool = s.pools[id];
  if (!pool) return 0;
  return pool.quoteReserve * tokenPx(s, pool.quote) + pool.baseReserve * tokenPx(s, pool.base);
}

export function farmPending(s: EngineState, id: PoolId) {
  const pos = s.lp.find((p) => p.poolId === id);
  const pool = s.pools[id];
  if (!pos || !pool || pool.lpSupply <= 0 || !(s.farmWpit > 0)) return 0;
  const frac = clamp(pos.shares / pool.lpSupply, 0, 1);
  return s.farmWpit * farmShare(s, id) * frac;
}

export function harvestDue(s: EngineState) {
  if (!(s.farmWpit > 0)) return 0;
  let due = 0;
  for (const p of s.lp) due += farmPending(s, p.poolId);
  return Math.min(Math.max(0, due), s.farmWpit);
}

export function lpPnl(s: EngineState, pos: EngineState["lp"][number]) {
  const now = lpValue(s, pos.poolId, pos.shares);
  const cost = pos.costUsdc ?? now;
  return now - cost + farmPending(s, pos.poolId) * s.wpit;
}

export function farmShare(s: EngineState, id: PoolId) {
  // FARM.md gauge table: dealer vault 70% (not an AMM gauge — accrues to vault
  // LPs), WPIT/USDC 20%, WPIT/ETH 10%, ETH/USDC 0% ("already paid in swap
  // fees; do not bribe directional ETH"). Custom pools earn nothing in v1.
  void s;
  if (id === "WPIT-USDC" || id === "WPIT-USDC-TEST") return 0.2;
  if (id === "WPIT-ETH" || id === "WPIT-ETH-TEST") return 0.1;
  return 0;
}

export function farmApy(s: EngineState, id: PoolId) {
  const tvl = Math.max(poolTvl(s, id), APY_TVL_FLOOR);
  const u = 0.3 + 0.7 * clamp(utilEth(s), 0, 1);
  const emitPx = clamp(s.wpit, 0.01, EMIT_PX_CAP);
  const usdYear = WPIT_EMIT_PER_SEC * 0.9 * u * 365.25 * 86400 * emitPx;
  const volAdj = 1 + Math.min(0.4, s.realizedVol);
  const raw = (usdYear * farmShare(s, id) * volAdj) / tvl;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, MAX_FARM_APY);
}

export function tokenPx(s: EngineState, sym: string) {
  if (sym === "USDC") return 1;
  if (sym === "ETH") return s.eth;
  if (sym === "WPIT") return s.wpit;
  const vsUsdc = Object.values(s.pools).find((p) => p.base === sym && p.quote === "USDC");
  if (vsUsdc && vsUsdc.baseReserve > 0) return vsUsdc.quoteReserve / vsUsdc.baseReserve;
  const vsEth = Object.values(s.pools).find((p) => p.base === sym && p.quote === "ETH");
  if (vsEth && vsEth.baseReserve > 0) return (vsEth.quoteReserve / vsEth.baseReserve) * s.eth;
  return 0;
}

export function markOf(s: EngineState, under = "ETH") {
  const px = tokenPx(s, under);
  if (px > 0) return px;
  if (under === "ETH") return s.eth;
  return 0;
}

export function miniQty(under = "ETH") {
  if (under === "ETH") return MINI_ETH;
  if (under === "WPIT") return 10;
  return 1;
}

/** M-09 / #26: hard cap on resting orders — the 41st is rejected, not evicted. */
export const WORKING_ORDER_CAP = 40;

function quoteTick(spot: number) {
  if (spot >= 100) return 0.4;
  if (spot >= 5) return 0.02;
  if (spot >= 1) return 0.005;
  return Math.max(spot * 0.002, 0.00005);
}

export function strikeGrid(spot: number) {
  let step = 0.005;
  if (spot >= 500) step = 100;
  else if (spot >= 50) step = 5;
  else if (spot >= 5) step = 0.5;
  else if (spot >= 1) step = 0.05;
  else if (spot >= 0.2) step = 0.01;
  const atm = Math.round(spot / step) * step;
  const round = (n: number) => Number((Math.round(n / step) * step).toPrecision(10));
  return [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => round(atm + i * step)).filter((k) => k > 0);
}
/** M-07 / #23: single definition of deployable house cash — see `risk.freeVaultUsdc`. */
function freeUsdc(s: EngineState) {
  return freeVaultUsdc(s);
}

function listedUnder(under: string) {
  const u = (under || "ETH").toUpperCase();
  return (DERIV_UNDERS as readonly string[]).includes(u);
}
function utilEth(s: EngineState) {
  return s.vault.eth <= 0 ? 1 : s.vault.reservedEth / s.vault.eth;
}

function maxNetLongEth(s: EngineState) {
  return Math.max(0, s.vault.eth * UTIL_CAP - s.vault.reservedEth);
}
function maxNetShortEth(s: EngineState) {
  // M-07 / #23: parity with risk.remainingCap — trader escrow cannot fund the
  // house short book, so the α headroom is measured against deployable cash.
  const deployable = Math.min(s.vault.usdc * UTIL_CAP, freeUsdc(s) + s.vault.reservedUsdc);
  return Math.max(0, (deployable - s.vault.reservedUsdc) / s.eth);
}

export function spreadBps(s: EngineState) {
  // MM.md futures quote stack:
  //   s_bps = 8 + 80·util + 40·(IV − 0.40) + 25·|Δ_book| / vault.ETH
  const inv = Math.abs(bookGreeks(s).delta) / Math.max(s.vault.eth, 1e-6);
  return clamp(8 + 80 * utilEth(s) + 40 * (s.iv - 0.4) + 25 * inv, 8, 280);
}

export function reservationPx(s: EngineState) {
  // Avellaneda–Stoikov, discrete (MM.md): r = F − q·γ·σ²·τ with
  // γ = 0.1 / vault.ETH (smaller vault → wider shift), τ = 2 minutes,
  // σ = RV annualized in *dollars* per ETH. Inventory q is the vault's signed
  // book delta in ETH (unnormalized), so the shift scales with absolute risk.
  const q = bookGreeks(s).delta;
  const gamma = 0.1 / Math.max(s.vault.eth, 1e-6);
  const tau = 2 / (365.25 * 24 * 60);
  const sigmaUsd = Math.max(s.realizedVol, 0.05) * s.eth;
  const shift = clamp(q * gamma * sigmaUsd * sigmaUsd * tau, -s.eth * 0.005, s.eth * 0.005);
  return s.eth - shift;
}

export function refreshQuotes(s: EngineState): EngineState {
  const mid = s.eth;
  const skew = reservationPx(s) - mid;
  const half = mid * (spreadBps(s) / 10_000);
  return { ...s, ethBid: Math.max(0.01, mid + skew - half), ethAsk: mid + skew + half };
}

/**
 * Keep the ETH/USDC depth model pinned to the live oracle mark. In aggregator
 * mode this pool models *external* routed liquidity (no house pool at launch):
 * third-party arbitrageurs re-price it to the oracle, so the vault takes no
 * arb flows here — it is a pricing model, not a house position.
 */
/**
 * K-CONSERVING re-anchor: repin a CPMM pool to an external price exactly the
 * way a zero-fee arbitrageur would — trade BOTH reserves so x·y = k is
 * untouched (`x' = √(k/p)`, `y' = √(k·p)`). The pool's value (2·√(k·p) at the
 * new price) is neither destroyed nor minted by the re-pin itself; only real
 * fills (with their fee) move k.
 */
function repinPool(
  pool: EngineState["pools"][string],
  priceQuotePerBase: number,
): EngineState["pools"][string] {
  if (!(pool.baseReserve > 0) || !(pool.quoteReserve > 0) || !(priceQuotePerBase > 0)) {
    return pool;
  }
  const k = pool.baseReserve * pool.quoteReserve;
  const base = Math.sqrt(k / priceQuotePerBase);
  const quote = Math.sqrt(k * priceQuotePerBase);
  if (!(base > 0) || !(quote > 0) || !Number.isFinite(base) || !Number.isFinite(quote)) return pool;
  return { ...pool, baseReserve: base, quoteReserve: quote };
}

export function arbToSpot(s: EngineState): EngineState {
  const pool0 = s.pools["ETH-USDC"];
  if (!pool0 || pool0.baseReserve <= 1e-9 || pool0.quoteReserve <= 1e-9) return s;
  const spot = Math.max(s.eth, 1e-9);
  const mark = pool0.quoteReserve / pool0.baseReserve;
  if (Math.abs(mark - spot) / spot < 0.0004) return s;
  return {
    ...s,
    pools: { ...s.pools, "ETH-USDC": repinPool(pool0, spot) },
  };
}

export function quoteInForBaseOut(pool: EngineState["pools"][string], baseOut: number) {
  if (!pool || !(baseOut > 0) || !Number.isFinite(baseOut)) return Number.POSITIVE_INFINITY;
  if (baseOut >= pool.baseReserve * MAX_POOL_FRAC) return Number.POSITIVE_INFINITY;
  if (!(pool.baseReserve > 0) || !(pool.quoteReserve > 0)) return Number.POSITIVE_INFINITY;
  const fee = 1 - pool.feeBps / 10_000;
  const need = (pool.quoteReserve * baseOut) / (fee * (pool.baseReserve - baseOut));
  if (!Number.isFinite(need) || need <= 0) return Number.POSITIVE_INFINITY;
  return need;
}

export function maxSpotQty(s: EngineState, poolId: PoolId, side: "buy" | "sell") {
  const pool = s.pools[poolId];
  if (!pool) return 0;
  const cap = pool.baseReserve * MAX_POOL_FRAC;
  if (side === "sell") return Math.max(0, Math.min(tokenBal(s.account, pool.base), cap));
  const cash = tokenBal(s.account, pool.quote);
  const px = pool.baseReserve > 0 ? pool.quoteReserve / pool.baseReserve : 0;
  if (!(px > 0) || !(cash > 0)) return 0;
  return Math.max(0, Math.min(cap, (cash / px) * 0.98));
}

export function placeDeskOrder(
  s: EngineState,
  o: Omit<WorkingOrder, "id" | "created">,
): EngineState | string {
  const bad = requireFinitePositive(o.qty, "Quantity");
  if (bad) return bad;
  if ((o.kind === "lmt" || o.kind === "stl") && !(o.limit && o.limit > 0 && Number.isFinite(o.limit))) {
    return "Limit price required.";
  }
  if ((o.kind === "stp" || o.kind === "stl") && !(o.stop && o.stop > 0 && Number.isFinite(o.stop))) {
    return "Stop price required.";
  }
  if ((o.product === "future" || o.product === "option") && !listedUnder(o.under ?? "ETH")) {
    return "Derivatives only on ETH and WPIT until an oracle lists this underlier.";
  }
  if (o.product === "future") {
    const under = o.under ?? "ETH";
    const size = o.qty * miniQty(under);
    const need = size * markOf(s, under) * imRate(s, size, under);
    if (need > buyingPower(s) + 1e-6) return "Not enough buying power to rest that mini.";
  }
  const order: WorkingOrder = { ...o, id: uid("ord"), created: s.clock };
  if (order.kind === "mkt" || order.tif === "ioc") {
    const filled = tryFill(s, order);
    if (typeof filled !== "string") return { ...filled, working: s.working };
    if (order.tif === "ioc") return filled;
    if (order.kind === "mkt") return filled;
  }
  if (wouldCross(s, order)) {
    const filled = tryFill(s, order);
    if (typeof filled !== "string") return { ...filled, working: s.working };
    return filled;
  }
  // M-09 / #26: APPEND, so `matchWorking` (which iterates in list order) fills
  // oldest-first — time priority, as on any venue where two orders compete for
  // the same liquidity. The old code unshifted, matching the newest order first.
  if ((s.working?.length ?? 0) >= WORKING_ORDER_CAP) {
    return `Working order limit reached (${WORKING_ORDER_CAP}). Cancel one first.`;
  }
  // M-09 / #26: the old `.slice(0, 40)` silently DELETED the oldest resting
  // order when a 41st arrived — a resting stop could vanish with no rejection
  // and no cancel notice. Refuse instead; never drop an order without saying so.
  return { ...s, working: [...(s.working ?? []), order] };
}

export function cancelWorking(s: EngineState, id: string): EngineState {
  return { ...s, working: (s.working ?? []).filter((w) => w.id !== id) };
}

function wouldCross(s: EngineState, o: WorkingOrder) {
  const spot = markOf(s, o.under ?? "ETH");
  const bps = spreadBps(s);
  const bid = o.under && o.under !== "ETH" ? spot * (1 - bps / 10_000) : s.ethBid || s.eth;
  const ask = o.under && o.under !== "ETH" ? spot * (1 + bps / 10_000) : s.ethAsk || s.eth;
  if (o.kind === "lmt") {
    if (o.side === "buy") return ask <= (o.limit ?? 0);
    return bid >= (o.limit ?? Infinity);
  }
  if (o.kind === "stp") {
    if (o.side === "buy") return spot >= (o.stop ?? Infinity);
    return spot <= (o.stop ?? 0);
  }
  if (o.kind === "stl") {
    if (o.side === "buy") return spot >= (o.stop ?? Infinity) && ask <= (o.limit ?? 0);
    return spot <= (o.stop ?? 0) && bid >= (o.limit ?? Infinity);
  }
  return true;
}

/**
 * M-08 / #22: a limit is a PRICE BOUND on the realised average, not merely a
 * trigger. `wouldCross` only asks whether the market has reached the limit; the
 * fill itself walks the AMM curve and used to ignore `o.limit` entirely, so a
 * BUY LIMIT @ 4000 on a 500-ETH order against 2,500 ETH of depth filled at an
 * average of 5,015 — 25.4% through the limit.
 *
 * Spot partials are solved exactly rather than rejected outright. For a CPMM
 * with fee f, reserves (x = base, y = quote), the realised average is
 *   buy : avg(bOut) = y / (f·(x − bOut))
 *   sell: avg(bIn)  = f·y / (x + f·bIn)
 * Inverting at avg = limit gives the largest size that still respects it:
 *   buy : bOut* = x − y / (f·L)
 *   sell: bIn*  = (f·y / L − x) / f
 * Anything beyond that size would print past the limit, so we cap there.
 */
function limitCappedSpotQty(
  pool: EngineState["pools"][string],
  side: "buy" | "sell",
  qty: number,
  limit: number | undefined,
): number {
  if (!limit || !(limit > 0) || !Number.isFinite(limit)) return qty;
  const f = 1 - pool.feeBps / 10_000;
  const x = pool.baseReserve;
  const y = pool.quoteReserve;
  if (!(x > 0) || !(y > 0) || !(f > 0)) return qty;
  const cap = side === "buy" ? x - y / (f * limit) : (f * y) / limit / f - x / f;
  const sized = Math.min(qty, side === "buy" ? cap : (f * y) / limit / f - x / f);
  return sized > 0 ? sized : 0;
}

function limitPriceOf(o: WorkingOrder): number | undefined {
  return o.kind === "lmt" || o.kind === "stl" ? o.limit : undefined;
}

function tryFill(s: EngineState, o: WorkingOrder): EngineState | string {
  const under = o.under ?? "ETH";
  const limit = limitPriceOf(o);
  if (o.product === "spot") {
    const poolId = o.poolId ?? "ETH-USDC";
    const pool = s.pools[poolId];
    if (!pool) return "Unknown pool.";
    if (o.side === "buy") {
      const wantBase = limitCappedSpotQty(pool, "buy", o.qty, limit);
      if (!(wantBase > 0)) return "Limit not met: the book cannot fill any size at that price.";
      const quote = quoteInForBaseOut(pool, wantBase);
      if (!Number.isFinite(quote)) return "Size too large for pool.";
      // Defence in depth: verify the realised average, never trust the algebra.
      if (limit && quote / wantBase > limit + 1e-9) return "Limit not met.";
      return tradeSpot(s, poolId, "buy", quote);
    }
    const wantBase = limitCappedSpotQty(pool, "sell", o.qty, limit);
    if (!(wantBase > 0)) return "Limit not met: the book cannot fill any size at that price.";
    const out = ammOut(wantBase, pool.baseReserve, pool.quoteReserve, pool.feeBps);
    if (limit && out / wantBase < limit - 1e-9) return "Limit not met.";
    return tradeSpot(s, poolId, "sell", wantBase);
  }
  if (o.product === "future") {
    // Futures print at mark ± spread, so the realised price is known up front.
    if (limit) {
      const mark = markOf(s, under);
      const bps = spreadBps(s);
      const px = o.side === "buy" ? mark * (1 + bps / 10_000) : mark * (1 - bps / 10_000);
      if (o.side === "buy" && px > limit + 1e-9) return "Limit not met.";
      if (o.side === "sell" && px < limit - 1e-9) return "Limit not met.";
    }
    const contracts = o.qty;
    const side = o.side === "buy" ? "long" : "short";
    return tradeFuture(s, side, contracts, o.expiry ?? expiries(s.clock)[0]!.at, under);
  }
  if (o.product === "option") {
    if (o.side === "sell") return "Close longs from Positions. Vault does not buy options.";
    const spot = markOf(s, under);
    const ks = strikeGrid(spot);
    const strike = o.strike ?? ks[Math.floor(ks.length / 2)]!;
    const expiry = o.expiry ?? expiries(s.clock)[0]!.at;
    const type = o.optType ?? "call";
    // The premium per ETH is the ask, so the realised average is the ask itself.
    if (limit && optionQuote(s, type, strike, expiry, under).ask > limit + 1e-9) return "Limit not met.";
    return buyOption(s, type, strike, expiry, o.qty, under);
  }
  return "Unknown product.";
}

function matchWorking(s: EngineState): EngineState {
  let cur = s;
  const keep: WorkingOrder[] = [];
  const dayCut = utcDay(s.clock);
  for (const o of s.working ?? []) {
    if (o.tif === "day" && utcDay(o.created) !== dayCut) continue;
    if (wouldCross(cur, o) || o.kind === "mkt") {
      const r = tryFill(cur, o);
      if (typeof r === "string") {
        keep.push(o);
      } else {
        cur = r;
      }
    } else keep.push(o);
  }
  return { ...cur, working: keep };
}

function utcDay(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

export function bookGreeks(s: EngineState) {
  let delta = 0;
  let gamma = 0;
  let vega = 0;
  for (const p of s.futures) {
    if ((p.under ?? "ETH") !== "ETH") continue;
    delta += p.side === "long" ? -p.sizeEth : p.sizeEth;
  }
  for (const p of s.options) {
    if ((p.under ?? "ETH") !== "ETH") continue;
    const T = yearsTo(p.expiry, s.clock);
    const vol = ivSmile(s.iv, s.eth, p.strike, T);
    const d = bsDelta(s.eth, p.strike, T, 0.03, vol, p.type);
    delta += -d * p.sizeEth;
    gamma += -bsGamma(s.eth, p.strike, T, 0.03, vol) * p.sizeEth;
    vega += -bsVega(s.eth, p.strike, T, 0.03, vol) * p.sizeEth;
  }
  return { delta, gamma, vega };
}

export function residualDelta(s: EngineState) {
  const g = bookGreeks(s);
  const hedge = s.vault.hedgeEth ?? 0;
  return g.delta + s.vault.reservedEth - s.vault.reservedUsdc / Math.max(s.eth, 1e-9) + hedge;
}

function coverQty(s: EngineState, under: string, side: FutSide): number {
  if (under === "ETH") return side === "long" ? maxNetLongEth(s) : maxNetShortEth(s);
  const mark = markOf(s, under);
  if (!(mark > 0)) return 0;
  return Math.max(0, freeUsdc(s) / mark);
}

export function mmRate(s: EngineState, size: number, under: string): number {
  return imRate(s, size, under) * 0.5;
}

function posMmRate(p: EngineState["futures"][number]): number {
  const n = p.entry * p.sizeEth;
  const im = n > 0 ? p.margin / n : FUT_IM;
  return clamp(im * 0.5, 0.08, 0.6);
}

export function futLiqPrice(p: EngineState["futures"][number], mm = posMmRate(p)) {
  const q = p.sizeEth;
  if (q <= 0) return p.entry;
  if (p.side === "long") return (p.entry * q - p.margin) / (q * (1 - mm));
  return (p.margin + p.entry * q) / (q * (1 + mm));
}

function futMaint(p: EngineState["futures"][number], mark: number) {
  return p.sizeEth * mark * posMmRate(p);
}

export function usedMargin(s: EngineState) {
  return s.futures.reduce((a, p) => a + p.margin, 0);
}

export function buyingPower(s: EngineState) {
  return Math.max(0, s.account.usdc);
}

export function maxMiniContracts(s: EngineState, side: FutSide, under = "ETH") {
  const mark = markOf(s, under);
  const unit = miniQty(under);
  if (!(mark > 0) || !(unit > 0)) return 0;
  const cover = coverQty(s, under, side);
  const byInv = Math.floor(cover / unit);
  let lo = 0;
  let hi = Math.max(0, Math.min(byInv, MAX_LOT));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const size = mid * unit;
    const rate = imRate(s, size, under);
    const cost = size * mark * rate + size * mark * DERIV_FEE;
    if (Number.isFinite(cost) && cost <= buyingPower(s) + 1e-9 && size <= cover + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function groupedFutures(s: EngineState): EngineState["futures"] {
  const map = new Map<string, EngineState["futures"][number]>();
  for (const p of s.futures) {
    const k = `${p.under ?? "ETH"}|${p.side}|${p.expiry}`;
    const g = map.get(k);
    if (!g) map.set(k, { ...p });
    else {
      const size = g.sizeEth + p.sizeEth;
      const entry = size > 0 ? (g.entry * g.sizeEth + p.entry * p.sizeEth) / size : g.entry;
      map.set(k, { ...g, sizeEth: size, entry, margin: g.margin + p.margin });
    }
  }
  return [...map.values()];
}

export function groupedOptions(s: EngineState): EngineState["options"] {
  const map = new Map<string, EngineState["options"][number]>();
  for (const p of s.options) {
    const k = `${p.under ?? "ETH"}|${p.type}|${p.strike}|${p.expiry}`;
    const g = map.get(k);
    if (!g) map.set(k, { ...p });
    else {
      const size = g.sizeEth + p.sizeEth;
      const premium = size > 0 ? (g.premium * g.sizeEth + p.premium * p.sizeEth) / size : g.premium;
      map.set(k, { ...g, sizeEth: size, premium });
    }
  }
  return [...map.values()];
}

function takeFee(s: EngineState, fee: number): EngineState {
  if (fee <= 0) return s;
  return {
    ...s,
    vault: { ...s.vault, usdc: s.vault.usdc + fee * 0.5 },
    insuranceUsdc: s.insuranceUsdc + fee * 0.5,
  };
}

export function hedgeDelta(s: EngineState): EngineState {
  const gap = residualDelta(s);
  // MM.md rung 1: band = max(0.05 · vault.ETH, 0.02 · NAV / S). Inside the band
  // do nothing; outside it, trade down to |Δ| ≤ band/2, capped at one band per
  // step so the hedge cannot run over the book.
  const navEth = vaultNav(s) / Math.max(s.eth, 1e-9);
  const band = Math.max(0.05 * s.vault.eth, 0.02 * navEth);
  if (Math.abs(gap) <= band) return arbToSpot(refreshQuotes(s));
  const pool0 = s.pools["ETH-USDC"];
  if (!pool0) return arbToSpot(refreshQuotes(s));
  const vault = { ...s.vault, hedgeEth: s.vault.hedgeEth ?? 0 };
  const pool = { ...pool0 };
  const halfSpreadBps = spreadBps(s) / 2; // spread_captured / 2
  // Emergency: risk-first — if we are > 2 bands off, hedge even through ugly
  // slippage rather than sit on an unhedged book.
  const urgent = Math.abs(gap) > 2 * band;
  const step = Math.min(Math.abs(gap) - band / 2, band);
  if (gap > 0) {
    const sell = Math.min(step, Math.max(0, vault.eth - vault.reservedEth));
    if (sell < 0.005) return arbToSpot(refreshQuotes({ ...s, vault }));
    const out = ammOut(sell, pool.baseReserve, pool.quoteReserve, pool.feeBps);
    const slipBps = Math.abs(out / sell / Math.max(s.eth, 1e-9) - 1) * 10_000;
    if (!urgent && slipBps > Math.max(halfSpreadBps, 5)) {
      return arbToSpot(refreshQuotes({ ...s, vault })); // MM.md: slippage > 0.5·spread ⇒ don't trade that size
    }
    vault.eth -= sell;
    vault.usdc += out;
    vault.hedgeEth -= sell;
    pool.baseReserve += sell;
    pool.quoteReserve -= out;
  } else {
    const want = Math.min(step, pool.baseReserve * MAX_POOL_FRAC);
    const cost = quoteInForBaseOut(pool, want);
    // M-07 / #23: the hedge must not spend trader escrow either.
    const deployable = freeVaultUsdc({ ...s, vault });
    if (!Number.isFinite(cost) || cost > deployable || want < 0.005) return arbToSpot(refreshQuotes({ ...s, vault }));
    const slipBps = Math.abs(cost / want / Math.max(s.eth, 1e-9) - 1) * 10_000;
    if (!urgent && slipBps > Math.max(halfSpreadBps, 5)) {
      return arbToSpot(refreshQuotes({ ...s, vault }));
    }
    const got = ammOut(cost, pool.quoteReserve, pool.baseReserve, pool.feeBps);
    vault.usdc -= cost;
    vault.eth += got;
    vault.hedgeEth += got;
    pool.quoteReserve += cost;
    pool.baseReserve -= got;
  }
  return arbToSpot(refreshQuotes({ ...s, vault, pools: { ...s.pools, "ETH-USDC": pool } }));
}

/**
 * LP.md inventory law: ETH weight w = vault.ETH·S / NAV with target w ∈
 * [0.45, 0.55]; when w drifts outside [0.40, 0.60], rebalance via spot toward
 * 0.50 — never by quoting worse options. Trades are capped at 2% of routed
 * depth per step and skipped when all-in slippage (incl. fees) exceeds 30 bps.
 */
export function rebalanceWeights(s: EngineState): EngineState {
  const nav = vaultNav(s);
  if (!(nav > 0) || !(s.eth > 0)) return s;
  const w = (s.vault.eth * s.eth) / nav;
  if (w >= 0.4 && w <= 0.6) return s;
  const pool0 = s.pools["ETH-USDC"];
  if (!pool0 || pool0.baseReserve <= 0 || pool0.quoteReserve <= 0) return s;
  const vault = { ...s.vault };
  const pool = { ...pool0 };
  const targetEth = (0.5 * nav) / s.eth;
  const want = targetEth - s.vault.eth; // >0 buy ETH, <0 sell ETH
  // Size each step to the slippage budget (~0.3% of routed depth), not to a
  // fixed fraction — a CPMM step of x against depth D costs ≈ x/D in bps.
  const stepCap = pool.baseReserve * 0.003;
  if (want < 0) {
    const sell = Math.min(-want, Math.max(0, vault.eth - vault.reservedEth), stepCap);
    if (sell < 0.005) return s;
    const out = ammOut(sell, pool.baseReserve, pool.quoteReserve, pool.feeBps);
    // Budget is 30 bps of *impact* on top of the routed fee.
    const slipBps = Math.abs(out / sell / s.eth - 1) * 10_000;
    if (slipBps > pool.feeBps + 30) return s;
    vault.eth -= sell;
    vault.usdc += out;
    pool.baseReserve += sell;
    pool.quoteReserve -= out;
  } else {
    const buy = Math.min(want, stepCap);
    const cost = quoteInForBaseOut(pool, buy);
    const free = freeVaultUsdc({ ...s, vault });
    if (!Number.isFinite(cost) || cost > free || buy < 0.005) return s;
    const slipBps = Math.abs(cost / buy / s.eth - 1) * 10_000;
    if (slipBps > pool.feeBps + 30) return s;
    const got = ammOut(cost, pool.quoteReserve, pool.baseReserve, pool.feeBps);
    vault.usdc -= cost;
    vault.eth += got;
    pool.quoteReserve += cost;
    pool.baseReserve -= got;
  }
  return { ...s, vault, pools: { ...s.pools, "ETH-USDC": pool } };
}

function cashShot(s: EngineState) {
  return { usdc: s.account.usdc, eth: s.account.eth, wpit: s.account.wpit };
}

function pushFill(s: EngineState, fill: EngineState["fills"][number], before?: { usdc: number; eth: number; wpit: number }): EngineState {
  const after = cashShot(s);
  return {
    ...s,
    fills: [{ ...fill, before: before ?? fill.before ?? after, after }, ...s.fills].slice(0, 80),
  };
}

export function tradeSpot(s: EngineState, poolId: PoolId, side: "buy" | "sell", amt: number): EngineState | string {
  const money = requireMoney(amt, "Size");
  if (money) return money;
  if (amt <= 0) return "Size must be positive.";
  const pool0 = s.pools[poolId];
  if (!pool0) return "Unknown pool.";
  if (!(pool0.baseReserve > 0) || !(pool0.quoteReserve > 0)) return "Empty pool.";
  const pool = { ...pool0 };
  if (side === "buy") {
    const quoteIn = amt;
    if (tokenBal(s.account, pool.quote) + 1e-12 < quoteIn) return `Insufficient ${pool.quote}.`;
    const out = ammOut(quoteIn, pool.quoteReserve, pool.baseReserve, pool.feeBps);
    if (!(out > 0)) return "Size too small for the book.";
    if (out > pool.baseReserve * MAX_POOL_FRAC) return "Size exceeds 25% of pool reserves.";
    pool.quoteReserve += quoteIn;
    pool.baseReserve -= out;
    if (pool.baseReserve <= 0 || pool.quoteReserve <= 0) return "Trade would drain the pool.";
    let acc = creditToken(s.account, pool.quote, -quoteIn);
    acc = creditToken(acc, pool.base, out);
    const next = syncPoolMark({ ...s, account: acc, pools: { ...s.pools, [poolId]: pool } }, poolId);
    return pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "spot",
      symbol: poolId,
      side: "buy",
      size: out,
      price: quoteIn / out,
      fee: quoteIn * (pool.feeBps / 10_000),
    }, cashShot(s));
  }
  const baseIn = amt;
  if (tokenBal(s.account, pool.base) + 1e-12 < baseIn) return `Insufficient ${pool.base}.`;
  if (baseIn > pool.baseReserve * MAX_POOL_FRAC) return "Size exceeds 25% of pool reserves.";
  const out = ammOut(baseIn, pool.baseReserve, pool.quoteReserve, pool.feeBps);
  if (!(out > 0)) return "Size too small for the book.";
  pool.baseReserve += baseIn;
  pool.quoteReserve -= out;
  if (pool.baseReserve <= 0 || pool.quoteReserve <= 0) return "Trade would drain the pool.";
  let acc = creditToken(s.account, pool.base, -baseIn);
  acc = creditToken(acc, pool.quote, out);
  const next = syncPoolMark({ ...s, account: acc, pools: { ...s.pools, [poolId]: pool } }, poolId);
  return pushFill(next, {
    id: uid("f"),
    t: s.clock,
    product: "spot",
    symbol: poolId,
    side: "sell",
    size: baseIn,
    price: out / baseIn,
    fee: out * (pool.feeBps / 10_000),
  }, cashShot(s));
}

function syncPoolMark(s: EngineState, poolId: PoolId): EngineState {
  const pool = s.pools[poolId];
  if (!pool || !(pool.baseReserve > 0)) return s;
  if (pool.base === "WPIT" && pool.quote === "USDC") {
    return { ...s, wpit: pool.quoteReserve / pool.baseReserve };
  }
  if (pool.base === "WPIT" && pool.quote === "ETH") {
    return { ...s, wpit: (pool.quoteReserve / pool.baseReserve) * s.eth };
  }
  return s;
}

function rejectAnyFuture(s: EngineState, side: FutSide, size: number, expiry: number, under: string): string | null {
  const bad = requireFinitePositive(size, "Size");
  if (bad) return bad;
  if (!listedUnder(under)) return "Derivatives only on ETH and WPIT until an oracle lists this underlier.";
  const mark = markOf(s, under);
  if (!(mark > 0) || !Number.isFinite(mark)) return `No mark for ${under}.`;
  const notional = size * mark;
  if (!Number.isFinite(notional) || notional > MAX_NOTIONAL_USD) return "Notional exceeds house cap.";
  const cover = coverQty(s, under, side);
  if (size > cover + 1e-9) return `Not enough protocol cover. Max ${cover.toPrecision(4)} ${under}.`;
  const depth = poolDepth(s, under);
  if (depth > 0 && size > depth * MAX_POOL_FRAC + 1e-9) {
    return `Size > 25% of ${under} pool depth.`;
  }
  const rate = imRate(s, size, under);
  const im = notional * rate;
  const fee = notional * DERIV_FEE;
  if (!(im >= MIN_IM_USD)) return "Margin too small.";
  if (s.account.usdc + 1e-9 < im + fee) return "Not enough buying power for initial margin + fee.";
  if (under === "ETH") return rejectFuture(s, side, size, expiry);
  if (notional > freeUsdc(s) + 1e-9) return "Vault cannot cash-secure that notional.";
  return null;
}

function applyVaultOpen(
  vault: EngineState["vault"],
  side: FutSide,
  size: number,
  px: number,
  under: string,
  margin: number,
): EngineState["vault"] | string {
  const v = { ...vault, escrowUsdc: vault.escrowUsdc ?? 0 };
  if (margin > 0 && Number.isFinite(margin)) {
    v.usdc += margin;
    v.escrowUsdc += margin;
  }
  if (under === "ETH") {
    if (side === "long") {
      v.reservedEth += size;
    } else {
      if (v.eth < size) return "Vault has no ETH to short against.";
      v.reservedUsdc += size * px;
      v.eth -= size;
      v.usdc += size * px;
      // Contract parity (DealerVault.openShort): selling ETH for a short must
      // keep the ETH-side utilisation inside α — the cover for written calls
      // / long futures is still reserved against the shrunken balance.
      if (v.reservedEth > UTIL_CAP * v.eth + 1e-9) {
        return "Inventory cap. ETH utilization would exceed α after the sale.";
      }
    }
  } else {
    v.reservedUsdc += size * px;
  }
  return v;
}

function applyVaultClose(vault: EngineState["vault"], pos: EngineState["futures"][number], closeSize: number, mark: number) {
  const v = { ...vault };
  const under = pos.under ?? "ETH";
  if (under === "ETH") {
    if (pos.side === "long") v.reservedEth = Math.max(0, v.reservedEth - closeSize);
    else {
      v.reservedUsdc = Math.max(0, v.reservedUsdc - pos.entry * closeSize);
      v.eth += closeSize;
      v.usdc -= closeSize * mark;
    }
  } else {
    v.reservedUsdc = Math.max(0, v.reservedUsdc - pos.entry * closeSize);
  }
  return v;
}

function reduceFuture(
  s: EngineState,
  pos: EngineState["futures"][number],
  closeSize: number,
  mark: number,
): EngineState | string {
  if (!(closeSize > 0) || closeSize > pos.sizeEth + 1e-9) return "Cannot reduce that size.";
  if (!(mark > 0) || !Number.isFinite(mark)) return "No mark to flatten against.";
  const frac = closeSize / pos.sizeEth;
  const slice = { ...pos, sizeEth: closeSize, margin: pos.margin * frac };
  const pnl = futPnl(slice, mark);
  const vault = applyVaultClose(s.vault, pos, closeSize, mark);
  vault.escrowUsdc = Math.max(0, (s.vault.escrowUsdc ?? 0) - slice.margin);
  const want = slice.margin + pnl;
  let insurance = s.insuranceUsdc;
  // Payout honesty, same as closeOption/liquidateFuture: the trader gets the
  // full documented amount; free vault USDC pays first and the remainder is a
  // RECORDED HOLE in insurance (goes negative → circuit), never a silent
  // partial pay capped at insurance=0.
  if (want >= 0) {
    const floor = vault.reservedUsdc + (vault.escrowUsdc ?? 0);
    const free = Math.max(0, vault.usdc - floor);
    if (want > free + 1e-9) {
      insurance -= want - free; // may go negative → circuit
      vault.usdc -= free;
    } else {
      vault.usdc -= want;
    }
  } else {
    vault.usdc -= want;
  }
  const rest = pos.sizeEth - closeSize;
  const futures =
    rest <= 1e-12
      ? s.futures.filter((p) => p.id !== pos.id)
      : s.futures.map((p) =>
          p.id === pos.id ? { ...p, sizeEth: rest, margin: p.margin * (rest / p.sizeEth) } : p,
        );
  return {
    ...s,
    account: {
      ...s.account,
      usdc: s.account.usdc + want,
      realized: s.account.realized + pnl,
    },
    vault,
    insuranceUsdc: insurance,
    futures,
  };
}

export function tradeFuture(s: EngineState, side: FutSide, contracts: number, expiry: number, under = "ETH"): EngineState | string {
  const lot = requireFinitePositive(contracts, "Contracts");
  if (lot) return lot;
  const size = contracts * miniQty(under);
  const why = rejectAnyFuture(s, side, size, expiry, under);
  if (why) return why;
  const mark = markOf(s, under);
  const bps = spreadBps(s);
  // v1 quotes use the documented mark plus the spread stack. Inventory is
  // already represented in spreadBps; do not apply the A-S reservation shift
  // a second time (MM.md, v1 quote model).
  const mid = mark;
  const px = side === "long" ? mid * (1 + bps / 10_000) : mid * (1 - bps / 10_000);
  const fee = size * px * DERIV_FEE;

  const opp = s.futures.find(
    (p) => (p.under ?? "ETH") === under && p.expiry === expiry && p.side !== side,
  );
  if (opp) {
    const cut = Math.min(opp.sizeEth, size);
    const reduced = reduceFuture(s, opp, cut, px);
    if (typeof reduced === "string") return reduced;
    const feeNow = fee * (cut / size);
    // Flatten fills charge the trader the SAME DERIV_FEE as opens (F9): the
    // fee is debited here and split vault/insurance by takeFee — nothing is
    // minted. (Old path credited vault+insurance without any debit.)
    const charged = {
      ...reduced,
      account: {
        ...reduced.account,
        usdc: reduced.account.usdc - feeNow,
        realized: reduced.account.realized - feeNow,
      },
    };
    const filled = takeFee(
      pushFill(charged, {
        id: uid("f"),
        t: s.clock,
        product: "future",
        symbol: `${under} mini ${fmtExpiry(expiry)}`,
        side,
        size: cut,
        price: px,
        fee: feeNow,
        note: "flatten",
      }, cashShot(charged)),
      feeNow,
    );
    const rem = size - cut;
    if (rem <= 1e-12) return under === "ETH" ? hedgeDelta(filled) : filled;
    return tradeFuture(filled, side, rem / miniQty(under), expiry, under);
  }

  const hit = s.futures.find((p) => (p.under ?? "ETH") === under && p.side === side && p.expiry === expiry);
  const total = (hit?.sizeEth ?? 0) + size;
  const rate = imRate(s, total, under);
  const want = total * px * rate;
  const extra = want - (hit?.margin ?? 0);
  if (s.account.usdc + 1e-9 < extra + fee) return "Not enough buying power for initial margin + fee.";
  const vault = applyVaultOpen(s.vault, side, size, px, under, extra);
  if (typeof vault === "string") return vault;
  const entry = hit ? (hit.entry * hit.sizeEth + px * size) / total : px;
  const pos = hit
    ? { ...hit, sizeEth: total, entry, margin: want }
    : { id: uid("fut"), side, sizeEth: size, entry: px, expiry, margin: want, openedAt: s.clock, under };
  const futures = hit ? s.futures.map((p) => (p.id === hit.id ? pos : p)) : [...s.futures, pos];
  const next: EngineState = {
    ...s,
    account: { ...s.account, usdc: s.account.usdc - extra - fee, realized: s.account.realized - fee },
    vault,
    futures,
  };
  const filled = takeFee(
    pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "future",
      symbol: `${under} mini ${fmtExpiry(expiry)}`,
      side,
      size,
      price: px,
      fee,
      note: under === "ETH" ? "covered · delta-hedged · netted" : "cash-settled · USDC IM · netted",
    }, cashShot(s)),
    fee,
  );
  return under === "ETH" ? hedgeDelta(filled) : filled;
}

export function closeFuture(s: EngineState, id: string, settlement = false): EngineState | string {
  const pos = s.futures.find((p) => p.id === id);
  if (!pos) return "Position not found.";
  const under = pos.under ?? "ETH";
  const mark = markOf(s, under);
  if (!(mark > 0) || !Number.isFinite(mark)) return `No mark for ${under}.`;
  // Early closes CROSS THE SPREAD like any taker (audit §3.8): a long sells
  // back at the bid, a short buys back at the ask — the house keeps the
  // spread it quotes, same as the tradeFuture flatten path. Expiry
  // settlement (settlement=true) stays at the mark: settlement prints have
  // no spread.
  const bps = spreadBps(s);
  const px = settlement ? mark : pos.side === "long" ? mark * (1 - bps / 10_000) : mark * (1 + bps / 10_000);
  const reduced = reduceFuture(s, pos, pos.sizeEth, px);
  if (typeof reduced === "string") return reduced;
  const pnl = futPnl(pos, px);
  // Fee parity with opens and flattens (F9): an early close pays the same
  // DERIV_FEE, debited from the trader and split vault/insurance by takeFee.
  // Settlement prints are not trades — no fee.
  const fee = settlement ? 0 : pos.sizeEth * px * DERIV_FEE;
  const charged = fee > 0
    ? {
        ...reduced,
        account: {
          ...reduced.account,
          usdc: reduced.account.usdc - fee,
          realized: reduced.account.realized - fee,
        },
      }
    : reduced;
  const filled = takeFee(
    pushFill(charged, {
      id: uid("f"),
      t: s.clock,
      product: "future",
      symbol: `${under} mini close`,
      side: pos.side === "long" ? "sell" : "buy",
      size: pos.sizeEth,
      price: px,
      fee,
      note: `PnL ${pnl.toFixed(2)}`,
    }, cashShot(charged)),
    fee,
  );
  return under === "ETH" ? hedgeDelta(filled) : filled;
}

function commitOption(
  s: EngineState,
  pos: EngineState["options"][number],
  extraPremium: number,
  fee: number,
  vault: EngineState["vault"],
  hedge: boolean,
): EngineState {
  const hit = s.options.find(
    (p) =>
      (p.under ?? "ETH") === (pos.under ?? "ETH") &&
      p.type === pos.type &&
      p.strike === pos.strike &&
      p.expiry === pos.expiry,
  );
  let options: EngineState["options"];
  if (hit) {
    const total = hit.sizeEth + pos.sizeEth;
    const premium = (hit.premium * hit.sizeEth + pos.premium * pos.sizeEth) / total;
    const merged = {
      ...hit,
      sizeEth: total,
      premium,
      securedUsdc: (hit.securedUsdc ?? 0) + (pos.securedUsdc ?? 0),
      securedEth: (hit.securedEth ?? 0) + (pos.securedEth ?? 0),
    };
    options = s.options.map((p) => (p.id === hit.id ? merged : p));
  } else {
    options = [...s.options, pos];
  }
  const next: EngineState = {
    ...s,
    account: { ...s.account, usdc: s.account.usdc - extraPremium - fee, realized: s.account.realized - fee },
    // The vault SOLD this option: the premium is house revenue (F8). Reserve
    // accounting stays in `vault` — collateral was booked by the caller.
    vault: { ...vault, usdc: vault.usdc + extraPremium },
    options,
  };
  const filled = takeFee(
    pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "option",
      symbol: `${pos.under ?? "ETH"} ${pos.strike} ${pos.type} mini`,
      side: "buy",
      size: pos.sizeEth,
      price: pos.premium,
      fee,
      note: hedge ? "covered / cash-secured · delta-hedged · netted" : "cash-settled · cash-secured · netted",
    }, cashShot(s)),
    fee,
  );
  return hedge ? hedgeDelta(filled) : filled;
}

export function buyOption(s: EngineState, type: OptType, strike: number, expiry: number, contracts: number, under = "ETH"): EngineState | string {
  const lot = requireFinitePositive(contracts, "Contracts");
  if (lot) return lot;
  if (!(strike > 0) || !Number.isFinite(strike)) return "Strike must be a finite positive number.";
  if (!listedUnder(under)) return "Derivatives only on ETH and WPIT until an oracle lists this underlier.";
  const sizeEth = contracts * miniQty(under);
  const mark = markOf(s, under);
  if (!(mark > 0)) return `No mark for ${under}.`;
  if (under !== "ETH") {
    const T = yearsTo(expiry, s.clock);
    if (T <= 0) return "That expiry is done.";
    const q = optionQuote(s, type, strike, expiry, under);
    if (q.blank) return q.blank;
    const px = q.ask;
    const premium = px * sizeEth;
    const fee = premium * DERIV_FEE;
    if (s.account.usdc < premium + fee) return "Insufficient USDC for premium.";
    const lock = type === "call" ? markOf(s, under) * sizeEth : strike * sizeEth;
    if (s.vault.usdc - s.vault.reservedUsdc < lock) return "Not enough USDC to cash-secure.";
    const vault = { ...s.vault, reservedUsdc: s.vault.reservedUsdc + lock };
    const pos = {
      id: uid("opt"),
      type,
      strike,
      expiry,
      sizeEth,
      premium: px,
      openedAt: s.clock,
      under,
      securedUsdc: lock,
      securedEth: 0,
    };
    return commitOption(s, pos, premium, fee, vault, false);
  }
  const g = bookGreeks(s);
  const why = rejectOption(s, type, strike, expiry, sizeEth, g.gamma, g.vega);
  if (why) return why;
  const T = yearsTo(expiry, s.clock);
  if (T <= 0) return "That expiry is done.";
  const vol = smileVol(s, type, strike, T);
  const mid = type === "call" ? bsCall(s.eth, strike, T, 0.03, vol) : bsPut(s.eth, strike, T, 0.03, vol);
  const bps = spreadBps(s);
  const px = mid * (1 + bps / 10_000) + 0.4; // MM.md: ask = mid·(1+s_bps/1e4) + 0.40 USDC
  const premium = px * sizeEth;
  const fee = premium * DERIV_FEE;
  if (s.account.usdc < premium + fee) return "Insufficient USDC for premium.";
  const vault = { ...s.vault };
  if (type === "call") {
    vault.reservedEth += sizeEth;
  } else {
    vault.reservedUsdc += strike * sizeEth;
  }
  const pos = {
    id: uid("opt"),
    type,
    strike,
    expiry,
    sizeEth,
    premium: px,
    openedAt: s.clock,
    under,
    securedEth: type === "call" ? sizeEth : 0,
    securedUsdc: type === "put" ? strike * sizeEth : 0,
  };
  return commitOption(s, pos, premium, fee, vault, true);
}

/**
 * Liquidate one isolated futures position (RISK.md):
 *   equity  = margin + signed PnL; liquidate when equity < maintenance
 *   penalty = min(max(equity,0), 1% · size · mark) → insurance
 *   remainder (equity − penalty) → trader
 *   if equity ≤ 0: trader wiped, insurance eats the hole; pause if insurance < 0
 * Conservation on every path: trader payout + insurance Δ + vault Δ = 0.
 */
function liquidateFuture(s: EngineState, pos: EngineState["futures"][number], mark: number): EngineState {
  const pnl = futPnl(pos, mark);
  const eq = pos.margin + pnl;
  const penalty = Math.min(Math.max(eq, 0), 0.01 * pos.sizeEth * mark);
  const vault = applyVaultClose(s.vault, pos, pos.sizeEth, mark);
  vault.escrowUsdc = Math.max(0, (s.vault.escrowUsdc ?? 0) - pos.margin);
  let insurance = s.insuranceUsdc;
  let paid = 0;
  if (eq > 0) {
    // The documented remainder (equity − penalty) is ALWAYS paid to the trader
    // (F11). The vault pays its free balance first; the remainder comes out of
    // insurance, which lands on the `keep_tranche` semantics: if insurance
    // cannot cover it, insurance goes NEGATIVE and the circuit breaker trips —
    // a loud, visible shortfall instead of a silent haircut.
    const payout = eq - penalty;
    const floor = vault.reservedUsdc + (vault.escrowUsdc ?? 0);
    const free = Math.max(0, vault.usdc - floor);
    // The vault owes `payout` to the trader AND `penalty` to insurance; the
    // money is the escrowed margin it already holds. Pay what the free balance
    // covers; the remainder is drawn from insurance (which can go negative —
    // the junior tranche is tapped out — and the circuit trips below).
    const needed = payout + penalty;
    const fromVault = Math.min(needed, free);
    vault.usdc -= fromVault;
    insurance += penalty - (needed - fromVault);
    paid = payout;
  } else {
    insurance += eq; // ≤ 0: insurance covers the trader's debt to the vault
    vault.usdc += -eq;
  }
  const circuitUntil =
    insurance < 0 ? Math.max(s.circuitUntil ?? 0, s.clock + CIRCUIT_MS) : (s.circuitUntil ?? 0);
  return {
    ...s,
    account: { ...s.account, usdc: s.account.usdc + paid, realized: s.account.realized + pnl },
    vault,
    insuranceUsdc: insurance,
    circuitUntil,
    futures: s.futures.filter((p) => p.id !== pos.id),
    liquidations: (s.liquidations ?? 0) + 1,
  };
}

function settleAndLiq(s: EngineState): EngineState {
  let next = s;
  for (const p of s.futures) {
    const mark = markOf(next, p.under ?? "ETH");
    const eq = p.margin + futPnl(p, mark);
    const maint = futMaint(p, mark);
    if (eq < maint) {
      next = liquidateFuture(next, p, mark);
    } else if (next.clock >= p.expiry) {
      const closed = closeFuture(next, p.id, true); // settlement print: no spread
      if (typeof closed !== "string") next = closed;
    }
  }
  const remaining: EngineState["options"] = [];
  const vault = { ...next.vault };
  let acc = { ...next.account };
  let insurance = next.insuranceUsdc;
  for (const p of next.options) {
    if (next.clock < p.expiry) {
      remaining.push(p);
      continue;
    }
    const spot = markOf(next, p.under ?? "ETH");
    const intrinsic = p.type === "call" ? Math.max(spot - p.strike, 0) : Math.max(p.strike - spot, 0);
    const payoff = intrinsic * p.sizeEth;
    acc = { ...acc, usdc: acc.usdc + payoff, realized: acc.realized + payoff - p.premium * p.sizeEth };
    // F8: the option book now settles against the HOUSE. Release the collateral
    // the vault reserved when it sold the option, then pay the payoff from the
    // vault's books — free USDC first, insurance second (negative insurance
    // trips the circuit below). No more printing payouts from nothing.
    const secEth = p.securedEth ?? 0;
    const secUsdc = p.securedUsdc ?? 0;
    vault.reservedEth = Math.max(0, vault.reservedEth - secEth);
    vault.reservedUsdc = Math.max(0, vault.reservedUsdc - secUsdc);
    if (secEth > 0 && (p.under ?? "ETH") === "ETH" && spot > p.strike) {
      // ITM call: deliver — convert the covering ETH at spot; the house keeps
      // size·max(0, spot − max(spot−K,0)) = size·min(spot, K) as its edge.
      vault.eth = Math.max(0, vault.eth - secEth);
      vault.usdc += secEth * spot;
    }
    // OTM call: no delivery — the cover is NOT force-sold; the house keeps the
    // ETH (the option is worthless, the reservation is released above).
    const floor = vault.reservedUsdc + (vault.escrowUsdc ?? 0);
    const free = Math.max(0, vault.usdc - floor);
    const fromVault = Math.min(payoff, free);
    vault.usdc -= fromVault;
    insurance -= Math.max(0, payoff - fromVault);
  }
  const circuitUntil =
    insurance < 0 ? Math.max(next.circuitUntil ?? 0, next.clock + CIRCUIT_MS) : (next.circuitUntil ?? 0);
  return hedgeDelta(rebalanceWeights({ ...next, options: remaining, vault, account: acc, insuranceUsdc: insurance, circuitUntil }));
}

export function settleNow(s: EngineState): EngineState {
  return settleAndLiq(s);
}

export function setMark(s: EngineState, eth: number, opts?: { settle?: boolean }): EngineState {
  const next = { ...s, eth: Math.max(200, eth) };
  next.candles = pushCandle(s.candles, next.clock, next.eth);
  const c = maybeCircuit(next);
  if (opts?.settle === false) return c;
  return settleAndLiq(c);
}

export function advanceClock(s: EngineState, ms: number, opts?: { settle?: boolean }): EngineState {
  const next = { ...s, clock: s.clock + ms };
  if (opts?.settle === false) return next;
  return settleAndLiq(next);
}

export function exportTape(s: EngineState) {
  return {
    clock: s.clock,
    eth: s.eth,
    fills: s.fills,
    vault: s.vault,
    greeks: bookGreeks(s),
    iv: s.iv,
    rv: s.realizedVol,
    insuranceUsdc: s.insuranceUsdc,
    circuitUntil: s.circuitUntil,
    liquidations: s.liquidations,
  };
}

export function poolMark(s: EngineState, pool: EngineState["pools"][string]) {
  if (pool.base === "ETH" && pool.quote === "USDC") return Math.max(s.eth, 1e-9);
  if (pool.quote === "ETH" && pool.base === "WPIT") return Math.max(s.wpit / Math.max(s.eth, 1e-9), 1e-12);
  if (pool.quote === "USDC") {
    const px = tokenPx(s, pool.base);
    if (px > 0) return px;
  }
  return pool.baseReserve > 0 ? pool.quoteReserve / pool.baseReserve : 0;
}

export function addLiquidity(s: EngineState, poolId: PoolId, quoteAmt: number): EngineState | string {
  const money = requireMoney(quoteAmt, "Size");
  if (money) return money;
  if (quoteAmt <= 0) return "Size must be positive.";
  const pool = s.pools[poolId];
  if (!pool) return "Unknown pool.";
  // Re-anchor to the live mark K-CONSERVINGLY (same repin as `tick`, F7): the
  // old `quoteReserve = baseReserve · mark` rewrite destroyed/minted pool
  // value for existing LPs on every add (audit §3.7). repinPool trades both
  // reserves along x·y = k, exactly like the arbitrageur who would have
  // aligned the pool already.
  let target = 0;
  if (pool.base === "ETH" && pool.quote === "USDC") {
    target = s.eth;
  } else if (pool.base === "WPIT" && pool.quote === "USDC") {
    target = s.wpit;
  } else if (pool.base === "WPIT" && pool.quote === "ETH") {
    target = s.wpit / Math.max(s.eth, 1e-9);
  }
  const copy = { ...(target > 0 ? repinPool(pool, target) : pool) };
  const px = copy.quoteReserve / copy.baseReserve;
  const baseIn = quoteAmt / px;
  if (tokenBal(s.account, copy.quote) < quoteAmt || tokenBal(s.account, copy.base) < baseIn) {
    return `Need ${baseIn.toPrecision(6)} ${copy.base} and ${quoteAmt.toPrecision(6)} ${copy.quote} at the live mark.`;
  }
  const shares = copy.lpSupply > 0 ? (quoteAmt / copy.quoteReserve) * copy.lpSupply : Math.sqrt(baseIn * quoteAmt);
  let acc = creditToken(s.account, copy.quote, -quoteAmt);
  acc = creditToken(acc, copy.base, -baseIn);
  copy.quoteReserve += quoteAmt;
  copy.baseReserve += baseIn;
  copy.lpSupply += shares;
  const cost = quoteAmt * tokenPx(s, copy.quote) + baseIn * tokenPx(s, copy.base);
  return { ...s, account: acc, pools: { ...s.pools, [poolId]: copy }, lp: upsertLp(s.lp, poolId, shares, cost) };
}

export function removeLiquidity(s: EngineState, poolId: PoolId, shares: number): EngineState | string {
  const qty = requireFinitePositive(shares, "Shares");
  if (qty) return qty;
  const pos = s.lp.find((p) => p.poolId === poolId);
  if (!pos || pos.shares + 1e-12 < shares) return "Not enough LP shares.";
  const pool = s.pools[poolId];
  if (!pool || pool.lpSupply <= 0) return "Empty pool.";
  if (shares > pool.lpSupply + 1e-12) return "Shares exceed pool supply.";
  // Re-anchor to the live mark k-conservingly (parity with addLiquidity): an
  // exit pays pro-rata at the fair mark, never at a stale pool print, so the
  // exiting LP and the LPs left behind price on the same basis.
  let target = 0;
  if (pool.base === "ETH" && pool.quote === "USDC") target = s.eth;
  else if (pool.base === "WPIT" && pool.quote === "USDC") target = s.wpit;
  else if (pool.base === "WPIT" && pool.quote === "ETH") target = s.wpit / Math.max(s.eth, 1e-9);
  const repinned = target > 0 ? repinPool(pool, target) : pool;
  const frac = Math.min(1, shares / pool.lpSupply);
  const quoteOut = repinned.quoteReserve * frac;
  const baseOut = repinned.baseReserve * frac;
  const copy = { ...repinned, quoteReserve: repinned.quoteReserve - quoteOut, baseReserve: repinned.baseReserve - baseOut, lpSupply: pool.lpSupply - shares };
  let acc = creditToken(s.account, pool.quote, quoteOut);
  acc = creditToken(acc, pool.base, baseOut);
  const lp = s.lp
    .map((p) => {
      if (p.poolId !== poolId) return p;
      const left = p.shares - shares;
      const cost = (p.costUsdc ?? 0) * (left / p.shares);
      return { ...p, shares: left, costUsdc: cost };
    })
    .filter((p) => p.shares > 1e-9);
  return { ...s, account: acc, pools: { ...s.pools, [poolId]: copy }, lp };
}

export function tokenBal(acc: EngineState["account"], sym: string) {
  if (sym === "USDC") return acc.usdc;
  if (sym === "ETH") return acc.eth;
  if (sym === "WPIT") return acc.wpit;
  return acc.tokens?.[sym] ?? 0;
}

function creditToken(acc: EngineState["account"], sym: string, amt: number): EngineState["account"] {
  const next = { ...acc, tokens: { ...(acc.tokens ?? {}) } };
  if (sym === "USDC") next.usdc += amt;
  else if (sym === "ETH") next.eth += amt;
  else if (sym === "WPIT") next.wpit += amt;
  else next.tokens[sym] = (next.tokens[sym] ?? 0) + amt;
  return next;
}

export function createPool(
  s: EngineState,
  base: string,
  quote: string,
  baseAmt: number,
  quoteAmt: number,
  feeBps = 30,
): EngineState | string {
  const b = base.trim().toUpperCase();
  const q = quote.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(b) || !/^[A-Z][A-Z0-9]{1,9}$/.test(q)) return "Tickers must be 2–10 letters.";
  if (!b || !q || b === q) return "Pick two different tokens.";
  const bAmt = requireFinitePositive(baseAmt, "Base");
  if (bAmt) return bAmt;
  const qAmt = requireFinitePositive(quoteAmt, "Quote");
  if (qAmt) return qAmt;
  const id = `${b}-${q}`;
  if (s.pools[id] || s.pools[`${id}-TEST`]) return "Pool exists. Add liquidity instead.";
  if (tokenBal(s.account, b) < baseAmt) return `Need ${b}.`;
  if (tokenBal(s.account, q) < quoteAmt) return `Need ${q}.`;
  let acc = creditToken(s.account, b, -baseAmt);
  acc = creditToken(acc, q, -quoteAmt);
  const pool = {
    id,
    base: b,
    quote: q,
    baseReserve: baseAmt,
    quoteReserve: quoteAmt,
    lpSupply: Math.sqrt(baseAmt * quoteAmt),
    feeBps,
  };
  return {
    ...s,
    account: acc,
    pools: { ...s.pools, [id]: pool },
    lp: upsertLp(s.lp, id, pool.lpSupply, baseAmt * tokenPx(s, b) + quoteAmt * tokenPx({ ...s, account: acc }, q)),
  };
}

export function ensureListed(s: EngineState, symbol: string, mark: number): EngineState {
  const sym = symbol.trim().toUpperCase();
  if (!sym || sym === "USDC") return s;
  // Charting a token must not mint an unbacked AMM. Spot only exists if a pool was seeded with real legs.
  void mark;
  return s;
}

export function issueToken(s: EngineState, symbol: string, amt: number): EngineState | string {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(sym)) return "Symbol 2–10 letters.";
  if (["ETH", "USDC", "WPIT"].includes(sym)) return "Reserved ticker.";
  const qty = requireFinitePositive(amt, "Amount");
  if (qty) return qty;
  return { ...s, account: creditToken(s.account, sym, amt) };
}

function upsertLp(lp: EngineState["lp"], poolId: PoolId, shares: number, costUsdc = 0) {
  const i = lp.findIndex((p) => p.poolId === poolId);
  if (i < 0) return [...lp, { poolId, shares, costUsdc }];
  const copy = lp.slice();
  const cur = copy[i]!;
  copy[i] = { poolId, shares: cur.shares + shares, costUsdc: (cur.costUsdc ?? 0) + costUsdc };
  return copy;
}

export function closeOption(s: EngineState, id: string): EngineState | string {
  const pos = s.options.find((p) => p.id === id);
  if (!pos) return "Position not found.";
  const mid = optMark(s, pos);
  const bps = spreadBps(s);
  const tick = quoteTick(markOf(s, pos.under ?? "ETH"));
  // MM.md close concession: mid·(1−s_bps) − 0.40 for an ETH mini (quoteTick at
  // ETH prices = 0.40); scaled by tick for non-ETH underliers.
  const px = Math.max(Math.min(0.05, tick), mid * (1 - bps / 10_000) - tick);
  const credit = px * pos.sizeEth;
  const vault = { ...s.vault };
  vault.reservedEth = Math.max(0, vault.reservedEth - (pos.securedEth ?? ((pos.under ?? "ETH") === "ETH" && pos.type === "call" ? pos.sizeEth : 0)));
  vault.reservedUsdc = Math.max(0, vault.reservedUsdc - (pos.securedUsdc ?? (pos.type === "put" ? pos.strike * pos.sizeEth : 0)));
  // CRITICAL-1 fix: the buy-back is paid FROM the house, like every other
  // payout path (reduceFuture, settleAndLiq). Free vault USDC first, then
  // insurance; the part insurance cannot cover is a RECORDED HOLE — insurance
  // goes NEGATIVE and the circuit trips (same loud-shortfall semantics as
  // liquidation F11: the trader is paid in full, the vault halts). Never a
  // silent partial pay, and never a mint. (The old path credited the trader
  // without debiting the vault: every close minted ≈ the option's mark value
  // and inflated vaultNav — loosening the Γ/ν/insurance caps.)
  const floor = vault.reservedUsdc + (vault.escrowUsdc ?? 0);
  const free = Math.max(0, vault.usdc - floor);
  let insurance = s.insuranceUsdc;
  if (credit > free + 1e-9) {
    insurance -= credit - free; // may go negative → circuit
    vault.usdc -= free; // vault cash stops at the reserved floor, never below
  } else {
    vault.usdc -= credit;
  }
  const circuitUntil =
    insurance < 0 ? Math.max(s.circuitUntil ?? 0, s.clock + CIRCUIT_MS) : (s.circuitUntil ?? 0);
  const pnl = (px - pos.premium) * pos.sizeEth;
  const next: EngineState = {
    ...s,
    account: {
      ...s.account,
      usdc: s.account.usdc + credit,
      realized: s.account.realized + pnl,
    },
    vault,
    insuranceUsdc: insurance,
    circuitUntil,
    options: s.options.filter((p) => p.id !== id),
  };
  return hedgeDelta(
    pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "option",
      symbol: `${pos.under ?? "ETH"} ${pos.strike} ${pos.type} close`,
      side: "sell",
      size: pos.sizeEth,
      price: px,
      fee: 0,
      note: `PnL ${pnl.toFixed(2)}`,
    }, cashShot(s)),
  );
}

export function stakeWpit(s: EngineState, amt: number): EngineState | string {
  const qty = requireFinitePositive(amt, "Amount");
  if (qty) return qty;
  if (s.account.wpit + 1e-12 < amt) return "Insufficient WPIT.";
  return {
    ...s,
    account: { ...s.account, wpit: s.account.wpit - amt },
    stake: { amount: s.stake.amount + amt, since: s.clock },
  };
}

export function unstakeWpit(s: EngineState): EngineState {
  return {
    ...s,
    account: { ...s.account, wpit: s.account.wpit + s.stake.amount },
    stake: { amount: 0, since: s.clock },
  };
}

export function harvestFarm(s: EngineState): EngineState {
  const due = harvestDue(s);
  if (!(due > 0)) return s;
  const tax = due * 0.01;
  const net = due - tax;
  return {
    ...s,
    account: { ...s.account, wpit: s.account.wpit + net },
    farmWpit: Math.max(0, s.farmWpit - due),
    harvestedWpit: (s.harvestedWpit ?? 0) + net,
    insuranceUsdc: s.insuranceUsdc + tax * s.wpit,
  };
}

export function expiries(now: number) {
  const rows = [
    { label: "W1", at: nextFriday(now, 0) },
    { label: "W2", at: nextFriday(now, 1) },
    { label: "M", at: monthEnd(now) },
  ];
  return rows.map((r) => ({
    ...r,
    when: fmtExpiry(r.at),
    hours: (r.at - now) / 3_600_000,
  }));
}

export function fmtExpiry(at: number) {
  const d = new Date(at);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${wd} ${d.getUTCDate()} ${mon} ${hh}:${mm} UTC`;
}


export function optionQuote(s: EngineState, type: OptType, strike: number, expiry: number, under = "ETH") {
  const spot = markOf(s, under);
  const T = yearsTo(expiry, s.clock);
  const vol = smileVol(s, type, strike, T, spot);
  const mid = type === "call" ? bsCall(spot, strike, T, 0.03, vol) : bsPut(spot, strike, T, 0.03, vol);
  const d = bsDelta(spot, strike, T, 0.03, vol, type);
  const bps = spreadBps(s);
  const tick = quoteTick(spot);
  const g = bookGreeks(s);
  const why = !listedUnder(under)
    ? "Derivatives only on ETH and WPIT."
    : under === "ETH"
      ? rejectOption(s, type, strike, expiry, miniQty(under), g.gamma, g.vega)
      : s.vault.usdc - s.vault.reservedUsdc < (type === "call" ? spot : strike) * miniQty(under)
        ? "Not enough USDC to cash-secure."
        : null;
  const ask = mid * (1 + bps / 10_000) + tick;
  const bid = Math.max(Math.min(0.05, tick), mid * (1 - bps / 10_000) - tick);
  return { T, mid, bid: why ? 0 : bid, ask: why ? 0 : ask, delta: d, iv: vol, blank: why };
}

