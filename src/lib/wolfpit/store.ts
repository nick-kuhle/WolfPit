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
import type { EngineState, FutSide, OptType, PoolId, WorkingOrder } from "./types";
import { useAdmin } from "@/lib/admin/config";
import { PIT_OPEN, compBoard } from "./comp";
import { ping } from "./alerts";

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
};

type WolfStore = EngineState & Actions;

function gated(): string | null {
  if (useAdmin.getState().listingsPaused) return "Listings paused by pit ops.";
  if (useAdmin.getState().geoFenceUs) return "US geo-fence on. Futures and options hidden.";
  return null;
}

function apply(result: EngineState | string, set: (p: Partial<WolfStore>) => void) {
  if (typeof result === "string") {
    ping(result, "down");
    set({ lastError: result });
    return;
  }
  const fill = result.fills[0];
  const prev = useWolf.getState().fills[0]?.id;
  if (fill && fill.id !== prev) {
    ping(`${fill.side} ${fill.symbol} ${fill.size.toPrecision(4)} @ ${fill.price.toPrecision(6)}`, "up");
  } else if ((result.working?.length ?? 0) > (useWolf.getState().working?.length ?? 0)) {
    ping("Order working", "brass");
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
        let next = tick(get(), dtSec);
        if (next.compJoined && !next.compPaid && Date.now() >= PIT_OPEN.end) {
          const board = compBoard(Date.now(), { name: "You", equity: equity(next), joined: true });
          const you = board.find((r) => r.you);
          next = payCompPrize(next, you?.place ?? 99);
          if ((you?.place ?? 99) <= 3) ping(`Pit Open prize · ${you?.place}`, "brass");
        }
        set(next);
      },
      setSpeed: (simSpeed) => set({ simSpeed }),
      buySpot: (pool, usd) => apply(tradeSpot(get(), pool, "buy", usd), set),
      sellSpot: (pool, baseAmt) => apply(tradeSpot(get(), pool, "sell", baseAmt), set),
      openFut: (side, contracts, expiry) => {
        const g = gated();
        if (g) {
          set({ lastError: g });
          return;
        }
        apply(tradeFuture(get(), side, contracts, expiry), set);
      },
      closeFut: (id) => apply(closeFuture(get(), id), set),
      closeOpt: (id) => apply(closeOption(get(), id), set),
      openOpt: (type, strike, expiry, contracts) => {
        const g = gated();
        if (g) {
          set({ lastError: g });
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
        ping("Harvested WPIT", "up");
        set(harvestFarm(get()));
      },
      seedVault: (eth, usdc) =>
        set({
          vault: { ...get().vault, eth, usdc },
        }),
      applyLive: (feed) => set(applyLiveFeed(get(), feed)),
      createPool: (base, quote, baseAmt, quoteAmt) => {
        const r = createPoolEngine(get(), base, quote, baseAmt, quoteAmt);
        apply(r, set);
        if (typeof r !== "string") ping(`Pool created · ${base}-${quote}`, "up");
      },
      issueToken: (sym, amt) => apply(issueTokenEngine(get(), sym, amt), set),
      sendOrder: (o) => apply(placeDeskOrder(get(), o), set),
      cancelOrder: (id) => {
        ping("Order cancelled", "brass");
        set(cancelWorking(get(), id));
      },
      listToken: (symbol, mark) => set(ensureListed(get(), symbol, mark)),
      joinComp: () => {
        ping("You're in the Pit Open. $100k paper. Go shout.", "brass");
        set({ ...joinCompEngine(get()), lastError: null });
      },
      reset: () => {
        ping("Paper reset", "brass");
        set({ ...initialState(), lastError: null });
      },
      clearError: () => set({ lastError: null }),
    }),
    {
      name: "wolfpit-sim-v9",
      skipHydration: true,
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
        insuranceUsdc: s.insuranceUsdc,
        circuitUntil: s.circuitUntil,
        simSpeed: s.simSpeed,
        liquidations: s.liquidations,
        equityTape: s.equityTape,
        compJoined: s.compJoined,
        compPaid: s.compPaid,
      }),
    },
  ),
);

export function useEquity() {
  return useWolf(equity);
}
