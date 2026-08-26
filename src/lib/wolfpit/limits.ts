/** House limits. Paper today, same numbers we would ship with real USDC. */

export const MAX_LOT = 1_000_000;
export const MAX_NOTIONAL_USD = 25_000_000;
export const MAX_POOL_FRAC = 0.25;
export const MAX_FARM_APY = 1.2;
export const APY_TVL_FLOOR = 50_000;
export const WPIT_PX_MIN = 0.02;
export const WPIT_PX_MAX = 5;
export const EMIT_PX_CAP = 0.75;
export const MIN_IM_USD = 0.01;

export function requireFinitePositive(n: number, label = "Size"): string | null {
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) {
    return `${label} must be a finite number.`;
  }
  if (n <= 0) return `${label} must be positive.`;
  if (n > MAX_LOT) return `${label} exceeds max lot (${MAX_LOT.toLocaleString()}).`;
  return null;
}

export function requireMoney(n: number, label = "Amount"): string | null {
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) {
    return `${label} is not a number.`;
  }
  if (n < 0) return `${label} cannot be negative.`;
  if (n > MAX_NOTIONAL_USD * 4) return `${label} exceeds house cap.`;
  return null;
}