/**
 * Client-side on-chain primitives for real spot swaps (multi-chain, viem).
 *
 * Reads (balances, allowance) use per-chain public clients; writes (approve,
 * swap) go through the user's injected wallet (EIP-1193) managed by
 * src/lib/wallet/session.ts — one wallet session across the whole app.
 * Chain catalog + clients live in ./chains.ts.
 */

import { erc20Abi, formatUnits, parseUnits, type Hex, type PublicClient } from "viem";
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

/**
 * Wait for a receipt on a chain. Bounded (review fix F11): a stuck or
 * extremely slow tx must not leave the UI in "settling…" forever.
 * Returns "success" | "reverted" | "timeout".
 */
export async function waitForReceipt(
  chainId: number,
  hash: Hex,
  timeoutMs = 120_000,
): Promise<"success" | "reverted" | "timeout"> {
  const pc = publicClientFor(chainId);
  if (!pc) throw new Error("Unsupported chain.");
  try {
    const rcpt = await pc.waitForTransactionReceipt({ hash, timeout: timeoutMs });
    return rcpt.status === "success" ? "success" : "reverted";
  } catch {
    return "timeout";
  }
}

// ─────────────────────────── Swap safety (review fix F4) ────────────────────
// The aggregator's response is the ONLY source of the tx the user signs and
// the spender the user approves. Trusting the 0x API is the industry norm,
// but a compromised API key or a poisoned response would otherwise be able to
// point the approval and/or the transaction anywhere. These checks pin the
// two fund-moving decisions to known contracts and sanity-check the rest:
//
//   • Approval spender — must be 0x Permit2 or AllowanceHolder (the ONLY
//     contracts 0x itself permits for allowances; NEVER the Settler). Both
//     addresses are static and universal per hardfork generation.
//   • tx.to — must be a deployed contract (never an EOA / missing address)
//     and, for Permit2 quotes, must equal the spender inside the Permit2
//     EIP-712 payload (`permit2.message.spender`).
//   • value — native sells must carry the sell amount; token sells must carry 0.
//
// Residual risk (documented): the Settler address itself changes per 0x
// deployment, so tx.to cannot be pinned to a static allowlist — the
// permit2-spender cross-check above is the binding constraint for Permit2
// quotes (the user's signature authorizes exactly that spender).

/** 0x Permit2 — universal across all EVM chains. */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
/** 0x AllowanceHolder — Cancun hardfork chains (per 0x cheat sheet). */
export const ALLOWANCE_HOLDER_CANCUN = "0x0000000000001fF3684f28c67538d4D072C22734";
/** 0x AllowanceHolder — Shanghai hardfork chains (Mantle). */
export const ALLOWANCE_HOLDER_SHANGHAI = "0x0000000000005E88410CcDFaDe4a5EfaE4b49562";

/** Chains on the Cancun AllowanceHolder deployment (0x cheat sheet). */
const CANCUN_CHAINS = new Set([1, 42161, 43114, 8453, 80094, 56, 59144, 10, 137, 534352, 130]);
/** Chains on the Shanghai AllowanceHolder deployment (0x cheat sheet). */
const SHANGHAI_CHAINS = new Set([5000]);

/** The only spender contracts this app will approve, per chain. */
export function allowedApprovalSpenders(chainId: number): string[] {
  const out = [PERMIT2_ADDRESS];
  if (CANCUN_CHAINS.has(chainId)) out.push(ALLOWANCE_HOLDER_CANCUN);
  if (SHANGHAI_CHAINS.has(chainId)) out.push(ALLOWANCE_HOLDER_SHANGHAI);
  return out;
}

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isHexData(v: unknown): v is string {
  return typeof v === "string" && /^0x([0-9a-fA-F]{2})+$/.test(v);
}

/**
 * Verify a quote's executable transaction + approval target before the user
 * signs. Throws with a user-facing message on any violation.
 *
 * @param opts.sellNative  whether the sell token is the chain native asset
 * @param opts.sellAmount  sell amount in base units (for native value sanity)
 */
export async function assertSafeSwapTarget(
  chainId: number,
  tx: { to: string; data: string; value: string },
  opts: {
    sellNative: boolean;
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    allowanceTarget?: string;
    permit2Spender?: string;
  },
  /** injectable for tests — defaults to the chain's public client */
  pc?: PublicClient,
): Promise<void> {
  const client = pc ?? publicClientFor(chainId);
  if (!client) throw new Error("Unsupported chain.");

  // 1. Approval spender must be Permit2 / AllowanceHolder.
  if (!opts.sellNative && opts.allowanceTarget) {
    const spender = opts.allowanceTarget.toLowerCase();
    const ok = allowedApprovalSpenders(chainId).some((a) => a.toLowerCase() === spender);
    if (!ok) {
      throw new Error(
        "Safety check: the aggregator asked for an approval to an unknown contract. Swap blocked.",
      );
    }
  }

  // 2. tx.to must be a deployed contract (never an EOA / nonexistent address).
  if (!tx.to || !/^0x[0-9a-fA-F]{40}$/.test(tx.to)) {
    throw new Error("Safety check: swap target is not a valid contract address. Swap blocked.");
  }
  const code = await client.getCode({ address: tx.to as Hex });
  if (!code || code === "0x") {
    throw new Error("Safety check: swap target is not a deployed contract. Swap blocked.");
  }

  // 3. Permit2 quotes: the spender inside the EIP-712 permit must BE tx.to —
  //    the user's signature authorizes exactly that contract to move funds.
  if (opts.permit2Spender && !sameAddr(opts.permit2Spender, tx.to)) {
    throw new Error("Safety check: swap target does not match the signed permit. Swap blocked.");
  }

  // 4. Value sanity: a native sell must carry EXACTLY the sell amount (that
  //    is what the user approved in the quote); token sells must carry 0.
  const value = BigInt(tx.value || "0");
  const sellAmount = BigInt(opts.sellAmount || "0");
  if (opts.sellNative) {
    if (value !== sellAmount) {
      throw new Error("Safety check: unexpected ETH value on the swap transaction. Swap blocked.");
    }
  } else if (value !== 0n) {
    throw new Error("Safety check: token swap unexpectedly carries ETH value. Swap blocked.");
  }

  // 5. Calldata must be non-empty (a bare value transfer would not be a swap).
  if (!isHexData(tx.data)) {
    throw new Error("Safety check: swap transaction carries no calldata. Swap blocked.");
  }
}
