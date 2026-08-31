/**
 * Client-side on-chain primitives for real spot swaps (multi-chain, viem).
 *
 * Reads (balances, allowance) use per-chain public clients; writes (approve,
 * swap) go through the user's injected wallet (EIP-1193) managed by
 * src/lib/wallet/session.ts — one wallet session across the whole app.
 * Chain catalog + clients live in ./chains.ts.
 */

import { erc20Abi, formatUnits, parseUnits, type Hex } from "viem";
import type { EthProvider } from "@/lib/wallet/session";
import { chainById, ensureChain, isNative, publicClientFor, walletClientFor } from "./chains";

export function toBaseUnits(amount: string, decimals: number): bigint {
  return parseUnits(amount as `${number}`, decimals);
}

export function fromBaseUnits(amount: bigint | string, decimals: number): string {
  return formatUnits(typeof amount === "bigint" ? amount : BigInt(amount), decimals);
}

/** Native or ERC-20 balance for a token address on a chain (base units). */
export async function tokenBalance(chainId: number, address: string, owner: string): Promise<bigint> {
  const pc = publicClientFor(chainId);
  if (!pc) throw new Error("Unsupported chain.");
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

/** ERC-20 allowance (0 for native assets). */
export async function tokenAllowance(
  chainId: number,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  if (isNative(token)) return 0n;
  const pc = publicClientFor(chainId);
  if (!pc) throw new Error("Unsupported chain.");
  return pc.readContract({
    address: token as Hex,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner as Hex, spender as Hex],
  });
}

/** Send an ERC-20 approve; switches/adds the chain in the wallet if needed. */
export async function approveToken(
  provider: EthProvider,
  account: string,
  chainId: number,
  token: string,
  spender: string,
  amount: bigint,
): Promise<Hex> {
  if (!(await ensureChain(provider, chainId))) throw new Error(`Switch your wallet to this network.`);
  const wc = walletClientFor(provider, account, chainId);
  if (!wc) throw new Error("Unsupported chain.");
  return wc.writeContract({
    chain: chainById(chainId)?.viem,
    address: token as Hex,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as Hex, amount],
    account: account as Hex,
  });
}

/** Send the aggregator swap transaction on a chain. */
export async function sendSwapTx(
  provider: EthProvider,
  account: string,
  chainId: number,
  tx: { to: string; data: string; value: string; gas?: string },
): Promise<Hex> {
  if (!(await ensureChain(provider, chainId))) throw new Error(`Switch your wallet to this network.`);
  const wc = walletClientFor(provider, account, chainId);
  if (!wc) throw new Error("Unsupported chain.");
  return wc.sendTransaction({
    chain: chainById(chainId)?.viem,
    to: tx.to as Hex,
    data: tx.data as Hex,
    value: BigInt(tx.value || "0"),
    gas: tx.gas ? BigInt(tx.gas) : undefined,
    account: account as Hex,
  });
}

/** Wait for a receipt on a chain; returns true on success. */
export async function waitForReceipt(chainId: number, hash: Hex): Promise<boolean> {
  const pc = publicClientFor(chainId);
  if (!pc) throw new Error("Unsupported chain.");
  const rcpt = await pc.waitForTransactionReceipt({ hash });
  return rcpt.status === "success";
}
