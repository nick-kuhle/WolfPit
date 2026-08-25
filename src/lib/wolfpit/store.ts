import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  addLiquidity,
  buyOption,
  closeFuture,
  closeOption,
  equity,
  harvestFarm,
  initialState,
  removeLiquidity,
  stakeWpit,
  tick,
  tradeFuture,
  tradeSpot,
  unstakeWpit,
} from "./engine";
import type { EngineState, FutSide, OptType, PoolId } from "./types";

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
};

type WolfStore = EngineState & Actions;

function apply(result: EngineState | string, set: (p: Partial<WolfStore>) => void) {
  if (typeof result === "string") {
    set({ lastError: result });
    return;
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
      step: (dtSec) => set(tick(get(), dtSec)),
      setSpeed: (simSpeed) => set({ simSpeed }),
      buySpot: (pool, usd) => apply(tradeSpot(get(), pool, "buy", usd), set),
      sellSpot: (pool, baseAmt) => apply(tradeSpot(get(), pool, "sell", baseAmt), set),
      openFut: (side, contracts, expiry) => apply(tradeFuture(get(), side, contracts, expiry), set),
      closeFut: (id) => apply(closeFuture(get(), id), set),
      closeOpt: (id) => apply(closeOption(get(), id), set),
      openOpt: (type, strike, expiry, contracts) => apply(buyOption(get(), type, strike, expiry, contracts), set),
      lpAdd: (pool, usd) => apply(addLiquidity(get(), pool, usd), set),
      lpRemove: (pool, shares) => apply(removeLiquidity(get(), pool, shares), set),
      lockStake: (amt) => apply(stakeWpit(get(), amt), set),
      unstake: () => set(unstakeWpit(get())),
      harvest: () => set(harvestFarm(get())),
      reset: () => set({ ...initialState(), lastError: null }),
      clearError: () => set({ lastError: null }),
    }),
    {
      name: "wolfpit-sim-v4",
      skipHydration: true,
      partialize: (s) => ({
        clock: s.clock,
        eth: s.eth,
        wpit: s.wpit,
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
        farmWpit: s.farmWpit,
        insuranceUsdc: s.insuranceUsdc,
        circuitUntil: s.circuitUntil,
        simSpeed: s.simSpeed,
        liquidations: s.liquidations,
      }),
    },
  ),
);

export function useEquity() {
  return useWolf(equity);
}
