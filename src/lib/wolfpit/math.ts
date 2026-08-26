export function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

export function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function normCdf(x: number) {
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

export function bsPut(S: number, K: number, T: number, r: number, sig: number) {
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

export function ewmaRv(candles: { t: number; c: number }[]) {
  if (candles.length < 8) return 0.55;
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1]!.c;
    const b = candles[i]!.c;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  const n = rets.length;
  const mean = rets.reduce((x, y) => x + y, 0) / n;
  const var_ = rets.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(n - 1, 1);
  const barSec = Math.max(1, (candles[1]!.t - candles[0]!.t) / 1000);
  const annual = Math.sqrt(var_ * ((365.25 * 24 * 3600) / barSec));
  return Math.min(2, Math.max(0.15, annual));
}
