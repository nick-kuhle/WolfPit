import { DERIV_FEE, FUT_IM, UTIL_CAP, type EngineState, type FutSide, type OptType } from "./types";
import { bsCall, bsGamma, bsPut, bsVega, clamp, ivSmile, yearsTo } from "./math";

export const GAMMA_NAV = 0.02;
export const VEGA_NAV = 0.15;
export const OI_EXPIRY = 0.25;
export const OI_STRIKE = 0.1;
export const FILL_BAND = 0.1;
export const INSURANCE_NAV_MIN = 0.01;
export const CIRCUIT_MS = 15 * 60 * 1000;
export const DT_1H = 1 / (365.25 * 24);
export const MINUTES_YR = 365.25 * 24 * 60;
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
  let mtmShort = 0;
  for (const p of s.options) {
    if (s.clock >= p.expiry) continue; // settled (payout booked) by settleAndLiq
    const under = p.under ?? "ETH";
    const spot = under === "WPIT" ? s.wpit : s.eth;
    const T = Math.max(yearsTo(p.expiry, s.clock), 1 / 365 / 24);
    const vol = ivSmile(s.iv, spot, p.strike, T);
    const mid = p.type === "call" ? bsCall(spot, p.strike, T, 0.03, vol) : bsPut(spot, p.strike, T, 0.03, vol);
    mtmShort -= mid * p.sizeEth;
  }
  return s.vault.eth * s.eth + s.vault.usdc + mtmShort - (s.vault.escrowUsdc ?? 0) + (s.insuranceUsdc ?? 0);
}


/** Total inventory the pit can post, including already-reserved. Used for IM slope. */
export function grossCover(s: EngineState, under: string, side: FutSide): number {
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

/** IM as a fraction of notional. Rises with size vs cover and vs pool depth so we only book what we can hedge. */
export function imRate(s: EngineState, size: number, under: string): number {
  const cover = Math.max(grossCover(s, under, "long"), grossCover(s, under, "short"), 1e-9);
  const depth = Math.max(poolDepth(s, under), 1e-9);
  const uCover = clamp(Math.abs(size) / cover, 0, 3);
  const uPool = clamp(Math.abs(size) / depth, 0, 1);
  return clamp(0.25 + 0.3 * uCover * uCover + 0.45 * uPool, 0.25, 0.75);
}

export function insuranceRatio(s: EngineState) {
  const nav = vaultNav(s);
  return nav <= 0 ? 1 : (s.insuranceUsdc ?? 0) / nav;
}

export function circuitActive(s: EngineState) {
  return (s.circuitUntil ?? 0) > s.clock;
}

export function ret5m(s: EngineState) {
  const c = s.candles;
  if (c.length < 6) return 0;
  const a = c[c.length - 6]!.c;
  const b = c[c.length - 1]!.c;
  if (a <= 0) return 0;
  return (b - a) / a;
}

export function circuitThreshold(s: EngineState) {
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
  return Math.abs(gammaAbs) * spot * spot * iv * iv * DT_1H;
}

/** Stress vol for the insurance-vs-hedge-error test (MM.md: "under 80% ETH vol"). */
export const HE_STRESS_VOL = 0.8;
export const Z99 = 2.326;

/**
 * 99th-percentile 1-hour hedge error at the stress vol (MM.md):
 *   HE ≈ 0.5 · |Γ| · (ΔS)²,  ΔS = S · σ_stress · √(1h) · z99
 * Insurance must cover this or the desk stops writing gamma.
 */
export function hedgeError99(spot: number, gammaAbs: number) {
  const dS = spot * HE_STRESS_VOL * Math.sqrt(DT_1H) * Z99;
  return 0.5 * Math.abs(gammaAbs) * dS * dS;
}

export function oiExpiry(s: EngineState, expiry: number) {
  let n = 0;
  for (const p of s.options) if (p.expiry === expiry) n += p.sizeEth;
  for (const p of s.futures) if (p.expiry === expiry) n += p.sizeEth;
  return n;
}

export function oiStrike(s: EngineState, strike: number) {
  return s.options.filter((p) => p.strike === strike).reduce((a, p) => a + p.sizeEth, 0);
}

export function shortCallSize(s: EngineState) {
  return s.options.filter((p) => p.type === "call").reduce((a, p) => a + p.sizeEth, 0);
}

export function haltShortGamma(s: EngineState) {
  return insuranceRatio(s) < INSURANCE_NAV_MIN || circuitActive(s);
}

export function remainingCap(s: EngineState, side: FutSide) {
  if (side === "long") return Math.max(0, s.vault.eth * UTIL_CAP - s.vault.reservedEth);
  return Math.max(0, (s.vault.usdc * UTIL_CAP) / s.eth - s.vault.reservedUsdc / s.eth);
}

export function maxFillEth(s: EngineState, side: FutSide) {
  return remainingCap(s, side) * FILL_BAND;
}

export function projectedOptionGamma(s: EngineState, type: OptType, strike: number, expiry: number, sizeEth: number) {
  const T = yearsTo(expiry, s.clock);
  const vol = smileVol(s, type, strike, T);
  return -bsGamma(s.eth, strike, T, 0.03, vol) * sizeEth;
}

export function projectedOptionVega(s: EngineState, type: OptType, strike: number, expiry: number, sizeEth: number) {
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
  if (oiExpiry(s, expiry) + sizeEth > s.vault.eth * OI_EXPIRY + 1e-9) {
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
    const free = Math.max(0, s.vault.usdc - s.vault.reservedUsdc);
    if (free < lock) return "Vault will not sell a naked put. Not enough USDC to cash-secure.";
  }
  if (oiExpiry(s, expiry) + sizeEth > s.vault.eth * OI_EXPIRY + 1e-9) {
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

