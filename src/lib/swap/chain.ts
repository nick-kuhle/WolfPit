/**
 * Client-side on-chain layer for real spot swaps (Base mainnet, viem).
 *
 * Reads (balances, allowance, WPIT holding) go through a public HTTP client.
 * Writes (approve, swap) go through the user's injected wallet (EIP-1193) that
 * the existing src/lib/wallet/session.ts already manages — we reuse that same
 * provider so there is one wallet session across the whole app.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID, NATIVE_TOKEN, WPIT_TOKEN } from "./config";
import type { EthProvider } from "@/lib/wallet/session";

function makePublicClient() {
  let rpc: string | undefined;
  try {
    rpc = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BASE_RPC_URL;
  } catch {
    rpc = undefined;
  }
  return createPublicClient({
    chain: base,
    transport: http(rpc && rpc.trim() ? rpc.trim() : undefined),
  });
}

let _public: ReturnType<typeof makePublicClient> | undefined;

/** Shared read-only client. RPC override via VITE_BASE_RPC_URL. */
export function publicClient() {
  if (!_public) _public = makePublicClient();
  return _public;
}

function walletClient(provider: EthProvider, account: string) {
  return createWalletClient({
    account: account as Hex,
    chain: base,
    transport: custom(provider as Parameters<typeof custom>[0]),
  });
}

export function isNative(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

export function toBaseUnits(amount: string, decimals: number): bigint {
  return parseUnits(amount as `${number}`, decimals);
}

export function fromBaseUnits(amount: bigint | string, decimals: number): string {
  return formatUnits(typeof amount === "bigint" ? amount : BigInt(amount), decimals);
}

/** Native ETH or ERC-20 balance in base units. */
export async function tokenBalance(address: string, owner: string): Promise<bigint> {
  const pc = publicClient();
  if (isNative(address)) {
    return pc.getBalance({ address: owner as Hex });
  }
  return pc.readContract({
    address: address as Hex,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner as Hex],
  });
}

/** ERC-20 allowance of `owner` to `spender` in base units (0 for native). */
export async function tokenAllowance(
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  if (isNative(token)) return 0n;
  const pc = publicClient();
  return pc.readContract({
    address: token as Hex,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner as Hex, spender as Hex],
  });
}

/** True when the wallet holds any WPIT (drives the 50% fee discount). */
export async function holdsWpit(owner: string): Promise<boolean> {
  if (!WPIT_TOKEN || !/^0x[0-9a-fA-F]{40}$/.test(WPIT_TOKEN)) return false;
  try {
    const bal = await tokenBalance(WPIT_TOKEN, owner);
    return bal > 0n;
  } catch {
    return false;
  }
}

/** Send an ERC-20 approve for `amount` (base units). Returns the tx hash. */
export async function approveToken(
  provider: EthProvider,
  account: string,
  token: string,
  spender: string,
  amount: bigint,
): Promise<Hex> {
  const wc = walletClient(provider, account);
  return wc.writeContract({
    address: token as Hex,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as Hex, amount],
    chain: base,
    account: account as Hex,
  });
}

/** Send the aggregator swap transaction. Returns the tx hash. */
export async function sendSwapTx(
  provider: EthProvider,
  account: string,
  tx: { to: string; data: string; value: string; gas?: string },
): Promise<Hex> {
  const wc = walletClient(provider, account);
  return wc.sendTransaction({
    to: tx.to as Hex,
    data: tx.data as Hex,
    value: BigInt(tx.value || "0"),
    gas: tx.gas ? BigInt(tx.gas) : undefined,
    chain: base,
    account: account as Hex,
  });
}

/** Wait for a receipt; returns true on success. */
export async function waitForReceipt(hash: Hex): Promise<boolean> {
  const pc = publicClient();
  const rcpt = await pc.waitForTransactionReceipt({ hash });
  return rcpt.status === "success";
}

export const BASE_ID = BASE_CHAIN_ID;
