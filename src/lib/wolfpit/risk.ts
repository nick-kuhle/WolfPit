import { DERIV_FEE, UTIL_CAP, type EngineState, type FutSide, type OptType } from "./types";
import { bsCall, bsGamma, bsPut, bsVega, clamp, ivSmile, yearsTo } from "./math";

const GAMMA_NAV = 0.02;
const VEGA_NAV = 0.15;
const OI_EXPIRY = 0.25;
const OI_STRIKE = 0.1;
const FILL_BAND = 0.1;
const INSURANCE_NAV_MIN = 0.01;
export const CIRCUIT_MS = 15 * 60 * 1000;
const DT_1H = 1 / (365.25 * 24);
const MINUTES_YR = 365.25 * 24 * 60;
export const CALL_INV_VOL = 0.005;

/**
 * LP.md NAV:
 *   NAV = ETH·S + USDC
 *       + MTM(short options)      // ≤ 0 on a mark-to-mid; house is short every trader option
 *       − trader credits          // escrowed trader margin held by the vault
 *       + insurance               // not shareable until epoch
 * Reserves (reservedEth/reservedUsdc) are SUB-accounts of vault.eth/vault.usdc,
 * so they are not added again — their escrow side is the −trader credits term.
 */
export function vaultNav(s: EngineState) {
  // The vault is the counter-party to every trader future: its NAV must mark
  // that book to market, or a big move leaves insurance/γ/ν caps computed on
  // a stale NAV between settlements. (Trader long => vault short: −futPnl.)
  let futuresPnl = 0;
  for (const f of s.futures) {
    const under = f.under ?? "ETH";
    const mark = under === "ETH" ? s.eth : s.wpit;
    const pnl = f.side === "long" ? (mark - f.entry) * f.sizeEth : (f.entry - mark) * f.sizeEth;
    futuresPnl += -pnl; // vault is the counter-party
  }
  let mtmShort = 0;
  for (const p of s.options) {
    const under = p.under ?? "ETH";
    const spot = under === "WPIT" ? s.wpit : s.eth;
    if (s.clock >= p.expiry) {
      // Expired but not yet settled (settle runs every tick; the window is one
      // step): value the short at INTRINSIC so NAV is continuous across the
      // settlement — the payout then debits the vault 1:1 against this
      // liability, and no transient NAV bloat loosens the Γ/ν/insurance caps.
      const intrinsic =
        p.type === "call" ? Math.max(spot - p.strike, 0) : Math.max(p.strike - spot, 0);
      mtmShort -= intrinsic * p.sizeEth;
      continue;
    }
    const T = Math.max(yearsTo(p.expiry, s.clock), 1 / 365 / 24);
    const vol = ivSmile(s.iv, spot, p.strike, T);
    const mid = p.type === "call" ? bsCall(spot, p.strike, T, 0.03, vol) : bsPut(spot, p.strike, T, 0.03, vol);
    mtmShort -= mid * p.sizeEth;
  }
  return s.vault.eth * s.eth + s.vault.usdc + mtmShort + futuresPnl - (s.vault.escrowUsdc ?? 0) + (s.insuranceUsdc ?? 0);
}


/** Total inventory the pit can post, including already-reserved. Used for IM slope. */
function grossCover(s: EngineState, under: string, side: FutSide): number {
  if (under === "ETH") {
    if (side === "long") return Math.max(0, s.vault.eth * UTIL_CAP);
    return Math.max(0, (s.vault.usdc * UTIL_CAP) / Math.max(s.eth, 1e-9));
  }
  const mark = Math.max(under === "ETH" ? s.eth : s.wpit, 1e-9);
  if (!(mark > 0)) return 0;
  return Math.max(0, (s.vault.usdc * UTIL_CAP) / mark);
}

export function poolDepth(s: EngineState, under: string): number {
  if (under === "ETH") return s.pools["ETH-USDC"]?.baseReserve ?? 0;
  const p = Object.values(s.pools).find((x) => x.base === under);
  return p?.baseReserve ?? 0;
}

/**
 * ONE definition of deployable house cash (M-07 / #23).
 *
 * `escrowUsdc` is TRADER MARGIN — money the vault holds *for* someone else, and
 * which its own settlement paths (`reduceFuture`, `liquidateFuture`,
 * `settleAndLiq`, `closeOption`) all refuse to spend. Counting it as collateral
 * would let the same dollar back a trader's position AND a house short put at
 * the same time, so the put would not be cash-secured at all.
 *
 * This helper exists because the definition used to be written out by hand in
 * five places and the risk gate's copy omitted escrow: with 10,000,000 vault
 * USDC and 9,999,000 of it trader escrow, `rejectOption` accepted a put against
 * 1,000 of genuinely free cash. Every site now calls this.
 */
export function freeVaultUsdc(s: EngineState): number {
  const v = s.vault;
  const free = v.usdc - v.reservedUsdc - (v.escrowUsdc ?? 0);
  return Number.isFinite(free) ? Math.max(0, free) : 0;
}

/** IM as a fraction of notional. Rises with size vs cover and vs pool depth so we only book what we can hedge. */
export function imRate(s: EngineState, size: number, under: string): number {
  const cover = Math.max(grossCover(s, under, "long"), grossCover(s, under, "short"), 1e-9);
  const depth = Math.max(poolDepth(s, under), 1e-9);
  const uCover = clamp(Math.abs(size) / cover, 0, 3);
  const uPool = clamp(Math.abs(size) / depth, 0, 1);
  return clamp(0.25 + 0.3 * uCover * uCover + 0.45 * uPool, 0.25, 0.75);
}

/**
 * Insurance cover as a fraction of NAV.
 *
 * M-06 / #21: a non-positive NAV is ZERO coverage, not full coverage. The old
 * `nav <= 0 ? 1` guard returned 1 — "fully insured" — at the exact moment the
 * vault became insolvent, and `haltShortGamma()` (ratio < 1%) then let the desk
 * keep writing short gamma into a hole. `DealerVault.haltShortGamma()` in
 * Solidity already fails closed here (`if (nav == 0) return true`); the engine
 * must agree with the contract on the failure case that matters most.
 */
export function insuranceRatio(s: EngineState) {
  const nav = vaultNav(s);
  if (!Number.isFinite(nav) || nav <= 0) return 0;
  const ins = s.insuranceUsdc ?? 0;
  return Number.isFinite(ins) ? Math.max(0, ins) / nav : 0;
}

export function circuitActive(s: EngineState) {
  return (s.circuitUntil ?? 0) > s.clock;
}

function ret5m(s: EngineState) {
  const c = s.candles;
  if (c.length < 6) return 0;
  const a = c[c.length - 6]!.c;
  const b = c[c.length - 1]!.c;
  if (a <= 0) return 0;
  return (b - a) / a;
}

function circuitThreshold(s: EngineState) {
  return 3 * s.iv * Math.sqrt(5 / MINUTES_YR);
}

export function maybeCircuit(s: EngineState): EngineState {
  if (Math.abs(ret5m(s)) > circuitThreshold(s)) {
    return { ...s, circuitUntil: Math.max(s.circuitUntil ?? 0, s.clock + CIRCUIT_MS) };
  }
  return s;
}

export function spotFeeBps(rv: number) {
  return Math.round(clamp(5 + 80 * Math.max(0, rv - 0.4), 5, 30));
}

export function gammaCash1h(gammaAbs: number, spot: number, iv: number) {
  // CONVENTION (M-04 / #27): this deliberately returns 2× the textbook expected
  // gamma cash over one hour. Expected gamma P&L is ½·Γ·S²·σ²·Δt; the ½ is
  // OMITTED on purpose so the Γ cap (GAMMA_NAV = 2% NAV) binds at half the
  // documented exposure — a 2× safety factor, not a bug.
  // `hedgeError99` below uses the textbook ½ because it is a tail estimate, not
  // a cap. The two conventions are stated here and there so a later "cleanup"
  // cannot silently halve the Γ limit by making them agree.
  return Math.abs(gammaAbs) * spot * spot * iv * iv * DT_1H;
}

/** Stress vol for the insurance-vs-hedge-error test (MM.md: "under 80% ETH vol"). */
const HE_STRESS_VOL = 0.8;
/**
 * TWO-SIDED 99th percentile of |Z| (M-03 / #24). A short-gamma book loses on a
 * move in EITHER direction, so the relevant quantile is of |Z| — 2.5758, i.e.
 * Φ⁻¹(0.995) — not the one-sided Φ⁻¹(0.99) = 2.326. Because the hedge error
 * scales with ΔS², using the one-sided value understated the insurance
 * requirement by (2.5758/2.3263)² − 1 = 22.6%, letting the book run ~23% more
 * short gamma than policy allows. Do not "correct" this back to 2.326.
 */
const Z99 = 2.5758;

/**
 * 99th-percentile 1-hour hedge error at the stress vol (MM.md):
 *   HE ≈ 0.5 · |Γ| · (ΔS)²,  ΔS = S · σ_stress · √(1h) · z99
 * Insurance must cover this or the desk stops writing gamma.
 */
export function hedgeError99(spot: number, gammaAbs: number) {
  const dS = spot * HE_STRESS_VOL * Math.sqrt(DT_1H) * Z99;
  return 0.5 * Math.abs(gammaAbs) * dS * dS;
}

/**
 * Projected NET open-interest exposure at an expiry after an add, in ETH.
 *
 * The engine flattens a new futures fill against opposite-side futures on the
 * same (under, expiry) before booking it, so the OI cap must be evaluated on
 * the NETTED book — otherwise a fill that would REDUCE exposure is rejected
 * once gross OI sits near the cap (false rejection). Options never flatten, so
 * they are additive to their delta side:
 *
 *   vault-short side  = long futures + short calls
 *   vault-long side   = short futures + short puts
 *
 * `add` is either { side } for futures or { type } for options. Returns the
 * larger side after netting = the gross exposure that must fit the cap.
 */
function projectedExpiryExposure(
  s: EngineState,
  expiry: number,
  add?: { side?: FutSide; type?: OptType; sizeEth: number },
): number {
  let futLong = 0;
  let futShort = 0;
  let optCall = 0;
  let optPut = 0;
  for (const p of s.futures) {
    if (p.expiry !== expiry) continue;
    if (p.side === "long") futLong += p.sizeEth;
    else futShort += p.sizeEth;
  }
  for (const p of s.options) {
    if (p.expiry !== expiry) continue;
    if (p.type === "call") optCall += p.sizeEth;
    else optPut += p.sizeEth;
  }
  const size = add?.sizeEth ?? 0;
  if (add) {
    if (add.side === "long") {
      const flat = Math.min(size, futShort);
      futLong += size - flat;
      futShort -= flat;
    } else if (add.side === "short") {
      const flat = Math.min(size, futLong);
      futShort += size - flat;
      futLong -= flat;
    } else if (add.type === "call") {
      optCall += size;
    } else if (add.type === "put") {
      optPut += size;
    }
  }
  return Math.max(futLong + optCall, futShort + optPut);
}

function oiStrike(s: EngineState, strike: number) {
  return s.options.filter((p) => p.strike === strike).reduce((a, p) => a + p.sizeEth, 0);
}

function shortCallSize(s: EngineState) {
  return s.options.filter((p) => p.type === "call").reduce((a, p) => a + p.sizeEth, 0);
}

export function haltShortGamma(s: EngineState) {
  return insuranceRatio(s) < INSURANCE_NAV_MIN || circuitActive(s);
}

/**
 * Room left on one side of the inventory book, in ETH (M-07 / #23).
 *
 * Long side: the α law reserves ETH cover, so room is `α·vault.ETH − reservedEth`.
 * Short side: the α law allows `α·vault.USDC` of reservations, but only
 * DEPLOYABLE cash can fund them — `escrowUsdc` is trader margin the vault holds
 * for someone else and its own settlement paths refuse to spend. Counting escrow
 * here inflated the cap for every short-side fill, so utilisation was measured
 * against money the house could not deploy.
 */
function remainingCap(s: EngineState, side: FutSide) {
  if (side === "long") return Math.max(0, s.vault.eth * UTIL_CAP - s.vault.reservedEth);
  const deployable = Math.min(s.vault.usdc * UTIL_CAP, freeVaultUsdc(s) + s.vault.reservedUsdc);
  return Math.max(0, (deployable - s.vault.reservedUsdc) / s.eth);
}


function projectedOptionGamma(s: EngineState, type: OptType, strike: number, expiry: number, sizeEth: number) {
  const T = yearsTo(expiry, s.clock);
  const vol = smileVol(s, type, strike, T);
  return -bsGamma(s.eth, strike, T, 0.03, vol) * sizeEth;
}

function projectedOptionVega(s: EngineState, type: OptType, strike: number, expiry: number, sizeEth: number) {
  const T = yearsTo(expiry, s.clock);
  const vol = smileVol(s, type, strike, T);
  return -bsVega(s.eth, strike, T, 0.03, vol) * 100 * sizeEth;
}

export function smileVol(s: EngineState, type: OptType, strike: number, T: number, spot = s.eth) {
  let vol = ivSmile(s.iv, spot, strike, T);
  if (type === "call" && shortCallSize(s) > 0) vol += CALL_INV_VOL;
  return vol;
}

export function rejectFuture(s: EngineState, side: FutSide, sizeEth: number, expiry: number): string | null {
  if (!Number.isFinite(sizeEth) || sizeEth <= 0) return "Size must be a finite positive number.";
  if (sizeEth > 1_000_000) return "Size exceeds max lot.";
  if (side === "short" && circuitActive(s)) return "Circuit: new shorts halted.";
  if (!(s.eth > 0) || !Number.isFinite(s.eth)) return "No ETH mark.";
  const notional = sizeEth * s.eth;
  if (!Number.isFinite(notional) || notional > 25_000_000) return "Notional exceeds house cap.";
  const im = notional * imRate(s, sizeEth, "ETH"); // F12: gate at the ACTUAL charged IM (25–75%), not flat FUT_IM
  const fee = notional * DERIV_FEE;
  if (s.account.usdc + 1e-9 < im + fee) return "Not enough buying power for initial margin + fee.";
  const cap = remainingCap(s, side);
  if (sizeEth > cap + 1e-9) return `Inventory cap. Max ${cap.toFixed(4)} ETH net this side.`;
  if (projectedExpiryExposure(s, expiry, { side, sizeEth }) > s.vault.eth * OI_EXPIRY + 1e-9) {
    return "OI cap on this expiry (25% of vault ETH).";
  }
  const fillMax = cap * FILL_BAND;
  if (cap > 0 && sizeEth > fillMax + 1e-9) {
    return `Single fill > 10% of remaining band (${fillMax.toFixed(4)} ETH).`;
  }
  return null;
}

export function rejectOption(
  s: EngineState,
  type: OptType,
  strike: number,
  expiry: number,
  sizeEth: number,
  bookGamma: number,
  bookVega: number,
): string | null {
  if (!Number.isFinite(sizeEth) || sizeEth <= 0) return "Size must be a finite positive number.";
  if (sizeEth > 1_000_000) return "Size exceeds max lot.";
  if (haltShortGamma(s)) {
    if (circuitActive(s)) return "Circuit: new shorts halted.";
    return "Insurance / NAV < 1%. New short gamma halted.";
  }
  if (type === "call") {
    const free = Math.max(0, s.vault.eth - s.vault.reservedEth);
    if (free < sizeEth) return "Vault will not sell a naked call. Not enough free ETH to cover.";
  } else {
    const lock = strike * sizeEth;
    // M-07 / #23: cash-secured means secured with the HOUSE's own deployable
    // cash. `freeVaultUsdc` subtracts trader escrow; the old inline
    // `usdc − reservedUsdc` did not, so a put could be "secured" with money the
    // vault was already holding on a trader's behalf.
    if (freeVaultUsdc(s) < lock) return "Vault will not sell a naked put. Not enough USDC to cash-secure.";
  }
  if (projectedExpiryExposure(s, expiry, { type, sizeEth }) > s.vault.eth * OI_EXPIRY + 1e-9) {
    return "OI cap on this expiry (25% of vault ETH).";
  }
  if (oiStrike(s, strike) + sizeEth > s.vault.eth * OI_STRIKE + 1e-9) {
    return "OI cap on this strike (10% of vault ETH).";
  }
  const capSide: FutSide = type === "call" ? "long" : "short";
  const fillMax = remainingCap(s, capSide) * FILL_BAND;
  if (fillMax > 0 && sizeEth > fillMax + 1e-9) {
    return `Single fill > 10% of remaining band (${fillMax.toFixed(2)} ETH).`;
  }
  const g = Math.abs(bookGamma + projectedOptionGamma(s, type, strike, expiry, sizeEth));
  const nav = vaultNav(s);
  if (gammaCash1h(g, s.eth, s.iv) > GAMMA_NAV * nav) return "Gamma cash cap. Stop writing ATM.";
  const v = Math.abs(bookVega + projectedOptionVega(s, type, strike, expiry, sizeEth));
  if (v > VEGA_NAV * nav) return "Vega cap. Stop writing.";
  // MM.md / RISK.md: insurance must cover the 99th-pct 1h hedge error at 80%
  // ETH vol. If it cannot, cut Γ — stop writing.
  if (hedgeError99(s.eth, g) > (s.insuranceUsdc ?? 0)) {
    return "Insurance below 99th-pct 1h hedge error (80% vol). Short gamma halted.";
  }
  return null;
}

