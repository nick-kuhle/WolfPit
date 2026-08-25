import {
  DERIV_FEE,
  FUT_IM,
  FUT_MM,
  INSURANCE_SEED,
  MINI_ETH,
  PoolId,
  STAKE_APR,
  UTIL_CAP,
  WPIT_EMIT_PER_SEC,
  type EngineState,
  type FutSide,
  type OptType,
} from "./types";
import {
  ammOut,
  bsCall,
  bsDelta,
  bsGamma,
  bsPut,
  bsVega,
  clamp,
  ivSmile,
  monthEnd,
  nextFriday,
  randn,
  uid,
  yearsTo,
} from "./math";
import {
  maybeCircuit,
  rejectFuture,
  rejectOption,
  smileVol,
  spotFeeBps,
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
  const wpit = 1;
  return {
    clock: now,
    eth,
    wpit,
    iv: 0.62,
    realizedVol: 0.55,
    candles: seedCandles(now, eth, "eth"),
    wpitCandles: seedCandles(now, wpit, "wpit"),
    account: {
      usdc: 100_000,
      eth: 0,
      wpit: 0,
      realized: 0,
      startEquity: 100_000,
    },
    vault: {
      eth: 100,
      usdc: 400_000,
      reservedEth: 0,
      reservedUsdc: 0,
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
    farmWpit: 0,
    insuranceUsdc: INSURANCE_SEED,
    circuitUntil: 0,
    simSpeed: 1,
    liquidations: 0,
  };
}

function seedCandles(now: number, px: number, kind: "eth" | "wpit") {
  const r = rng(kind === "eth" ? 0x0c0ffee : 0x0b00b1e);
  const out = [];
  let p = px * 0.985;
  const vol = kind === "eth" ? 0.008 : 0.02;
  for (let i = 180; i >= 0; i--) {
    const t = now - i * 60_000;
    const n = nrand(r) * vol;
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

export function tick(s: EngineState, dtSec: number): EngineState {
  const next = { ...s, account: { ...s.account }, vault: { ...s.vault } };
  const dt = dtSec / (365.25 * 24 * 3600);
  const sigma = 0.7;
  const shock = randn() * sigma * Math.sqrt(dt) + (Math.random() < 0.008 ? randn() * 0.012 : 0);
  next.eth = Math.max(200, s.eth * Math.exp(shock));
  const wShock = randn() * 1.1 * Math.sqrt(dt);
  const pool = s.pools["WPIT-USDC-TEST"];
  const poolPx = pool.quoteReserve / pool.baseReserve;
  next.wpit = Math.max(0.01, poolPx * 0.85 + next.wpit * 0.1 * Math.exp(wShock) + s.wpit * 0.05);
  next.clock = s.clock + dtSec * 1000;
  const instVol = Math.abs(shock) * Math.sqrt(365.25 * 24 * 3600);
  next.realizedVol = clamp(s.realizedVol * 0.94 + instVol * 0.06, 0.2, 2);
  next.iv = clamp(1.08 * next.realizedVol, 0.28, 1.6);

  next.candles = pushCandle(s.candles, next.clock, next.eth);
  next.wpitCandles = pushCandle(s.wpitCandles, next.clock, next.wpit);

  const u = utilEth(next);
  const emit = WPIT_EMIT_PER_SEC * dtSec * (0.3 + 0.7 * u);
  const toFarm = emit * 0.9;
  const toIns = emit * 0.1 * next.wpit;
  next.farmWpit = s.farmWpit + toFarm;
  next.insuranceUsdc = (s.insuranceUsdc ?? INSURANCE_SEED) + toIns;
  const ethPool = { ...next.pools["ETH-USDC"], feeBps: spotFeeBps(next.realizedVol) };
  next.pools = { ...s.pools, "ETH-USDC": ethPool };
  if (s.stake.amount > 0) {
    next.account = {
      ...next.account,
      wpit: next.account.wpit + (s.stake.amount * STAKE_APR * dtSec) / (365.25 * 24 * 3600),
    };
  }

  return settleAndLiq(maybeCircuit(next));
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

export function equity(s: EngineState) {
  const spot = s.account.usdc + s.account.eth * s.eth + s.account.wpit * s.wpit;
  const fut = s.futures.reduce((a, p) => a + p.margin + futPnl(p, s.eth), 0);
  const opt = s.options.reduce((a, p) => a + optMark(s, p) * p.sizeEth, 0);
  const lpVal = s.lp.reduce((a, p) => a + lpValue(s, p.poolId, p.shares), 0);
  return spot + fut + opt + lpVal + s.stake.amount * s.wpit;
}

export function futPnl(p: EngineState["futures"][number], mark: number) {
  const dir = p.side === "long" ? 1 : -1;
  return dir * (mark - p.entry) * p.sizeEth;
}

export function optMark(s: EngineState, p: EngineState["options"][number]) {
  const T = yearsTo(p.expiry, s.clock);
  const vol = ivSmile(s.iv, s.eth, p.strike, T);
  return p.type === "call" ? bsCall(s.eth, p.strike, T, 0.03, vol) : bsPut(s.eth, p.strike, T, 0.03, vol);
}

export function lpValue(s: EngineState, id: PoolId, shares: number) {
  const pool = s.pools[id];
  if (pool.lpSupply <= 0) return 0;
  const frac = shares / pool.lpSupply;
  const quotePx = id === "WPIT-ETH-TEST" ? s.eth : 1;
  return frac * (pool.quoteReserve * quotePx + pool.baseReserve * (id === "ETH-USDC" ? s.eth : s.wpit));
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
  const inv = Math.abs(g.delta) / Math.max(s.vault.eth, 1e-6);
  return 8 + utilEth(s) * 80 + Math.max(0, s.iv - 0.4) * 40 + inv * 25;
}

export function bookGreeks(s: EngineState) {
  let delta = 0;
  let gamma = 0;
  let vega = 0;
  for (const p of s.futures) {
    delta += p.side === "long" ? -p.sizeEth : p.sizeEth;
  }
  for (const p of s.options) {
    const T = yearsTo(p.expiry, s.clock);
    const vol = ivSmile(s.iv, s.eth, p.strike, T);
    const d = bsDelta(s.eth, p.strike, T, 0.03, vol, p.type);
    delta += -d * p.sizeEth;
    gamma += -bsGamma(s.eth, p.strike, T, 0.03, vol) * p.sizeEth;
    vega += -bsVega(s.eth, p.strike, T, 0.03, vol) * p.sizeEth;
  }
  return { delta, gamma, vega };
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

export function tradeFuture(s: EngineState, side: FutSide, contracts: number, expiry: number): EngineState | string {
  const sizeEth = contracts * MINI_ETH;
  const why = rejectFuture(s, side, sizeEth, expiry);
  if (why) return why;
  const bps = spreadBps(s);
  const px = side === "long" ? s.eth * (1 + bps / 10_000) : s.eth * (1 - bps / 10_000);
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
  return pushFill(next, {
    id: uid("f"),
    t: s.clock,
    product: "future",
    symbol: `ETH mini ${new Date(expiry).toISOString().slice(0, 10)}`,
    side,
    size: sizeEth,
    price: px,
    fee,
    note: "inventory-backed",
  });
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
  return pushFill(next, {
    id: uid("f"),
    t: s.clock,
    product: "future",
    symbol: "ETH mini close",
    side: pos.side === "long" ? "sell" : "buy",
    size: pos.sizeEth,
    price: s.eth,
    fee: 0,
    note: `PnL ${pnl.toFixed(2)}`,
  });
}

export function buyOption(s: EngineState, type: OptType, strike: number, expiry: number, contracts: number): EngineState | string {
  const sizeEth = contracts * MINI_ETH;
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
  return pushFill(next, {
    id: uid("f"),
    t: s.clock,
    product: "option",
    symbol: `ETH ${strike} ${type} mini`,
    side: "buy",
    size: sizeEth,
    price: px,
    fee,
    note: "covered / cash-secured",
  });
}

function settleAndLiq(s: EngineState): EngineState {
  let next = s;
  for (const p of s.futures) {
    const eq = p.margin + futPnl(p, s.eth);
    const maint = p.sizeEth * s.eth * FUT_MM;
    if (eq < maint || s.clock >= p.expiry) {
      const closed = closeFuture(next, p.id);
      if (typeof closed !== "string") {
        next = {
          ...closed,
          liquidations: eq < maint ? next.liquidations + 1 : next.liquidations,
          insuranceUsdc:
            eq < maint
              ? next.insuranceUsdc + Math.min(Math.max(eq, 0), 0.01 * p.sizeEth * s.eth)
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
    const intrinsic = p.type === "call" ? Math.max(next.eth - p.strike, 0) : Math.max(p.strike - next.eth, 0);
    const payoff = intrinsic * p.sizeEth;
    acc = { ...acc, usdc: acc.usdc + payoff, realized: acc.realized + payoff - p.premium * p.sizeEth };
    if (p.type === "call") vault.reservedEth = Math.max(0, vault.reservedEth - p.sizeEth);
    else vault.reservedUsdc = Math.max(0, vault.reservedUsdc - p.strike * p.sizeEth);
  }
  return { ...next, options: remaining, vault, account: acc };
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

export function addLiquidity(s: EngineState, poolId: PoolId, quoteAmt: number): EngineState | string {
  if (quoteAmt <= 0) return "Size must be positive.";
  const pool = { ...s.pools[poolId] };
  const acc = { ...s.account };
  const px = pool.quoteReserve / pool.baseReserve;
  if (poolId === "WPIT-ETH-TEST") {
    const ethIn = quoteAmt / s.eth;
    const wpitIn = ethIn / px;
    if (acc.eth < ethIn || acc.wpit < wpitIn) return "Need both WPIT and ETH.";
    const shares = (ethIn / pool.quoteReserve) * pool.lpSupply;
    acc.eth -= ethIn;
    acc.wpit -= wpitIn;
    pool.quoteReserve += ethIn;
    pool.baseReserve += wpitIn;
    pool.lpSupply += shares;
    const lp = upsertLp(s.lp, poolId, shares);
    return { ...s, account: acc, pools: { ...s.pools, [poolId]: pool }, lp };
  }
  const baseIn = quoteAmt / px;
  const haveBase = poolId === "ETH-USDC" ? acc.eth : acc.wpit;
  if (acc.usdc < quoteAmt || haveBase < baseIn) return `Need both ${pool.base} and USDC.`;
  const shares = (quoteAmt / pool.quoteReserve) * pool.lpSupply;
  acc.usdc -= quoteAmt;
  if (poolId === "ETH-USDC") acc.eth -= baseIn;
  else acc.wpit -= baseIn;
  pool.quoteReserve += quoteAmt;
  pool.baseReserve += baseIn;
  pool.lpSupply += shares;
  const lp = upsertLp(s.lp, poolId, shares);
  return { ...s, account: acc, pools: { ...s.pools, [poolId]: pool }, lp };
}

function upsertLp(lp: EngineState["lp"], poolId: PoolId, shares: number) {
  const i = lp.findIndex((p) => p.poolId === poolId);
  if (i < 0) return [...lp, { poolId, shares }];
  const copy = lp.slice();
  copy[i] = { poolId, shares: copy[i]!.shares + shares };
  return copy;
}

export function removeLiquidity(s: EngineState, poolId: PoolId, shares: number): EngineState | string {
  if (shares <= 0) return "Size must be positive.";
  const pos = s.lp.find((p) => p.poolId === poolId);
  if (!pos || pos.shares + 1e-12 < shares) return "Not enough LP shares.";
  const pool = { ...s.pools[poolId] };
  if (pool.lpSupply <= 0) return "Empty pool.";
  const frac = shares / pool.lpSupply;
  const acc = { ...s.account };
  const quoteOut = pool.quoteReserve * frac;
  const baseOut = pool.baseReserve * frac;
  pool.quoteReserve -= quoteOut;
  pool.baseReserve -= baseOut;
  pool.lpSupply -= shares;
  if (poolId === "WPIT-ETH-TEST") {
    acc.eth += quoteOut;
    acc.wpit += baseOut;
  } else if (poolId === "ETH-USDC") {
    acc.usdc += quoteOut;
    acc.eth += baseOut;
  } else {
    acc.usdc += quoteOut;
    acc.wpit += baseOut;
  }
  const lp = s.lp
    .map((p) => (p.poolId === poolId ? { ...p, shares: p.shares - shares } : p))
    .filter((p) => p.shares > 1e-9);
  return { ...s, account: acc, pools: { ...s.pools, [poolId]: pool }, lp };
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
  return pushFill(next, {
    id: uid("f"),
    t: s.clock,
    product: "option",
    symbol: `ETH ${pos.strike} ${pos.type} close`,
    side: "sell",
    size: pos.sizeEth,
    price: px,
    fee: 0,
    note: `PnL ${pnl.toFixed(2)}`,
  });
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
  return [
    { label: "W1", at: nextFriday(now, 0) },
    { label: "W2", at: nextFriday(now, 1) },
    { label: "M", at: monthEnd(now) },
  ];
}

export function strikes(spot: number) {
  const step = spot > 3000 ? 100 : 50;
  const atm = Math.round(spot / step) * step;
  return [atm - 2 * step, atm - step, atm, atm + step, atm + 2 * step];
}

export function optionQuote(s: EngineState, type: OptType, strike: number, expiry: number) {
  const T = yearsTo(expiry, s.clock);
  const vol = smileVol(s, type, strike, T);
  const mid = type === "call" ? bsCall(s.eth, strike, T, 0.03, vol) : bsPut(s.eth, strike, T, 0.03, vol);
  const d = bsDelta(s.eth, strike, T, 0.03, vol, type);
  const bps = spreadBps(s);
  const g = bookGreeks(s);
  const why = rejectOption(s, type, strike, expiry, MINI_ETH, g.gamma, g.vega);
  const ask = mid * (1 + bps / 10_000) + 0.4;
  const bid = Math.max(0.05, mid * (1 - bps / 10_000) - 0.4);
  return { T, mid, bid: why ? 0 : bid, ask: why ? 0 : ask, delta: d, iv: vol, blank: why };
}

