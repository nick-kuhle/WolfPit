/**
 * Launch market gates.
 *
 * Base launch shape (see docs/DEPLOY-BASE.md): no WPIT token, no house
 * liquidity pool. Spot is live and routes through the DEX aggregator against
 * external WETH/USDC liquidity. Futures and options stay closed until the
 * WETH/USDC pit pool is seeded — the engines behind them are complete and
 * volatility/IV-safe (MM.md), they are launch-gated only.
 *
 * Override for sim/demo/drills with `VITE_MARKETS=spot,future,option`
 * (comma-separated; default `spot`). This is a product gate, not a risk
 * control — the risk engine (risk.ts) always applies.
 */

export type MarketKind = "spot" | "future" | "option";

function envMarkets(): Set<string> {
  try {
    const raw = String(
      (import.meta as { env?: { VITE_MARKETS?: string } }).env?.VITE_MARKETS ?? "spot",
    );
    const list = raw
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    return new Set(list.length ? list : ["spot"]);
  } catch {
    return new Set(["spot"]);
  }
}

const OPEN = envMarkets();

export const MARKET_LAUNCH = {
  /** Spot fills route via the DEX aggregator (external WETH/USDC liquidity). */
  spotRoute: "aggregator" as const,
  spotOpen: OPEN.has("spot"),
  futuresOpen: OPEN.has("future") || OPEN.has("futures"),
  optionsOpen: OPEN.has("option") || OPEN.has("options"),
  reason:
    "Perps & options unlock when the WETH/USDC pit pool is seeded. Spot is live — routed via the DEX aggregator.",
} as const;

export function marketOpen(kind: MarketKind): boolean {
  if (kind === "spot") return MARKET_LAUNCH.spotOpen;
  if (kind === "future") return MARKET_LAUNCH.futuresOpen;
  return MARKET_LAUNCH.optionsOpen;
}

export function marketClosedReason(kind: MarketKind): string | null {
  return marketOpen(kind) ? null : MARKET_LAUNCH.reason;
}
