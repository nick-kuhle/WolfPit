export function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}


function normCdf(x: number) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function bsCall(S: number, K: number, T: number, r: number, sig: number) {
  if (!(S > 0) || !(K > 0) || !Number.isFinite(S) || !Number.isFinite(K)) return 0;
  if (T <= 1 / 365 / 24) return Math.max(S - K, 0);
  const v = Math.max(sig, 0.01);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

/**
 * Mirror of `bsCall`'s input guard (M-05 / #28): a non-finite or non-positive
 * S/K must return 0, NOT NaN. The near-expiry branch returns `K - S` directly
 * and the main branch returns `call - S + K·e^{-rT}`, so an unguarded NaN here
 * propagates into `vaultNav` — and every comparison against NaN is false, which
 * would silently disarm the Γ, ν and insurance caps at once. A guard that fails
 * open on the risk limits is worse than the NaN itself.
 */
export function bsPut(S: number, K: number, T: number, r: number, sig: number) {
  if (!(S > 0) || !(K > 0) || !Number.isFinite(S) || !Number.isFinite(K)) return 0;
  if (T <= 1 / 365 / 24) return Math.max(K - S, 0);
  const call = bsCall(S, K, T, r, sig);
  return call - S + K * Math.exp(-r * T);
}

export function bsDelta(S: number, K: number, T: number, r: number, sig: number, type: "call" | "put") {
  if (!(S > 0) || !(K > 0) || !Number.isFinite(S) || !Number.isFinite(K)) return 0;
  if (T <= 1 / 365 / 24) {
    if (type === "call") return S > K ? 1 : 0;
    return S < K ? -1 : 0;
  }
  const v = Math.max(sig, 0.01);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const nd1 = normCdf(d1);
  return type === "call" ? nd1 : nd1 - 1;
}

export function bsGamma(S: number, K: number, T: number, r: number, sig: number) {
  if (!(S > 0) || !(K > 0) || !Number.isFinite(S) || !Number.isFinite(K)) return 0;
  if (T <= 1 / 365 / 24) return 0;
  const v = Math.max(sig, 0.01);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const nd = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return nd / (S * v * Math.sqrt(T));
}

export function bsVega(S: number, K: number, T: number, r: number, sig: number) {
  if (!(S > 0) || !(K > 0) || !Number.isFinite(S) || !Number.isFinite(K)) return 0;
  if (T <= 1 / 365 / 24) return 0;
  const v = Math.max(sig, 0.01);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const nd = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return (S * nd * Math.sqrt(T)) / 100;
}

export function yearsTo(expiry: number, now: number) {
  return Math.max(0, (expiry - now) / (365.25 * 24 * 3600 * 1000));
}

export function nextFriday(from: number, weeks = 0) {
  const d = new Date(from);
  const day = d.getUTCDay();
  let add = (5 - day + 7) % 7;
  if (add === 0) add = 7;
  add += weeks * 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(20, 0, 0, 0);
  return d.getTime();
}

export function monthEnd(from: number) {
  const d = new Date(from);
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 20, 0, 0, 0));
  if (e.getTime() - from < 2 * 86400000) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0, 20, 0, 0, 0)).getTime();
  }
  return e.getTime();
}

export function ammOut(dx: number, x: number, y: number, feeBps: number) {
  if (!(dx > 0) || !(x > 0) || !(y > 0) || !Number.isFinite(dx) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return 0;
  }
  const dxNet = dx * (1 - feeBps / 10_000);
  if (!(dxNet > 0)) return 0;
  const out = (dxNet * y) / (x + dxNet);
  if (!Number.isFinite(out) || out <= 0) return 0;
  return Math.min(out, y * 0.99);
}

export function uid(prefix: string) {
  const g = globalThis.crypto?.randomUUID?.();
  if (g) return `${prefix}-${g.slice(0, 12)}`;
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function ivSmile(atm: number, S: number, K: number, T: number) {
  const z = Math.log(K / S) / Math.sqrt(Math.max(T, 1 / 365));
  return clamp(atm * (1 - 0.18 * z), 0.2, 2);
}

/**
 * EWMA of ABSOLUTE log returns (RiskMetrics-style), annualised and converted to
 * a Black-Scholes σ.
 *
 * Two corrections live here, both measured by Monte-Carlo (see #20 / M-01 and
 * #25 / M-02):
 *
 * 1. MEAN-ABSOLUTE-DEVIATION → σ (M-01). An EWMA of |r| converges to E|r|, not
 *    to σ. For a normal return E|r| = σ·√(2/π) ≈ 0.7979σ, so the raw estimator
 *    reported 79.8% of true vol. `iv = 1.08·rv` was therefore a 13.8% DISCOUNT
 *    on a book that is structurally short gamma. `MAD_TO_SIGMA = √(π/2)`
 *    rescales it; at σ=0.60 over 4,000 paths the corrected mean is 1.0000×σ.
 *
 * 2. λ IS DERIVED FROM TIME, NOT INHERITED (M-02). RiskMetrics calibrated
 *    λ=0.94 for DAILY bars, where it is a ~1-month window. On 1-minute bars the
 *    same constant is 1/(1−λ) ≈ 17 bars — a seventeen-minute memory pricing
 *    weekly options. We now state a HALF-LIFE in minutes and derive
 *    λ = 0.5^(bar/halfLife), so the memory is a deliberate choice that survives
 *    a change of bar interval.
 *
 * NOTE on dispersion (M-02, corrected): lengthening λ does NOT by itself reduce
 * estimator noise — it makes it worse unless the history covers the window.
 * The live feed supplies ~300 one-minute bars (~5 h). Measured p05–p95 spread at
 * a known σ=0.60, after the √(π/2) correction:
 *
 *   λ / half-life      eff. bars   5 h history   48 h history   336 h history
 *   0.94      (17 min)      17        42%σ          43%σ           42%σ
 *   0.9971    (4 h)        347       100%σ          10%σ           10%σ
 *   0.9995    (24 h)      2078       206%σ          59%σ            4%σ
 *   0.99996   (17 d)     25000       235%σ         212%σ          106%σ
 *
 * The 17-day λ suggested in #25 is therefore rejected: with a window far longer
 * than the history the accumulator is still dominated by its first observation
 * and the estimate is near-meaningless. `RV_HALF_LIFE_MIN` is set to a window
 * the feed can actually fill, and the real fix for dispersion is to feed a
 * longer history (a separate 1h-bar series), not to tune λ upward.
 */
export const MAD_TO_SIGMA = Math.sqrt(Math.PI / 2);

/** Default vol memory: 4 hours, expressed in minutes, not as a bare decimal. */
export const RV_HALF_LIFE_MIN = 240;

/** λ for a given bar length and half-life: λ = 0.5^(bar/halfLife). */
export function ewmaLambda(barSec: number, halfLifeMin = RV_HALF_LIFE_MIN): number {
  const bars = Math.max(barSec, 1) / (halfLifeMin * 60);
  return Math.pow(0.5, bars);
}

export function ewmaRv(
  candles: { t: number; c: number }[],
  halfLifeMin = RV_HALF_LIFE_MIN,
) {
  if (candles.length < 8) return 0.55;
  const barSec = Math.max(1, (candles[1]!.t - candles[0]!.t) / 1000);
  const lambda = ewmaLambda(barSec, halfLifeMin);
  let ewma = 0;
  let n = 0;
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1]!.c;
    const b = candles[i]!.c;
    if (a > 0 && b > 0) {
      const r = Math.abs(Math.log(b / a));
      ewma = n === 0 ? r : lambda * ewma + (1 - lambda) * r;
      n++;
    }
  }
  if (n === 0) return 0.55;
  const annual =
    ewma * MAD_TO_SIGMA * Math.sqrt((365.25 * 24 * 3600) / barSec);
  return Math.min(2, Math.max(0.15, annual));
}
