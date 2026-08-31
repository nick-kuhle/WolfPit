import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ContractBook = {
  usdc: string;
  weth: string;
  wpit: string;
  vault: string;
  wpitUsdc: string;
  wpitEth: string;
  farm: string;
  stake: string;
};

type AdminConfig = {
  listingsPaused: boolean;
  geoFenceUs: boolean;
  chainOverride: "sim" | "base-sepolia" | "base" | "";
  insuranceFloorBps: number;
  contracts: ContractBook;
  deployedAt: number | null;
  notes: string;
};

const EMPTY: ContractBook = {
  usdc: "",
  weth: "",
  wpit: "",
  vault: "",
  wpitUsdc: "",
  wpitEth: "",
  farm: "",
  stake: "",
};

const initial: AdminConfig = {
  listingsPaused: false,
  geoFenceUs: false,
  chainOverride: "",
  insuranceFloorBps: 100,
  contracts: EMPTY,
  deployedAt: null,
  notes: "",
};

type AdminStore = AdminConfig & {
  setPaused: (v: boolean) => void;
  setGeo: (v: boolean) => void;
  setChain: (v: AdminConfig["chainOverride"]) => void;
  setFloor: (n: number) => void;
  setContract: (k: keyof ContractBook, v: string) => void;
  setBook: (c: ContractBook) => void;
  setNotes: (n: string) => void;
  clearBook: () => void;
};

export const useAdmin = create<AdminStore>()(
  persist(
    (set) => ({
      ...initial,
      setPaused: (listingsPaused) => set({ listingsPaused }),
      setGeo: (geoFenceUs) => set({ geoFenceUs }),
      setChain: (chainOverride) => set({ chainOverride }),
      setFloor: (insuranceFloorBps) => set({ insuranceFloorBps }),
      setContract: (k, v) => set((s) => ({ contracts: { ...s.contracts, [k]: v } })),
      setBook: (contracts) => set({ contracts, deployedAt: Date.now() }),
      setNotes: (notes) => set({ notes }),
      clearBook: () => set({ contracts: EMPTY, deployedAt: null }),
    }),
    { name: "wolfpit-admin-v1" },
  ),
);

/**
 * F18: a TEST book must never look like a real deployment. The old fake
 * addresses were SHA-256 hashes in 0x form — indistinguishable from a real
 * contract address at a glance, and trivially mistakable for a live deploy in
 * a dashboard or downstream script. Placeholders are now explicitly labeled
 * `test:<key>` (NOT 0x-prefixed): any consumer that validates an EVM address
 * will reject them, and no operator can confuse them with a real book.
 * Replace them by pasting the SCRIPT output from a real deploy, or by wiring
 * env-provided addresses (VITE_VAULT / VITE_POOL_WPIT_USDC / …).
 */
export async function deployTestBook(): Promise<ContractBook> {
  void crypto; // keep the module isomorphic-safe for SSR (subtle never needed)
  const labels = ["usdc", "weth", "wpit", "vault", "wpitUsdc", "wpitEth", "farm", "stake"] as const;
  const book = { ...EMPTY };
  for (const k of labels) {
    book[k] = `test:${k}`;
  }
  return book;
}
