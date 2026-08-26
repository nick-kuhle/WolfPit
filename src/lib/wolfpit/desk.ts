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
  network?: string;
  poolAddress?: string;
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

export function wpitListing(price: number, change24: number, vol = 2_400_000): Listing {
  return {
    symbol: "WPIT",
    name: "WolfPit",
    price,
    change24,
    volume24: vol,
    chain: "Base",
  };
}

type DeskUi = {
  focus: Listing;
  universe: Listing[];
  chainTape: Listing[];
  chainId: string;
  query: string;
  cardOpen: boolean;
  expanded: boolean;
  saved: string[];
  setFocus: (l: Listing) => void;
  setUniverse: (rows: Listing[]) => void;
  setChainTape: (rows: Listing[]) => void;
  setChainId: (id: string) => void;
  setQuery: (q: string) => void;
  openCard: (l: Listing) => void;
  closeCard: () => void;
  setExpanded: (v: boolean) => void;
  toggleSave: (sym: string, listing?: Listing) => void;
};

function loadSaved(): string[] {
  if (typeof window === "undefined") return ["ETH", "WPIT", "BTC"];
  try {
    const raw = window.localStorage.getItem("wolfpit-saved");
    const v = raw ? JSON.parse(raw) : ["ETH", "WPIT", "BTC"];
    return Array.isArray(v) && v.length ? v.map(String) : ["ETH", "WPIT", "BTC"];
  } catch {
    return ["ETH", "WPIT", "BTC"];
  }
}

export const useDesk = create<DeskUi>((set) => ({
  focus: ETH_LISTING,
  universe: [],
  chainTape: [],
  chainId: "eth",
  query: "",
  cardOpen: false,
  expanded: false,
  saved: loadSaved(),
  setFocus: (focus) => set({ focus }),
  setUniverse: (universe) => set({ universe }),
  setChainTape: (chainTape) => set({ chainTape }),
  setChainId: (chainId) => set({ chainId, chainTape: [] }),
  setQuery: (query) => set({ query }),
  openCard: (l) => set({ focus: l, cardOpen: true, expanded: false }),
  closeCard: () => set({ cardOpen: false, expanded: false }),
  setExpanded: (expanded) => set({ expanded }),
  toggleSave: (sym, listing) =>
    set((s) => {
      const key = sym.toUpperCase();
      const on = s.saved.includes(key);
      const saved = on ? s.saved.filter((x) => x !== key) : [...s.saved, key];
      let universe = s.universe;
      if (!on && listing && !universe.some((u) => u.symbol.toUpperCase() === key)) {
        universe = [{ ...listing, symbol: key }, ...universe];
      }
      if (typeof window !== "undefined") window.localStorage.setItem("wolfpit-saved", JSON.stringify(saved));
      return { saved, universe };
    }),
}));
