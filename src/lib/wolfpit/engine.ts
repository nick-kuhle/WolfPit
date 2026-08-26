import { PIT_OPEN } from "./comp";
import {
  DERIV_FEE,
  FUT_IM,
  FUT_MM,
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
  type DeskSide,
  type OrderKind,
  type Tif,
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
  randn,
  uid,
  yearsTo,
} from "./math";
import {
  maybeCircuit,
  maxFillEth,
  rejectFuture,
  rejectOption,
  smileVol,
  spotFeeBps,
  gammaCash1h,
  vaultNav,
} from "./risk";

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

export const T0 = Date.UTC(2026, 7, 25, 20, 0, 0);

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
    },
    pools: {
      "ETH-USDC": {
        id: "ETH-USDC",
        base: "ETH",
        quote: "USDC",
        baseReserve: 250,
        quoteReserve: 250 * eth,
        lpSupply: 1000,
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
    insuranceUsdc: INSURANCE_SEED,
    circuitUntil: 0,
    simSpeed: 1,
    liquidations: 0,
    equityTape: [{ t: now, o: START_USDC + START_ETH * eth + START_WPIT * wpit, h: START_USDC + START_ETH * eth + START_WPIT * wpit, l: START_USDC + START_ETH * eth + START_WPIT * wpit, c: START_USDC + START_ETH * eth + START_WPIT * wpit, v: 1 }],
    compJoined: false,
    compPaid: false,
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
  const steps = Math.max(1, Math.round(dtSec));
  let p = px;
  for (let i = 0; i < steps; i++) {
    const r = rng(0x51a7e ^ ((((clock / 1000) | 0) + i * 19) * 2654435761));
    const dump = r() < 0.06;
    const ret = dump ? -(0.004 + r() * 0.02) : 0.004 + r() * 0.012;
    p = Math.max(0.01, p * (1 + ret));
  }
  return p;
}

export function tick(s: EngineState, dtSec: number): EngineState {
  const next = { ...s, account: { ...s.account }, vault: { ...s.vault }, pools: { ...s.pools } };
  next.clock = s.liveAt > 0 ? Date.now() : s.clock + dtSec * 1000;
  next.wpit = moonWpit(s.wpit, next.clock, dtSec);
  const pool = s.pools["WPIT-USDC-TEST"];
  if (pool && pool.baseReserve > 0) {
    next.pools["WPIT-USDC-TEST"] = { ...pool, quoteReserve: pool.baseReserve * next.wpit };
  }
  const ethPoolWpit = s.pools["WPIT-ETH-TEST"];
  if (ethPoolWpit && ethPoolWpit.baseReserve > 0 && next.eth > 0) {
    next.pools["WPIT-ETH-TEST"] = { ...ethPoolWpit, quoteReserve: (ethPoolWpit.baseReserve * next.wpit) / next.eth };
  }
  next.wpitCandles = pushCandle(s.wpitCandles, next.clock, next.wpit);

  const u = utilEth(next);
  const emit = WPIT_EMIT_PER_SEC * dtSec * (0.3 + 0.7 * u);
  next.farmWpit = s.farmWpit + emit * 0.9;
  next.insuranceUsdc = (s.insuranceUsdc ?? INSURANCE_SEED) + emit * 0.1 * next.wpit;
  const ethPool = s.pools["ETH-USDC"];
  if (ethPool) {
    next.pools["ETH-USDC"] = { ...ethPool, feeBps: spotFeeBps(next.realizedVol) };
  }
  if (s.stake.amount > 0) {
    next.account = {
      ...next.account,
      wpit: next.account.wpit + (s.stake.amount * STAKE_APR * dtSec) / (365.25 * 24 * 3600),
    };
  }
  return matchWorking(pushEquity(hedgeDelta(settleAndLiq(maybeCircuit(next)))));
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
  const rv = ewmaRv(feed.candles);
  const pools = { ...s.pools };
  const ethPool = pools["ETH-USDC"];
  if (ethPool) {
    pools["ETH-USDC"] = { ...ethPool, quoteReserve: ethPool.baseReserve * feed.eth };
  }
  const next: EngineState = {
    ...s,
    eth: feed.eth,
    ethBid: feed.ethBid ?? feed.eth,
    ethAsk: feed.ethAsk ?? feed.eth,
    btc: feed.btc ?? s.btc,
    candles: feed.candles,
    realizedVol: clamp(rv, 0.15, 2),
    iv: clamp(1.08 * rv, 0.28, 1.6),
    clock: feed.at,
    liveAt: feed.at,
    liveSource: feed.source,
    pools,
    account: {
      ...s.account,
      startEquity: s.liveAt === 0 ? START_USDC + START_ETH * feed.eth : s.account.startEquity,
    },
  };
  return matchWorking(pushEquity(settleAndLiq(maybeCircuit(next))));
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

export function resampleCandles(bars: EngineState["candles"], intervalMs: number) {
  if (bars.length < 2 || intervalMs <= 60_000) return bars;
  const out: EngineState["candles"] = [];
  for (const c of bars) {
    const bucket = Math.floor(c.t / intervalMs) * intervalMs;
    const last = out[out.length - 1];
    if (!last || last.t !== bucket) out.push({ ...c, t: bucket });
    else {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    }
  }
  return out;
}

export function equity(s: EngineState) {
  const spot = s.account.usdc + s.account.eth * s.eth + s.account.wpit * s.wpit;
  const extras = Object.entries(s.account.tokens ?? {}).reduce((a, [k, v]) => a + v * tokenPx(s, k), 0);
  const fut = s.futures.reduce((a, p) => a + p.margin + futPnl(p, markOf(s, p.under ?? "ETH")), 0);
  const opt = s.options.reduce((a, p) => a + optMark(s, p) * p.sizeEth, 0);
  const lpVal = s.lp.reduce((a, p) => a + lpValue(s, p.poolId, p.shares), 0);
  return spot + extras + fut + opt + lpVal + s.stake.amount * s.wpit;
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
  const first = [...tape].reverse().find((c) => c.t <= start + 86_400_000 && c.t >= start) ?? tape[0];
  if (!first) return eq - s.account.startEquity;
  return eq - first.c;
}

export function liqHealth(s: EngineState) {
  if (s.futures.length === 0) return { label: "CLEAR", score: 2, tone: "up" as const };
  let worst = 99;
  for (const p of s.futures) {
    const mark = markOf(s, p.under ?? "ETH");
    const eq = p.margin + futPnl(p, mark);
    const maint = p.sizeEth * mark * FUT_MM;
    worst = Math.min(worst, eq / Math.max(maint, 1e-9));
  }
  if (worst < 1.05) return { label: "LIQ", score: worst, tone: "down" as const };
  if (worst < 1.4) return { label: "TIGHT", score: worst, tone: "warn" as const };
  return { label: "SOLID", score: worst, tone: "up" as const };
}

export function joinCompetition(s: EngineState, now = Date.now()): EngineState {
  const eq0 = PIT_OPEN.entryUsdc;
  return {
    ...s,
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

export function payCompPrize(s: EngineState, place: number): EngineState {
  if (s.compPaid || !s.compJoined) return s;
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

export function farmShare(s: EngineState, id: PoolId) {
  if (id === "WPIT-USDC" || id === "WPIT-USDC-TEST") return 0.2;
  if (id === "WPIT-ETH" || id === "WPIT-ETH-TEST") return 0.1;
  if (id === "ETH-USDC") return 0.55;
  const custom = Object.keys(s.pools).filter(
    (k) => k !== "ETH-USDC" && !k.startsWith("WPIT-USDC") && !k.startsWith("WPIT-ETH"),
  );
  return custom.length ? 0.15 / custom.length : 0;
}

export function farmApy(s: EngineState, id: PoolId) {
  const tvl = poolTvl(s, id);
  if (tvl < 1) return 0;
  const u = 0.3 + 0.7 * utilEth(s);
  const usdYear = WPIT_EMIT_PER_SEC * 0.9 * u * 365.25 * 86400 * Math.max(s.wpit, 0.01);
  const volAdj = 1 + Math.min(0.5, s.realizedVol);
  return (usdYear * farmShare(s, id) * volAdj) / tvl;
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

export function quoteTick(spot: number) {
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

export function freeEth(s: EngineState) {
  return Math.max(0, s.vault.eth - s.vault.reservedEth);
}
export function freeUsdc(s: EngineState) {
  return Math.max(0, s.vault.usdc - s.vault.reservedUsdc);
}
export function utilEth(s: EngineState) {
  return s.vault.eth <= 0 ? 1 : s.vault.reservedEth / s.vault.eth;
}

export function maxNetLongEth(s: EngineState) {
  return Math.max(0, s.vault.eth * UTIL_CAP - s.vault.reservedEth);
}
export function maxNetShortEth(s: EngineState) {
  return Math.max(0, (s.vault.usdc * UTIL_CAP) / s.eth - s.vault.reservedUsdc / s.eth);
}

export function spreadBps(s: EngineState) {
  const g = bookGreeks(s);
  const nav = Math.max(vaultNav(s), 1);
  const inv = Math.abs(g.delta) / Math.max(s.vault.eth, 1e-6);
  const gCash = gammaCash1h(Math.abs(g.gamma), s.eth, s.iv) / nav;
  const vega = Math.abs(g.vega) / nav;
  const pool = s.pools["ETH-USDC"];
  const depth = pool?.baseReserve ?? 1;
  const thin = clamp(50 / Math.max(depth, 1), 0, 50);
  const vol = Math.max(s.realizedVol, s.iv);
  return clamp(8 + utilEth(s) * 70 + Math.max(0, vol - 0.4) * 90 + inv * 45 + gCash * 220 + vega * 90 + thin, 8, 280);
}

export function reservationPx(s: EngineState) {
  const q = bookGreeks(s).delta / Math.max(s.vault.eth, 1);
  const gamma = 0.08;
  const tau = 1 / 24;
  const shift = q * gamma * s.realizedVol * s.realizedVol * tau;
  return s.eth * (1 - shift);
}

export function quoteInForBaseOut(pool: EngineState["pools"][string], baseOut: number) {
  if (!pool || baseOut <= 0 || baseOut >= pool.baseReserve * 0.99) return Number.POSITIVE_INFINITY;
  const fee = 1 - pool.feeBps / 10_000;
  return (pool.quoteReserve * baseOut) / (fee * (pool.baseReserve - baseOut));
}

export function placeDeskOrder(
  s: EngineState,
  o: Omit<WorkingOrder, "id" | "created">,
): EngineState | string {
  if (o.qty <= 0) return "Quantity must be positive.";
  if ((o.kind === "lmt" || o.kind === "stl") && !(o.limit && o.limit > 0)) return "Limit price required.";
  if ((o.kind === "stp" || o.kind === "stl") && !(o.stop && o.stop > 0)) return "Stop price required.";
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
  return { ...s, working: [order, ...(s.working ?? [])].slice(0, 40) };
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

function tryFill(s: EngineState, o: WorkingOrder): EngineState | string {
  const under = o.under ?? "ETH";
  if (o.product === "spot") {
    const poolId = o.poolId ?? "ETH-USDC";
    const pool = s.pools[poolId];
    if (!pool) return "Unknown pool.";
    if (o.side === "buy") {
      const quote = quoteInForBaseOut(pool, o.qty);
      if (!Number.isFinite(quote)) return "Size too large for pool.";
      return tradeSpot(s, poolId, "buy", quote);
    }
    return tradeSpot(s, poolId, "sell", o.qty);
  }
  if (o.product === "future") {
    const contracts = o.qty;
    const side = o.side === "buy" ? "long" : "short";
    return tradeFuture(s, side, contracts, o.expiry ?? expiries(s.clock)[0]!.at, under);
  }
  if (o.product === "option") {
    if (o.side === "sell") return "Close longs from Positions. Vault does not buy options.";
    const spot = markOf(s, under);
    const ks = strikeGrid(spot);
    const strike = o.strike ?? ks[Math.floor(ks.length / 2)]!;
    return buyOption(s, o.optType ?? "call", strike, o.expiry ?? expiries(s.clock)[0]!.at, o.qty, under);
  }
  return "Unknown product.";
}

export function matchWorking(s: EngineState): EngineState {
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
    delta += p.side === "long" ? -p.sizeEth : p.sizeEth;
  }
  for (const p of s.options) {
    const under = p.under ?? "ETH";
    if (under !== "ETH") continue;
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

export function futLiqPrice(p: EngineState["futures"][number], mm = FUT_MM) {
  const q = p.sizeEth;
  if (q <= 0) return p.entry;
  if (p.side === "long") return (p.entry * q - p.margin) / (q * (1 - mm));
  return (p.margin + p.entry * q) / (q * (1 + mm));
}

export function futMaint(p: EngineState["futures"][number], mark: number) {
  return p.sizeEth * mark * FUT_MM;
}

export function usedMargin(s: EngineState) {
  return s.futures.reduce((a, p) => a + p.margin, 0);
}

export function buyingPower(s: EngineState) {
  return Math.max(0, s.account.usdc);
}

export function maxMiniContracts(s: EngineState, side: FutSide) {
  const im = MINI_ETH * s.eth * FUT_IM;
  const fee = MINI_ETH * s.eth * DERIV_FEE;
  const byCash = Math.floor(buyingPower(s) / Math.max(im + fee, 1e-9));
  const cap = side === "long" ? maxNetLongEth(s) : maxNetShortEth(s);
  const byInv = Math.floor(cap / MINI_ETH);
  const byFill = Math.floor(maxFillEth(s, side) / MINI_ETH);
  return Math.max(0, Math.min(byCash, byInv, byFill));
}

export function refreshQuotes(s: EngineState): EngineState {
  const mid = reservationPx(s);
  const bps = spreadBps(s);
  return { ...s, ethBid: mid * (1 - bps / 10_000), ethAsk: mid * (1 + bps / 10_000) };
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
  if (Math.abs(gap) < 0.005) return refreshQuotes(s);
  const pool0 = s.pools["ETH-USDC"];
  if (!pool0) return refreshQuotes(s);
  const vault = { ...s.vault, hedgeEth: s.vault.hedgeEth ?? 0 };
  const pool = { ...pool0 };
  const band = pool.baseReserve * 0.08;
  if (gap > 0) {
    const sell = Math.min(gap, band, Math.max(0, vault.eth - vault.reservedEth));
    if (sell < 0.005) return refreshQuotes({ ...s, vault });
    const out = ammOut(sell, pool.baseReserve, pool.quoteReserve, pool.feeBps);
    vault.eth -= sell;
    vault.usdc += out;
    vault.hedgeEth -= sell;
    pool.baseReserve += sell;
    pool.quoteReserve -= out;
  } else {
    const want = Math.min(-gap, band);
    const cost = quoteInForBaseOut(pool, want);
    const freeUsdc = Math.max(0, vault.usdc - vault.reservedUsdc);
    if (!Number.isFinite(cost) || cost > freeUsdc || want < 0.005) return refreshQuotes({ ...s, vault });
    const got = ammOut(cost, pool.quoteReserve, pool.baseReserve, pool.feeBps);
    vault.usdc -= cost;
    vault.eth += got;
    vault.hedgeEth += got;
    pool.quoteReserve += cost;
    pool.baseReserve -= got;
  }
  return refreshQuotes({ ...s, vault, pools: { ...s.pools, "ETH-USDC": pool } });
}

function pushFill(s: EngineState, fill: EngineState["fills"][number]): EngineState {
  return { ...s, fills: [fill, ...s.fills].slice(0, 80) };
}

export function tradeSpot(s: EngineState, poolId: PoolId, side: "buy" | "sell", quoteAmt: number): EngineState | string {
  if (quoteAmt <= 0) return "Size must be positive.";
  const pool = { ...s.pools[poolId] };
  const acc = { ...s.account };
  if (side === "buy") {
    if (acc.usdc < quoteAmt && poolId !== "WPIT-ETH-TEST") return "Insufficient USDC.";
    if (poolId === "WPIT-ETH-TEST") {
      if (acc.eth * s.eth < quoteAmt) return "Insufficient ETH.";
      const ethIn = quoteAmt / s.eth;
      const out = ammOut(ethIn, pool.quoteReserve, pool.baseReserve, pool.feeBps);
      acc.eth -= ethIn;
      acc.wpit += out;
      pool.quoteReserve += ethIn;
      pool.baseReserve -= out;
      const next = {
        ...s,
        account: acc,
        pools: { ...s.pools, [poolId]: pool },
        wpit: pool.quoteReserve > 0 ? (pool.quoteReserve * s.eth) / pool.baseReserve : s.wpit,
      };
      return pushFill(next, {
        id: uid("f"),
        t: s.clock,
        product: "spot",
        symbol: poolId,
        side: "buy",
        size: out,
        price: quoteAmt / Math.max(out, 1e-9),
        fee: quoteAmt * (pool.feeBps / 10_000),
      });
    }
    const out = ammOut(quoteAmt, pool.quoteReserve, pool.baseReserve, pool.feeBps);
    acc.usdc -= quoteAmt;
    if (poolId === "ETH-USDC") acc.eth += out;
    else acc.wpit += out;
    pool.quoteReserve += quoteAmt;
    pool.baseReserve -= out;
    const next = { ...s, account: acc, pools: { ...s.pools, [poolId]: pool } };
    if (poolId === "WPIT-USDC-TEST") next.wpit = pool.quoteReserve / pool.baseReserve;
    return pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "spot",
      symbol: poolId,
      side: "buy",
      size: out,
      price: quoteAmt / Math.max(out, 1e-9),
      fee: quoteAmt * (pool.feeBps / 10_000),
    });
  }
  if (poolId === "ETH-USDC") {
    if (acc.eth < quoteAmt) return "Insufficient ETH.";
    const out = ammOut(quoteAmt, pool.baseReserve, pool.quoteReserve, pool.feeBps);
    acc.eth -= quoteAmt;
    acc.usdc += out;
    pool.baseReserve += quoteAmt;
    pool.quoteReserve -= out;
    const next = { ...s, account: acc, pools: { ...s.pools, [poolId]: pool } };
    return pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "spot",
      symbol: poolId,
      side: "sell",
      size: quoteAmt,
      price: out / quoteAmt,
      fee: out * (pool.feeBps / 10_000),
    });
  }
  if (acc.wpit < quoteAmt) return "Insufficient WPIT.";
  const out = ammOut(quoteAmt, pool.baseReserve, pool.quoteReserve, pool.feeBps);
  acc.wpit -= quoteAmt;
  if (poolId === "WPIT-ETH-TEST") acc.eth += out;
  else acc.usdc += out;
  pool.baseReserve += quoteAmt;
  pool.quoteReserve -= out;
  const next = { ...s, account: acc, pools: { ...s.pools, [poolId]: pool }, wpit: poolId === "WPIT-USDC-TEST" ? pool.quoteReserve / pool.baseReserve : s.wpit };
  return pushFill(next, {
    id: uid("f"),
    t: s.clock,
    product: "spot",
    symbol: poolId,
    side: "sell",
    size: quoteAmt,
    price: out / Math.max(quoteAmt, 1e-9),
    fee: out * (pool.feeBps / 10_000),
  });
}

export function tradeFuture(s: EngineState, side: FutSide, contracts: number, expiry: number, under = "ETH"): EngineState | string {
  const sizeEth = contracts * miniQty(under);
  if (under !== "ETH") {
    const mark = markOf(s, under);
    const bps = spreadBps(s);
    const px = side === "long" ? mark * (1 + bps / 10_000) : mark * (1 - bps / 10_000);
    const notional = sizeEth * px;
    const margin = notional * FUT_IM;
    const fee = notional * DERIV_FEE;
    if (s.account.usdc < margin + fee) return "Insufficient USDC for initial margin + fee.";
    const vault = { ...s.vault, reservedUsdc: s.vault.reservedUsdc + notional };
    const pos = { id: uid("fut"), side, sizeEth, entry: px, expiry, margin, openedAt: s.clock, under };
    const next: EngineState = {
      ...s,
      account: { ...s.account, usdc: s.account.usdc - margin - fee, realized: s.account.realized - fee },
      vault,
      futures: [...s.futures, pos],
    };
    return takeFee(
      pushFill(next, {
        id: uid("f"),
        t: s.clock,
        product: "future",
        symbol: `${under} mini ${fmtExpiry(expiry)}`,
        side,
        size: sizeEth,
        price: px,
        fee,
        note: "cash-settled · USDC IM",
      }),
      fee,
    );
  }
  const why = rejectFuture(s, side, sizeEth, expiry);
  if (why) return why;
  const bps = spreadBps(s);
  const mid = reservationPx(s);
  const px = side === "long" ? mid * (1 + bps / 10_000) : mid * (1 - bps / 10_000);
  const notional = sizeEth * px;
  const margin = notional * FUT_IM;
  const fee = notional * DERIV_FEE;
  if (s.account.usdc < margin + fee) return "Insufficient USDC for initial margin + fee.";
  const vault = { ...s.vault };
  if (side === "long") {
    vault.reservedEth += sizeEth;
  } else {
    vault.reservedUsdc += notional;
    vault.eth -= sizeEth;
    vault.usdc += sizeEth * px;
  }
  const pos = {
    id: uid("fut"),
    side,
    sizeEth,
    entry: px,
    expiry,
    margin,
    openedAt: s.clock,
  };
  const next: EngineState = {
    ...s,
    account: { ...s.account, usdc: s.account.usdc - margin - fee, realized: s.account.realized - fee },
    vault,
    futures: [...s.futures, pos],
  };
  return hedgeDelta(
    takeFee(
      pushFill(next, {
        id: uid("f"),
        t: s.clock,
        product: "future",
        symbol: `ETH mini ${new Date(expiry).toISOString().slice(0, 16).replace("T", " ")} UTC`,
        side,
        size: sizeEth,
        price: px,
        fee,
        note: "covered · delta-hedged",
      }),
      fee,
    ),
  );
}

export function closeFuture(s: EngineState, id: string): EngineState | string {
  const pos = s.futures.find((p) => p.id === id);
  if (!pos) return "Position not found.";
  const pnl = futPnl(pos, s.eth);
  const vault = { ...s.vault };
  if (pos.side === "long") {
    vault.reservedEth = Math.max(0, vault.reservedEth - pos.sizeEth);
  } else {
    vault.reservedUsdc = Math.max(0, vault.reservedUsdc - pos.entry * pos.sizeEth);
    vault.eth += pos.sizeEth;
    vault.usdc -= pos.sizeEth * s.eth;
  }
  const next: EngineState = {
    ...s,
    account: {
      ...s.account,
      usdc: s.account.usdc + pos.margin + pnl,
      realized: s.account.realized + pnl,
    },
    vault,
    futures: s.futures.filter((p) => p.id !== id),
  };
  return hedgeDelta(
    pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "future",
      symbol: "ETH mini close",
      side: pos.side === "long" ? "sell" : "buy",
      size: pos.sizeEth,
      price: s.eth,
      fee: 0,
      note: `PnL ${pnl.toFixed(2)}`,
    }),
  );
}

export function buyOption(s: EngineState, type: OptType, strike: number, expiry: number, contracts: number, under = "ETH"): EngineState | string {
  const sizeEth = contracts * miniQty(under);
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
    const pos = { id: uid("opt"), type, strike, expiry, sizeEth, premium: px, openedAt: s.clock, under };
    const next: EngineState = {
      ...s,
      account: { ...s.account, usdc: s.account.usdc - premium - fee, realized: s.account.realized - fee },
      vault,
      options: [...s.options, pos],
    };
    return takeFee(
      pushFill(next, {
        id: uid("f"),
        t: s.clock,
        product: "option",
        symbol: `${under} ${strike} ${type} mini`,
        side: "buy",
        size: sizeEth,
        price: px,
        fee,
        note: "cash-settled · cash-secured",
      }),
      fee,
    );
  }
  const g = bookGreeks(s);
  const why = rejectOption(s, type, strike, expiry, sizeEth, g.gamma, g.vega);
  if (why) return why;
  const T = yearsTo(expiry, s.clock);
  if (T <= 0) return "That expiry is done.";
  const vol = smileVol(s, type, strike, T);
  const mid = type === "call" ? bsCall(s.eth, strike, T, 0.03, vol) : bsPut(s.eth, strike, T, 0.03, vol);
  const bps = spreadBps(s);
  const px = mid * (1 + bps / 10_000) + 0.5;
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
  };
  const next: EngineState = {
    ...s,
    account: { ...s.account, usdc: s.account.usdc - premium - fee, realized: s.account.realized - fee },
    vault,
    options: [...s.options, pos],
  };
  return hedgeDelta(
    takeFee(
      pushFill(next, {
        id: uid("f"),
        t: s.clock,
        product: "option",
        symbol: `ETH ${strike} ${type} mini`,
        side: "buy",
        size: sizeEth,
        price: px,
        fee,
        note: "covered / cash-secured · delta-hedged",
      }),
      fee,
    ),
  );
}

function settleAndLiq(s: EngineState): EngineState {
  let next = s;
  for (const p of s.futures) {
    const mark = markOf(next, p.under ?? "ETH");
    const eq = p.margin + futPnl(p, mark);
    const maint = p.sizeEth * mark * FUT_MM;
    if (eq < maint || s.clock >= p.expiry) {
      const closed = closeFuture(next, p.id);
      if (typeof closed !== "string") {
        next = {
          ...closed,
          liquidations: eq < maint ? next.liquidations + 1 : next.liquidations,
          insuranceUsdc:
            eq < maint
              ? next.insuranceUsdc + Math.min(Math.max(eq, 0), 0.01 * p.sizeEth * mark)
              : next.insuranceUsdc,
        };
      }
    }
  }
  const remaining: EngineState["options"] = [];
  let vault = { ...next.vault };
  let acc = { ...next.account };
  for (const p of next.options) {
    if (next.clock < p.expiry) {
      remaining.push(p);
      continue;
    }
    const spot = markOf(next, p.under ?? "ETH");
    const intrinsic = p.type === "call" ? Math.max(spot - p.strike, 0) : Math.max(p.strike - spot, 0);
    const payoff = intrinsic * p.sizeEth;
    acc = { ...acc, usdc: acc.usdc + payoff, realized: acc.realized + payoff - p.premium * p.sizeEth };
    if ((p.under ?? "ETH") === "ETH") {
      if (p.type === "call") vault.reservedEth = Math.max(0, vault.reservedEth - p.sizeEth);
      else vault.reservedUsdc = Math.max(0, vault.reservedUsdc - p.strike * p.sizeEth);
    } else {
      const lock = p.type === "call" ? spot * p.sizeEth : p.strike * p.sizeEth;
      vault.reservedUsdc = Math.max(0, vault.reservedUsdc - lock);
    }
  }
  return hedgeDelta({ ...next, options: remaining, vault, account: acc });
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
  if (quoteAmt <= 0) return "Size must be positive.";
  const pool = s.pools[poolId];
  if (!pool) return "Unknown pool.";
  const copy = { ...pool };
  if (copy.base === "ETH" && copy.quote === "USDC") {
    copy.quoteReserve = copy.baseReserve * s.eth;
  } else if (copy.base === "WPIT" && copy.quote === "USDC") {
    copy.quoteReserve = copy.baseReserve * s.wpit;
  } else if (copy.base === "WPIT" && copy.quote === "ETH") {
    copy.quoteReserve = (copy.baseReserve * s.wpit) / Math.max(s.eth, 1e-9);
  }
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
  return { ...s, account: acc, pools: { ...s.pools, [poolId]: copy }, lp: upsertLp(s.lp, poolId, shares) };
}

export function removeLiquidity(s: EngineState, poolId: PoolId, shares: number): EngineState | string {
  if (shares <= 0) return "Size must be positive.";
  const pos = s.lp.find((p) => p.poolId === poolId);
  if (!pos || pos.shares + 1e-12 < shares) return "Not enough LP shares.";
  const pool = s.pools[poolId];
  if (!pool || pool.lpSupply <= 0) return "Empty pool.";
  const frac = shares / pool.lpSupply;
  const quoteOut = pool.quoteReserve * frac;
  const baseOut = pool.baseReserve * frac;
  const copy = { ...pool, quoteReserve: pool.quoteReserve - quoteOut, baseReserve: pool.baseReserve - baseOut, lpSupply: pool.lpSupply - shares };
  let acc = creditToken(s.account, pool.quote, quoteOut);
  acc = creditToken(acc, pool.base, baseOut);
  const lp = s.lp
    .map((p) => (p.poolId === poolId ? { ...p, shares: p.shares - shares } : p))
    .filter((p) => p.shares > 1e-9);
  return { ...s, account: acc, pools: { ...s.pools, [poolId]: copy }, lp };
}

export function tokenBal(acc: EngineState["account"], sym: string) {
  if (sym === "USDC") return acc.usdc;
  if (sym === "ETH") return acc.eth;
  if (sym === "WPIT") return acc.wpit;
  return acc.tokens?.[sym] ?? 0;
}

export function creditToken(acc: EngineState["account"], sym: string, amt: number): EngineState["account"] {
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
  if (!b || !q || b === q) return "Pick two different tokens.";
  if (baseAmt <= 0 || quoteAmt <= 0) return "Both legs must be positive.";
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
    lp: upsertLp(s.lp, id, pool.lpSupply),
  };
}

export function ensureListed(s: EngineState, symbol: string, mark: number): EngineState {
  const sym = symbol.trim().toUpperCase();
  if (!sym || sym === "USDC") return s;
  if (sym === "WPIT" && (s.pools["WPIT-USDC-TEST"] || s.pools["WPIT-USDC"])) return s;
  const id = `${sym}-USDC`;
  if (s.pools[id]) return s;
  const px = Math.max(mark, 1e-9);
  const baseReserve = sym === "ETH" ? s.pools["ETH-USDC"]?.baseReserve ?? 250 : 10_000;
  const quoteReserve = baseReserve * px;
  return {
    ...s,
    pools: {
      ...s.pools,
      [id]: {
        id,
        base: sym,
        quote: "USDC",
        baseReserve,
        quoteReserve,
        lpSupply: Math.sqrt(baseReserve * quoteReserve),
        feeBps: 30,
      },
    },
  };
}

export function issueToken(s: EngineState, symbol: string, amt: number): EngineState | string {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(sym)) return "Symbol 2–10 letters.";
  if (["ETH", "USDC", "WPIT"].includes(sym)) return "Reserved ticker.";
  if (amt <= 0) return "Amount must be positive.";
  return { ...s, account: creditToken(s.account, sym, amt) };
}

function upsertLp(lp: EngineState["lp"], poolId: PoolId, shares: number) {
  const i = lp.findIndex((p) => p.poolId === poolId);
  if (i < 0) return [...lp, { poolId, shares }];
  const copy = lp.slice();
  copy[i] = { poolId, shares: copy[i]!.shares + shares };
  return copy;
}

export function closeOption(s: EngineState, id: string): EngineState | string {
  const pos = s.options.find((p) => p.id === id);
  if (!pos) return "Position not found.";
  const mid = optMark(s, pos);
  const bps = spreadBps(s);
  const px = Math.max(0.05, mid * (1 - bps / 10_000));
  const credit = px * pos.sizeEth;
  const vault = { ...s.vault };
  if (pos.type === "call") vault.reservedEth = Math.max(0, vault.reservedEth - pos.sizeEth);
  else vault.reservedUsdc = Math.max(0, vault.reservedUsdc - pos.strike * pos.sizeEth);
  const pnl = (px - pos.premium) * pos.sizeEth;
  const next: EngineState = {
    ...s,
    account: {
      ...s.account,
      usdc: s.account.usdc + credit,
      realized: s.account.realized + pnl,
    },
    vault,
    options: s.options.filter((p) => p.id !== id),
  };
  return hedgeDelta(
    pushFill(next, {
      id: uid("f"),
      t: s.clock,
      product: "option",
      symbol: `ETH ${pos.strike} ${pos.type} close`,
      side: "sell",
      size: pos.sizeEth,
      price: px,
      fee: 0,
      note: `PnL ${pnl.toFixed(2)}`,
    }),
  );
}

export function stakeWpit(s: EngineState, amt: number): EngineState | string {
  if (amt <= 0) return "Amount must be positive.";
  if (s.account.wpit < amt) return "Insufficient WPIT.";
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
  const tax = s.farmWpit * 0.01;
  const net = s.farmWpit - tax;
  return {
    ...s,
    account: { ...s.account, wpit: s.account.wpit + net },
    farmWpit: 0,
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

export function strikes(spot: number) {
  const g = strikeGrid(spot);
  const mid = Math.floor(g.length / 2);
  return g.slice(Math.max(0, mid - 2), mid + 3);
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
  const why =
    under === "ETH"
      ? rejectOption(s, type, strike, expiry, miniQty(under), g.gamma, g.vega)
      : s.vault.usdc - s.vault.reservedUsdc < (type === "call" ? spot : strike) * miniQty(under)
        ? "Not enough USDC to cash-secure."
        : null;
  const ask = mid * (1 + bps / 10_000) + tick;
  const bid = Math.max(tick * 0.25, mid * (1 - bps / 10_000) - tick);
  return { T, mid, bid: why ? 0 : bid, ask: why ? 0 : ask, delta: d, iv: vol, blank: why };
}

