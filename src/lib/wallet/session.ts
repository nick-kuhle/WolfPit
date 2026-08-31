import { create } from "zustand";

export type EthProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (ev: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (ev: string, cb: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: EthProvider[];
};

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

const CHAINS: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
  56: "BNB",
  11155111: "Sepolia",
  84532: "Base Sepolia",
};

type Wallet = {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  ready: boolean;
  hydrate: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
};

function pickProvider(): EthProvider | null {
  if (typeof window === "undefined") return null;
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length) {
    return eth.providers.find((p) => p.isMetaMask) || eth.providers.find((p) => p.isCoinbaseWallet) || eth.providers[0]!;
  }
  return eth;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function truncAddr(addr: string | null) {
  if (!addr) return "";
  return short(addr);
}

export function chainName(id: number | null) {
  if (!id) return "—";
  return CHAINS[id] ?? `Chain ${id}`;
}

let bound: EthProvider | null = null;
let onAcc: ((...a: unknown[]) => void) | null = null;
let onChain: ((...a: unknown[]) => void) | null = null;

function detach() {
  if (bound && onAcc) bound.removeListener?.("accountsChanged", onAcc);
  if (bound && onChain) bound.removeListener?.("chainChanged", onChain);
  bound = null;
  onAcc = null;
  onChain = null;
}

function attach(eth: EthProvider, set: (p: Partial<Wallet>) => void) {
  detach();
  bound = eth;
  onAcc = (accs: unknown) => {
    const list = Array.isArray(accs) ? accs.map(String) : [];
    set({ address: list[0]?.toLowerCase() ?? null, error: null });
  };
  onChain = (id: unknown) => {
    const n = typeof id === "string" ? parseInt(id, 16) : Number(id);
    set({ chainId: Number.isFinite(n) ? n : null });
  };
  eth.on?.("accountsChanged", onAcc);
  eth.on?.("chainChanged", onChain);
}

export const useWallet = create<Wallet>((set, get) => ({
  address: null,
  chainId: null,
  connecting: false,
  error: null,
  ready: false,
  hydrate: async () => {
    const eth = pickProvider();
    if (!eth) {
      set({ ready: true, address: null, chainId: null });
      return;
    }
    attach(eth, set);
    try {
      const accs = (await eth.request({ method: "eth_accounts" })) as string[];
      const chain = (await eth.request({ method: "eth_chainId" })) as string;
      set({
        address: accs[0]?.toLowerCase() ?? null,
        chainId: parseInt(chain, 16),
        ready: true,
        error: null,
      });
    } catch {
      set({ ready: true });
    }
  },
  connect: async () => {
    const eth = pickProvider();
    if (!eth) {
      set({ error: "No wallet in this browser. Open the pit in MetaMask or Coinbase Wallet." });
      return;
    }
    set({ connecting: true, error: null });
    attach(eth, set);
    try {
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chain = (await eth.request({ method: "eth_chainId" })) as string;
      const address = accs[0]?.toLowerCase() ?? null;
      if (!address) {
        set({ connecting: false, error: "Wallet returned no account." });
        return;
      }
      set({
        address,
        chainId: parseInt(chain, 16),
        connecting: false,
        error: null,
        ready: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet rejected.";
      set({ connecting: false, error: msg, address: get().address });
    }
  },
  disconnect: () => {
    detach();
    set({ address: null, error: null, connecting: false });
  },
}));

export function hasInjectedWallet() {
  return typeof window !== "undefined" && Boolean(pickProvider());
}

/** Raw EIP-1193 provider for the active wallet (viem custom transport). */
export function getProvider(): EthProvider | null {
  return pickProvider();
}

/**
 * Ensure the wallet is on Base (8453), prompting a network switch / add if not.
 * Returns true when the wallet ends up on Base.
 */
export function dappUrl() {
  if (typeof window === "undefined") return "https://wolfpit-protocol.vercel.app";
  return window.location.href;
}
