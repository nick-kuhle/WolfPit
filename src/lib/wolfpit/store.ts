import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  addLiquidity,
  applyLive as applyLiveFeed,
  buyOption,
  closeFuture,
  closeOption,
  cancelWorking,
  createPool as createPoolEngine,
  ensureListed,
  equity,
  harvestFarm,
  initialState,
  issueToken as issueTokenEngine,
  placeDeskOrder,
  removeLiquidity,
  stakeWpit,
  joinCompetition as joinCompEngine,
  payCompPrize,
  tick,
  tradeFuture,
  tradeSpot,
  unstakeWpit,
} from "./engine";
import { placeTickets, settleGames, ensureRaces } from "./games";
import type { BetMarket, EngineState, FutSide, OptType, PoolId, RaceKind, WorkingOrder } from "./types";
import { useAdmin } from "@/lib/admin/config";
import { PIT_OPEN, compBoard } from "./comp";
import { ping } from "./alerts";
import { sanitizeState } from "./sanitize";
import { useWallet } from "@/lib/wallet/session";
import { marketClosedReason } from "./features";

function announceSettled(prev: EngineState, next: EngineState) {
  const prevFill = prev.fills[0]?.id;
  const fresh: typeof next.fills = [];
  for (const f of next.fills) {
    if (f.id === prevFill) break;
    fresh.push(f);
  }
  for (const f of fresh.slice(0, 8)) {
    if (f.side === "win") {
      const profit = typeof f.pnl === "number" ? f.pnl : f.size;
      ping(`Won +${profit.toFixed(2)} WPIT · ${f.symbol}`, "up", true);
    } else if (f.side === "lose") ping(`Ticket lost · ${f.symbol}`, "down");
  }
  const prevMeet = prev.games?.meets[0]?.raceId;
  const meet = next.games?.meets[0];
  if (meet?.raceId && meet.raceId !== prevMeet) {
    ping(`Official · ${meet.kind} ${meet.winnerName} (${meet.winner})`, "brass");
  }
}

type Actions = {
  lastError: string | null;
  rehydrate: () => void;
  step: (dtSec: number) => void;
  setSpeed: (n: 1 | 10 | 60) => void;
  buySpot: (pool: PoolId, usd: number) => void;
  sellSpot: (pool: PoolId, baseAmt: number) => void;
  openFut: (side: FutSide, contracts: number, expiry: number) => void;
  closeFut: (id: string) => void;
  openOpt: (type: OptType, strike: number, expiry: number, contracts: number) => void;
  lpAdd: (pool: PoolId, usd: number) => void;
  lpRemove: (pool: PoolId, shares: number) => void;
  closeOpt: (id: string) => void;
  lockStake: (amt: number) => void;
  unstake: () => void;
  harvest: () => void;
  reset: () => void;
  clearError: () => void;
  seedVault: (eth: number, usdc: number) => void;
  applyLive: (feed: {
    eth: number;
    candles: EngineState["candles"];
    btc?: number;
    at: number;
    source: string;
    ethBid?: number;
    ethAsk?: number;
  }) => void;
  createPool: (base: string, quote: string, baseAmt: number, quoteAmt: number) => void;
  issueToken: (sym: string, amt: number) => void;
  sendOrder: (o: Omit<WorkingOrder, "id" | "created">) => void;
  cancelOrder: (id: string) => void;
  listToken: (symbol: string, mark: number) => void;
  joinComp: () => void;
  placeRaceBet: (kind: RaceKind, picks: number[], stake: number, market?: BetMarket) => void;
  seedRaces: () => void;
};

type WolfStore = EngineState & Actions;

function gated(): string | null {
  if (useAdmin.getState().listingsPaused) return "Listings paused by pit ops.";
  if (useAdmin.getState().geoFenceUs) return "US geo-fence on. Futures and options hidden.";
  return null;
}

function apply(result: EngineState | string, set: (p: Partial<WolfStore>) => void, sent = false) {
  if (typeof result === "string") {
    ping(result, "down");
    set({ lastError: result });
    return;
  }
  if (sent) ping("Order sent", "brass", true);
  const fill = result.fills[0];
  const prev = useWolf.getState().fills[0]?.id;
  if (fill && fill.id !== prev) {
    ping(`Order filled · ${fill.side} ${fill.symbol} ${fill.size.toPrecision(4)} @ ${fill.price.toPrecision(6)}`, "up", true);
  }
  set({ ...result, lastError: null });
}

export const useWolf = create<WolfStore>()(
  persist(
    (set, get) => ({
      ...initialState(),
      lastError: null,
      rehydrate: () => {
        void useWolf.persist.rehydrate();
      },
      step: (dtSec) => {
        set((s) => {
          let next = tick(s, dtSec);
          next = settleGames(next, Date.now());
          if (next.compJoined && !next.compPaid && Date.now() >= PIT_OPEN.end) {
            const board = compBoard(Date.now(), { name: "You", equity: equity(next), joined: true });
            const you = board.find((r) => r.you);
            next = payCompPrize(next, you?.place ?? 99);
            if ((you?.place ?? 99) <= 3) ping(`Pit Open prize · ${you?.place}`, "brass");
          }
          announceSettled(s, next);
          const prevFill = s.fills[0]?.id;
          for (const f of next.fills) {
            if (f.id === prevFill) break;
            if (f.side === "win" || f.side === "lose" || f.side === "bet") continue;
            ping(`Order filled · ${f.side} ${f.symbol} ${f.size.toPrecision(4)} @ ${f.price.toPrecision(6)}`, "up", true);
          }
          return next;
        });
      },
      setSpeed: (simSpeed) => set({ simSpeed }),
      buySpot: (pool, usd) => apply(tradeSpot(get(), pool, "buy", usd), set),
      sellSpot: (pool, baseAmt) => apply(tradeSpot(get(), pool, "sell", baseAmt), set),
      openFut: (side, contracts, expiry) => {
        const g = gated() ?? marketClosedReason("future");
        if (g) {
          set({ lastError: g });
          ping(g, "down");
          return;
        }
        apply(tradeFuture(get(), side, contracts, expiry), set);
      },
      closeFut: (id) => {
        apply(closeFuture(get(), id), set);
        if (!get().lastError) ping("Mini closed", "brass");
      },
      closeOpt: (id) => {
        apply(closeOption(get(), id), set);
        if (!get().lastError) ping("Option closed", "brass");
      },
      openOpt: (type, strike, expiry, contracts) => {
        const g = gated() ?? marketClosedReason("option");
        if (g) {
          set({ lastError: g });
          ping(g, "down");
          return;
        }
        apply(buyOption(get(), type, strike, expiry, contracts), set);
      },
      lpAdd: (pool, usd) => {
        const r = addLiquidity(get(), pool, usd);
        apply(r, set);
        if (typeof r !== "string") ping(`Liquidity added · ${pool}`, "up");
      },
      lpRemove: (pool, shares) => {
        const r = removeLiquidity(get(), pool, shares);
        apply(r, set);
        if (typeof r !== "string") ping(`Liquidity removed · ${pool}`, "brass");
      },
      lockStake: (amt) => apply(stakeWpit(get(), amt), set),
      unstake: () => set(unstakeWpit(get())),
      harvest: () => {
        const before = get().harvestedWpit ?? 0;
        const next = harvestFarm(get());
        set(next);
        if ((next.harvestedWpit ?? 0) > before) ping("Harvested WPIT", "up");
        else ping("Nothing ripe. Add LP first.", "brass");
      },
      seedVault: (eth, usdc) => {
        if (!Number.isFinite(eth) || !Number.isFinite(usdc) || eth < 0 || usdc < 0) return;
        set({
          vault: {
            ...get().vault,
            eth: Math.min(eth, 1_000_000),
            usdc: Math.min(usdc, 1_000_000_000),
          },
        });
      },
      applyLive: (feed) =>
        set((s) => {
          const next = settleGames(applyLiveFeed(s, feed), Date.now());
          announceSettled(s, next);
          return next;
        }),
      createPool: (base, quote, baseAmt, quoteAmt) => {
        const r = createPoolEngine(get(), base, quote, baseAmt, quoteAmt);
        apply(r, set);
        if (typeof r !== "string") ping(`Pool created · ${base}-${quote}`, "up");
      },
      issueToken: (sym, amt) => apply(issueTokenEngine(get(), sym, amt), set),
      sendOrder: (o) => {
        if (useAdmin.getState().listingsPaused) {
          ping("Listings paused by pit ops.", "down");
          set({ lastError: "Listings paused by pit ops." });
          return;
        }
        if ((o.product === "future" || o.product === "option") && useAdmin.getState().geoFenceUs) {
          ping("US geo-fence on. Futures and options hidden.", "down");
          set({ lastError: "US geo-fence on. Futures and options hidden." });
          return;
        }
        const closed = marketClosedReason(o.product);
        if (closed) {
          ping(closed, "down");
          set({ lastError: closed });
          return;
        }
        apply(placeDeskOrder(get(), o), set, true);
      },
      cancelOrder: (id) => {
        ping("Order cancelled", "brass");
        set(cancelWorking(get(), id));
      },
      listToken: (symbol, mark) =>
        set((s) => {
          const next = ensureListed(s, symbol, mark);
          return next === s ? s : next;
        }),
      joinComp: () => {
        if (!useWallet.getState().address) {
          ping("Connect a wallet to enter the Pit Open.", "brass");
          return;
        }
        ping("You're in the Pit Open. $100k paper. Go shout.", "brass");
        set({ ...joinCompEngine(get()), lastError: null });
      },
      placeRaceBet: (kind, picks, stake, market = "win") => {
        set((s) => {
          const r = placeTickets(s, kind, picks, stake, Date.now(), market);
          if (typeof r === "string") {
            ping(r, "down");
            return { lastError: r };
          }
          const n = r.games?.bets.filter((b) => b.status === "open" && b.placedAt >= Date.now() - 2000).length ?? 1;
          ping(`Ticket${n > 1 ? "s" : ""} · ${market.toUpperCase()} · ${stake} WPIT`, "brass", true);
          return { ...r, lastError: null };
        });
      },
      seedRaces: () =>
        set((s) => {
          const next = settleGames(ensureRaces(s, Date.now()), Date.now());
          announceSettled(s, next);
          return next;
        }),
      reset: () => {
        ping("Paper reset", "brass");
        set({ ...initialState(), lastError: null });
      },
      clearError: () => set({ lastError: null }),
    }),
    {
      name: "wolfpit-sim-v12",
      skipHydration: true,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<EngineState>;
        return { ...current, ...sanitizeState(p, initialState()) };
      },
      partialize: (s) => ({
        clock: s.clock,
        eth: s.eth,
        ethBid: s.ethBid,
        ethAsk: s.ethAsk,
        wpit: s.wpit,
        btc: s.btc,
        liveAt: s.liveAt,
        liveSource: s.liveSource,
        iv: s.iv,
        realizedVol: s.realizedVol,
        candles: s.candles,
        wpitCandles: s.wpitCandles,
        account: s.account,
        vault: s.vault,
        pools: s.pools,
        lp: s.lp,
        stake: s.stake,
        futures: s.futures,
        options: s.options,
        fills: s.fills,
        working: s.working,
        farmWpit: s.farmWpit,
        harvestedWpit: s.harvestedWpit,
        insuranceUsdc: s.insuranceUsdc,
        circuitUntil: s.circuitUntil,
        simSpeed: s.simSpeed,
        liquidations: s.liquidations,
        equityTape: s.equityTape,
        compJoined: s.compJoined,
        compPaid: s.compPaid,
        games: s.games,
      }),
    },
  ),
);

export function useEquity() {
  return useWolf(equity);
}
