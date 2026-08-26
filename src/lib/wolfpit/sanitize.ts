import { WPIT_PX_MAX, WPIT_PX_MIN } from "./limits";
import type { EngineState, PoolState } from "./types";

export const ETH_MIN = 50;
export const ETH_MAX = 250_000;
export const ORACLE_JUMP = 0.12;
const MAX_BAL = 1e12;

function fin(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function nn(n: unknown, fallback = 0): number {
  return Math.max(0, fin(n, fallback));
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

function cleanPool(p: PoolState | undefined, id: string): PoolState | null {
  if (!p) return null;
  const base = String(p.base ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  const quote = String(p.quote ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  if (!base || !quote || base === quote) return null;
  const baseReserve = nn(p.baseReserve);
  const quoteReserve = nn(p.quoteReserve);
  if (!(baseReserve > 0) || !(quoteReserve > 0)) return null;
  return {
    id: String(p.id || id),
    base,
    quote,
    baseReserve,
    quoteReserve,
    lpSupply: nn(p.lpSupply),
    feeBps: clamp(Math.round(fin(p.feeBps, 30)), 1, 100),
  };
}

/** Rebuild a ledger from persisted JSON. Drops NaN, negatives, and phantom books. */
export function sanitizeState(raw: Partial<EngineState> | null | undefined, fallback: EngineState): EngineState {
  const base = fallback;
  if (!raw || typeof raw !== "object") return base;

  const eth = clamp(nn(raw.eth, base.eth), ETH_MIN, ETH_MAX);
  const wpit = clamp(nn(raw.wpit, base.wpit), WPIT_PX_MIN, WPIT_PX_MAX);

  const pools: EngineState["pools"] = { ...base.pools };
  if (raw.pools && typeof raw.pools === "object") {
    for (const [id, p] of Object.entries(raw.pools)) {
      const clean = cleanPool(p as PoolState, id);
      if (clean) pools[id] = clean;
    }
  }

  const vaultIn = raw.vault ?? base.vault;
  const vault = {
    eth: nn(vaultIn.eth, base.vault.eth),
    usdc: nn(vaultIn.usdc, base.vault.usdc),
    reservedEth: nn(vaultIn.reservedEth),
    reservedUsdc: nn(vaultIn.reservedUsdc),
    hedgeEth: fin(vaultIn.hedgeEth),
    escrowUsdc: nn(vaultIn.escrowUsdc),
  };
  vault.reservedEth = Math.min(vault.reservedEth, vault.eth);
  vault.reservedUsdc = Math.min(vault.reservedUsdc, vault.usdc);
  vault.escrowUsdc = Math.min(vault.escrowUsdc, Math.max(0, vault.usdc - vault.reservedUsdc));

  const accIn = raw.account ?? base.account;
  const tokens: Record<string, number> = {};
  for (const [k, v] of Object.entries(accIn.tokens ?? {})) {
    const sym = k.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const qty = nn(v);
    if (sym && qty > 0 && qty < MAX_BAL) tokens[sym] = qty;
  }

  const futures = (raw.futures ?? [])
    .filter((p) => p && ((p.under ?? "ETH") === "ETH" || p.under === "WPIT"))
    .filter((p) => p && nn(p.sizeEth) > 0 && nn(p.entry) > 0 && nn(p.margin) >= 0 && nn(p.expiry) > 0)
    .slice(0, 80)
    .map((p) => ({
      ...p,
      sizeEth: nn(p.sizeEth),
      entry: nn(p.entry),
      margin: nn(p.margin),
      expiry: nn(p.expiry),
      openedAt: nn(p.openedAt),
      side: p.side === "short" ? ("short" as const) : ("long" as const),
      under: (p.under ?? "ETH") === "WPIT" ? "WPIT" : "ETH",
    }));

  const options = (raw.options ?? [])
    .filter((p) => p && nn(p.sizeEth) > 0 && nn(p.strike) > 0 && nn(p.expiry) > 0)
    .filter((p) => (p.under ?? "ETH") === "ETH" || p.under === "WPIT")
    .slice(0, 80)
    .map((p) => ({
      ...p,
      sizeEth: nn(p.sizeEth),
      strike: nn(p.strike),
      premium: nn(p.premium),
      expiry: nn(p.expiry),
      openedAt: nn(p.openedAt),
      type: p.type === "put" ? ("put" as const) : ("call" as const),
      under: p.under === "WPIT" ? "WPIT" : "ETH",
      securedUsdc: nn(p.securedUsdc),
      securedEth: nn(p.securedEth),
    }));

  const lp = (raw.lp ?? [])
    .filter((p) => p && pools[p.poolId] && nn(p.shares) > 0)
    .slice(0, 40)
    .map((p) => ({
      poolId: p.poolId,
      shares: Math.min(nn(p.shares), pools[p.poolId]!.lpSupply),
      costUsdc: nn(p.costUsdc),
    }));

  return {
    ...base,
    eth,
    ethBid: clamp(nn(raw.ethBid, eth), ETH_MIN, ETH_MAX),
    ethAsk: clamp(nn(raw.ethAsk, eth), ETH_MIN, ETH_MAX),
    wpit,
    btc: nn(raw.btc),
    iv: clamp(nn(raw.iv, base.iv), 0.1, 3),
    realizedVol: clamp(nn(raw.realizedVol, base.realizedVol), 0.1, 3),
    clock: nn(raw.clock, base.clock),
    liveAt: nn(raw.liveAt),
    liveSource: typeof raw.liveSource === "string" ? raw.liveSource.slice(0, 40) : base.liveSource,
    account: {
      usdc: clamp(nn(accIn.usdc), 0, MAX_BAL),
      eth: clamp(nn(accIn.eth), 0, MAX_BAL),
      wpit: clamp(nn(accIn.wpit), 0, MAX_BAL),
      tokens,
      realized: fin(accIn.realized),
      startEquity: nn(accIn.startEquity, base.account.startEquity),
    },
    vault,
    pools,
    lp,
    stake: { amount: nn(raw.stake?.amount), since: nn(raw.stake?.since, base.clock) },
    futures,
    options,
    fills: Array.isArray(raw.fills) ? raw.fills.slice(0, 80) : [],
    working: Array.isArray(raw.working) ? raw.working.slice(0, 40) : [],
    farmWpit: nn(raw.farmWpit),
    harvestedWpit: nn(raw.harvestedWpit),
    insuranceUsdc: nn(raw.insuranceUsdc, base.insuranceUsdc),
    circuitUntil: nn(raw.circuitUntil),
    simSpeed: raw.simSpeed === 10 || raw.simSpeed === 60 ? raw.simSpeed : 1,
    liquidations: nn(raw.liquidations),
    equityTape: Array.isArray(raw.equityTape) ? raw.equityTape.slice(-240) : base.equityTape,
    candles: Array.isArray(raw.candles) && raw.candles.length > 8 ? raw.candles.slice(-240) : base.candles,
    wpitCandles: Array.isArray(raw.wpitCandles) && raw.wpitCandles.length > 8 ? raw.wpitCandles.slice(-240) : base.wpitCandles,
    compJoined: Boolean(raw.compJoined),
    compPaid: Boolean(raw.compPaid),
  };
}
