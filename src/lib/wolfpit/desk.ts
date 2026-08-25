import { create } from "zustand";

export type Listing = {
  symbol: string;
  name: string;
  price: number;
  change24: number;
  volume24: number;
  image?: string;
  chain?: string;
  contract?: string;
  binance?: string;
  geckoId?: string;
};

export const ETH_LISTING: Listing = {
  symbol: "ETH",
  name: "Ethereum",
  price: 0,
  change24: 0,
  volume24: 0,
  chain: "Base",
  binance: "ETHUSDT",
  geckoId: "ethereum",
};

type DeskUi = {
  focus: Listing;
  universe: Listing[];
  query: string;
  setFocus: (l: Listing) => void;
  setUniverse: (rows: Listing[]) => void;
  setQuery: (q: string) => void;
};

export const useDesk = create<DeskUi>((set) => ({
  focus: ETH_LISTING,
  universe: [],
  query: "",
  setFocus: (focus) => set({ focus }),
  setUniverse: (universe) => set({ universe }),
  setQuery: (query) => set({ query }),
}));
