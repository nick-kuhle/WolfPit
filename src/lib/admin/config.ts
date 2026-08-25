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

export type AdminConfig = {
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

export async function deployTestBook(): Promise<ContractBook> {
  const labels = ["usdc", "weth", "wpit", "vault", "wpitUsdc", "wpitEth", "farm", "stake"] as const;
  const book = { ...EMPTY };
  for (const k of labels) {
    book[k] = await fakeAddress(`wolfpit-test:${k}`);
  }
  return book;
}

async function fakeAddress(label: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(label));
  const bytes = new Uint8Array(buf).slice(0, 20);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
