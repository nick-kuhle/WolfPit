import { MAX_LOT, WPIT_PX_MAX, WPIT_PX_MIN } from "./limits";
import { CIRCUIT_MS } from "./risk";
import { UTIL_CAP, type EngineState, type PoolState } from "./types";

const PRODUCTS = ["spot", "future", "option"] as const;
const KINDS = ["mkt", "lmt", "stp", "stl"] as const;
const TIFS = ["day", "gtc", "ioc"] as const;

export const ETH_MIN = 50;
export const ETH_MAX = 250_000;
export const ORACLE_JUMP = 0.12;
const MAX_BAL = 1e12;
// A restored state may not legally live in the future beyond real time + 1 day.
const MAX_CLOCK_DRIFT = 24 * 3600 * 1000;

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
  // Hard sanity: reserves must stay finite and bounded (a corrupt cache can
  // otherwise resurrect a 1e30 reserve and skew every mark/TVL off the pool).
  if (baseReserve > MAX_BAL || quoteReserve > MAX_BAL) return null;
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

function shotOf(v: unknown): { usdc: number; eth: number; wpit: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { usdc?: unknown; eth?: unknown; wpit?: unknown };
  return { usdc: nn(o.usdc), eth: nn(o.eth), wpit: nn(o.wpit) };
}
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

  // F13: the inventory law (`reserved ≤ α·asset`, INV in LP.md) must hold on
  // REHYDRATION, not just at fill time — a stale tab with a corrupt cache can
  // otherwise resurrect an over-reserved book the engine happily keeps trading.
  const vaultIn = raw.vault ?? base.vault;
  const vault = {
    eth: Math.min(nn(vaultIn.eth, base.vault.eth), MAX_BAL),
    usdc: Math.min(nn(vaultIn.usdc, base.vault.usdc), MAX_BAL),
    reservedEth: nn(vaultIn.reservedEth),
    reservedUsdc: nn(vaultIn.reservedUsdc),
    hedgeEth: fin(vaultIn.hedgeEth),
    escrowUsdc: nn(vaultIn.escrowUsdc),
  };
  vault.reservedEth = Math.min(vault.reservedEth, vault.eth * UTIL_CAP);
  vault.reservedUsdc = Math.min(vault.reservedUsdc, vault.usdc * UTIL_CAP);
  vault.escrowUsdc = Math.min(vault.escrowUsdc, Math.max(0, vault.usdc - vault.reservedUsdc));
  // The hedge can never exceed the vault's own ETH on either side of the book.
  vault.hedgeEth = clamp(vault.hedgeEth, -vault.eth, vault.eth);

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

  const clock = clamp(
    nn(raw.clock, base.clock),
    0,
    Math.max(base.clock, Date.now()) + MAX_CLOCK_DRIFT,
  );
  // circuitUntil may only be in the (recent) future: a corrupt cache can't
  // freeze the market for weeks, and an expired circuit must clear to 0.
  const circuitUntil = clamp(nn(raw.circuitUntil), 0, clock + 4 * CIRCUIT_MS);

  return {
    ...base,
    eth,
    ethBid: clamp(nn(raw.ethBid, eth), ETH_MIN, ETH_MAX),
    ethAsk: clamp(nn(raw.ethAsk, eth), ETH_MIN, ETH_MAX),
    wpit,
    btc: nn(raw.btc),
    iv: clamp(nn(raw.iv, base.iv), 0.1, 3),
    // realizedVol is restored for display continuity, but volCandles is NOT:
    // a cached series is stale by definition and re-pricing from it would be
    // worse than waiting 15 s for the next pull. rvLive therefore starts false
    // and flips true on the first applyLive carrying a real series, so the UI
    // can distinguish "measured" from "restored, pending refresh".
    realizedVol: clamp(nn(raw.realizedVol, base.realizedVol), 0.1, 3),
    volCandles: base.volCandles,
    rvBars: base.rvBars,
    rvSpanHours: base.rvSpanHours,
    rvLive: false,
    clock,
    circuitUntil,
    liveAt: Math.min(nn(raw.liveAt), clock),
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
    stake: { amount: nn(raw.stake?.amount), since: Math.min(nn(raw.stake?.since, base.clock), clock) },
    futures,
    options,
    fills: Array.isArray(raw.fills)
      ? raw.fills.slice(0, 80).map((f) => ({
          ...f,
          before: shotOf((f as { before?: unknown }).before),
          after: shotOf((f as { after?: unknown }).after),
        }))
      : [],
    // Working orders were previously rehydrated RAW (the one unsanitized
    // array). A corrupt cache could inject malformed orders (NaN qty, junk
    // product/side/kind/tif) that the engine's reject rails then have to
    // carry forever. Clean every field; drop orders with non-finite or
    // oversized qty.
    working: Array.isArray(raw.working)
      ? raw.working
          .filter((w) => w && typeof w === "object" && typeof w.id === "string")
          .filter((w) => {
            const q = nn(w.qty);
            return q > 0 && q <= MAX_LOT;
          })
          .slice(0, 40)
          .map((w) => ({
            id: String(w.id).slice(0, 40),
            product: (PRODUCTS as readonly string[]).includes(String(w.product))
              ? (w.product as "spot" | "future" | "option")
              : "spot",
            side: w.side === "sell" ? ("sell" as const) : ("buy" as const),
            kind: (KINDS as readonly string[]).includes(String(w.kind))
              ? (w.kind as "mkt" | "lmt" | "stp" | "stl")
              : "mkt",
            tif: (TIFS as readonly string[]).includes(String(w.tif))
              ? (w.tif as "day" | "gtc" | "ioc")
              : "day",
            qty: Math.min(nn(w.qty), MAX_LOT),
            limit:
              typeof w.limit === "number" && Number.isFinite(w.limit) && w.limit > 0
                ? Math.min(w.limit, MAX_BAL)
                : undefined,
            stop:
              typeof w.stop === "number" && Number.isFinite(w.stop) && w.stop > 0
                ? Math.min(w.stop, MAX_BAL)
                : undefined,
            poolId: typeof w.poolId === "string" ? w.poolId.slice(0, 40) : undefined,
            expiry: typeof w.expiry === "number" && Number.isFinite(w.expiry) ? w.expiry : undefined,
            strike:
              typeof w.strike === "number" && Number.isFinite(w.strike) && w.strike > 0
                ? Math.min(w.strike, MAX_BAL)
                : undefined,
            optType: w.optType === "put" ? ("put" as const) : w.optType === "call" ? ("call" as const) : undefined,
            under: typeof w.under === "string" ? w.under.toUpperCase().slice(0, 10) : undefined,
            created: nn(w.created),
          }))
      : [],
    farmWpit: nn(raw.farmWpit),
    harvestedWpit: nn(raw.harvestedWpit),
    // Insurance is a FRACTION of the book; bound it against the restored NAV so
    // a corrupt cache cannot inflate it (which would disarm the 1% halt).
    insuranceUsdc: Math.min(
      nn(raw.insuranceUsdc, base.insuranceUsdc),
      Math.max(base.insuranceUsdc, (vault.eth * eth + vault.usdc) * 0.5),
    ),
    simSpeed: raw.simSpeed === 10 || raw.simSpeed === 60 ? raw.simSpeed : 1,
    liquidations: nn(raw.liquidations),
    equityTape: Array.isArray(raw.equityTape) ? raw.equityTape.slice(-240) : base.equityTape,
    candles: Array.isArray(raw.candles) && raw.candles.length > 8 ? raw.candles.slice(-240) : base.candles,
    wpitCandles: Array.isArray(raw.wpitCandles) && raw.wpitCandles.length > 8 ? raw.wpitCandles.slice(-240) : base.wpitCandles,
    compJoined: Boolean(raw.compJoined),
    compPaid: Boolean(raw.compPaid),
    games: {
      vaultWpit: nn(raw.games?.vaultWpit, 200_000),
      bets: Array.isArray(raw.games?.bets)
        ? raw.games!.bets
            .filter((b) => b && typeof b.id === "string")
            .slice(0, 80)
            .map((b) => ({
              id: String(b.id),
              raceId: String(b.raceId ?? ""),
              kind: b.kind === "dog" ? "dog" as const : "horse" as const,
              runner: Math.max(1, Math.round(nn(b.runner, 1))),
              runnerB: b.runnerB ? Math.max(1, Math.round(nn(b.runnerB, 0))) : undefined,
              name: String(b.name ?? "").slice(0, 72),
              stake: nn(b.stake),
              odds: Math.min(150, Math.max(1.1, nn(b.odds, 2))),
              market:
                b.market === "place" || b.market === "show" || b.market === "quinella" || b.market === "exacta"
                  ? b.market
                  : "win",
              placedAt: nn(b.placedAt),
              status:
                b.status === "won" || b.status === "lost" || b.status === "refunded"
                  ? b.status
                  : "open",
              payout: nn(b.payout),
              groupId: typeof b.groupId === "string" ? b.groupId.slice(0, 40) : undefined,
            }))
        : [],
      meets: Array.isArray(raw.games?.meets)
        ? raw.games!.meets.slice(0, 24).map((m) => ({
            raceId: String(m.raceId ?? ""),
            kind: m.kind === "dog" ? "dog" as const : "horse" as const,
            winner: Math.max(1, Math.round(nn(m.winner, 1))),
            winnerName: String(m.winnerName ?? "").slice(0, 32),
            paid: nn(m.paid),
            at: nn(m.at),
            commit: typeof m.commit === "string" ? m.commit : undefined,
            seed: typeof m.seed === "string" ? m.seed : undefined,
          }))
        : [],
      races: sanitizeRaces(raw.games?.races),
    },
  };
}

function sanitizeRaces(raw: unknown): Record<string, { id: string; kind: "horse" | "dog"; commit: string; seed: string; winner: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { id: string; kind: "horse" | "dog"; commit: string; seed: string; winner: number }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, { id?: string; kind?: string; commit?: string; seed?: string; winner?: number }>)) {
    if (!v || typeof v.seed !== "string" || typeof v.commit !== "string") continue;
    out[k] = {
      id: String(v.id ?? k),
      kind: v.kind === "dog" ? "dog" : "horse",
      commit: v.commit.slice(0, 64),
      seed: v.seed.slice(0, 64),
      winner: Math.max(1, Math.round(Number(v.winner) || 1)),
    };
  }
  return out;
}
