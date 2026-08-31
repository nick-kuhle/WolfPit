/**
 * Multi-chain catalog for the live spot desk.
 *
 * Swaps default to Base (WolfPit's home chain) but work on every chain the 0x
 * aggregator serves. Each entry wires the viem chain definition (RPC + chain
 * params for wallet_addEthereumChain) to the metadata the UI needs.
 *
 * Optional per-chain RPC overrides: `VITE_RPC_URLS` — a JSON map
 * `{"8453":"https://…","1":"https://…"}`. Falls back to each chain's public
 * endpoint. (`VITE_BASE_RPC_URL` still works as a Base-only shorthand.)
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  erc20Abi,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  arbitrum,
  avalanche,
  base,
  berachain,
  blast,
  bsc,
  celo,
  gnosis,
  linea,
  mainnet,
  mantle,
  optimism,
  polygon,
  scroll,
  unichain,
  zkSync,
  type Chain,
} from "viem/chains";
import type { EthProvider } from "@/lib/wallet/session";

/** 0x sentinel for the chain-native asset in Swap API calls. */
export const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export type SwapChain = {
  id: number;
  /** Short label for selectors, e.g. "Base". */
  label: string;
  viem: Chain;
  /** Native asset shown in token lists, e.g. ETH on Base. */
  native: { symbol: string; name: string; decimals: number };
  /** Explorer base URL for tx/token links. */
  explorer: string;
};

const def = (c: Chain) => c.blockExplorers?.default.url ?? "";

export const SWAP_CHAINS: SwapChain[] = [
  { id: 8453, label: "Base", viem: base, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(base) },
  { id: 1, label: "Ethereum", viem: mainnet, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(mainnet) },
  { id: 42161, label: "Arbitrum", viem: arbitrum, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(arbitrum) },
  { id: 10, label: "Optimism", viem: optimism, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(optimism) },
  { id: 137, label: "Polygon", viem: polygon, native: { symbol: "POL", name: "Polygon", decimals: 18 }, explorer: def(polygon) },
  { id: 56, label: "BNB", viem: bsc, native: { symbol: "BNB", name: "BNB", decimals: 18 }, explorer: def(bsc) },
  { id: 43114, label: "Avalanche", viem: avalanche, native: { symbol: "AVAX", name: "Avalanche", decimals: 18 }, explorer: def(avalanche) },
  { id: 100, label: "Gnosis", viem: gnosis, native: { symbol: "xDAI", name: "xDai", decimals: 18 }, explorer: def(gnosis) },
  { id: 42220, label: "Celo", viem: celo, native: { symbol: "CELO", name: "Celo", decimals: 18 }, explorer: def(celo) },
  { id: 5000, label: "Mantle", viem: mantle, native: { symbol: "MNT", name: "Mantle", decimals: 18 }, explorer: def(mantle) },
  { id: 81457, label: "Blast", viem: blast, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(blast) },
  { id: 59144, label: "Linea", viem: linea, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(linea) },
  { id: 534352, label: "Scroll", viem: scroll, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(scroll) },
  { id: 324, label: "ZKsync", viem: zkSync, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(zkSync) },
  { id: 130, label: "Unichain", viem: unichain, native: { symbol: "ETH", name: "Ether", decimals: 18 }, explorer: def(unichain) },
  { id: 80094, label: "Berachain", viem: berachain, native: { symbol: "BERA", name: "Berachain", decimals: 18 }, explorer: def(berachain) },
];

/** WolfPit deploys on Base — the desk always opens here. */
export const DEFAULT_CHAIN_ID = 8453;

export function chainById(id: number): SwapChain | undefined {
  return SWAP_CHAINS.find((c) => c.id === id);
}

export function isSupportedChain(id: number): boolean {
  return Boolean(chainById(id));
}

/** Per-chain RPC override map from VITE_RPC_URLS (JSON), + legacy Base shorthand. */
function rpcOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    const base = env?.VITE_BASE_RPC_URL?.trim();
    if (base) out[String(DEFAULT_CHAIN_ID)] = base;
    const json = env?.VITE_RPC_URLS?.trim();
    if (json) {
      try {
        const parsed = JSON.parse(json) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v.trim() && /^\d+$/.test(k)) out[k] = v.trim();
        }
      } catch {
        /* malformed JSON — ignore, use defaults */
      }
    }
  } catch {
    /* non-Vite context */
  }
  return out;
}

function rpcUrlFor(chain: SwapChain): string | undefined {
  return rpcOverrides()[String(chain.id)];
}

const clients = new Map<number, PublicClient>();

/** Shared read-only client for a chain (public endpoint unless overridden). */
export function publicClientFor(chainId: number): PublicClient | undefined {
  const chain = chainById(chainId);
  if (!chain) return undefined;
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: chain.viem, transport: http(rpcUrlFor(chain)) });
    clients.set(chainId, c);
  }
  return c;
}

/** Wallet-scoped client bound to the injected provider on a given chain. */
export function walletClientFor(provider: EthProvider, account: string, chainId: number): WalletClient | undefined {
  const chain = chainById(chainId);
  if (!chain) return undefined;
  return createWalletClient({
    account: account as Hex,
    chain: chain.viem,
    transport: custom(provider as Parameters<typeof custom>[0]),
  });
}

/**
 * Ensure the wallet is on `chainId`, prompting switch / add when needed.
 * Add-chain params come from the viem definition, so nothing is hand-rolled.
 */
export async function ensureChain(provider: EthProvider, chainId: number): Promise<boolean> {
  const chain = chainById(chainId);
  if (!chain) return false;
  const hexId = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return true;
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexId,
              chainName: chain.label,
              nativeCurrency: {
                name: chain.native.name,
                symbol: chain.native.symbol,
                decimals: chain.native.decimals,
              },
              rpcUrls: [rpcUrlFor(chain) ?? chain.viem.rpcUrls.default.http[0]!],
              blockExplorerUrls: chain.explorer ? [chain.explorer] : [],
            },
          ],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function isNative(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

/** The chain-native asset expressed as a SpotToken-like object. */
export function nativeTokenOf(chainId: number) {
  const chain = chainById(chainId);
  if (!chain) return undefined;
  return {
    symbol: chain.native.symbol,
    name: chain.native.name,
    address: NATIVE_TOKEN,
    decimals: chain.native.decimals,
    native: true as const,
  };
}

/** ERC-20 metadata via direct static calls (address paste fallback). */
export async function readErc20Meta(
  chainId: number,
  address: string,
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  const pc = publicClientFor(chainId);
  if (!pc) return null;
  try {
    const [symbol, name, decimals] = await Promise.all([
      pc.readContract({ address: address as Hex, abi: erc20Abi, functionName: "symbol" }),
      pc.readContract({ address: address as Hex, abi: erc20Abi, functionName: "name" }),
      pc.readContract({ address: address as Hex, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (typeof symbol !== "string") return null;
    const dec = typeof decimals === "bigint" ? Number(decimals) : typeof decimals === "number" ? decimals : NaN;
    if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
    return { symbol, name: typeof name === "string" ? name : symbol, decimals: dec };
  } catch {
    return null;
  }
}
