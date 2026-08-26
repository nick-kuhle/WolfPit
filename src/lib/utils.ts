import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtUsd(n: number, digits = 2) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPx(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export function fmtSigned(n: number, digits = 2) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPct(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${(Math.abs(n) * 100).toFixed(2)}%`;
}

/** Qty without scientific notation. signed=true prefixes + / −. */
export function fmtQty(n: number, signed = false) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : "";
  if (abs === 0) return signed ? "0" : "0.00";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: abs >= 10_000 ? 0 : 2 })}`;
  if (abs >= 1) return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (abs >= 0.01) return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  if (abs >= 0.0001) return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  return `${sign}${abs.toExponential(1)}`;
}

