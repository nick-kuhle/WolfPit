import { encodeFunctionData, isAddress, parseUnits, type Hex } from "viem";

/**
 * Dev-wallet controls for the testnet desk: mint test tokens, top up a pool,
 * set the manual oracle price.
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * 1. The server never holds a key. Every action here is *calldata only* — a
 *    `{to, data}` pair the operator's own wallet signs in their browser. The
 *    app cannot move funds on anyone's behalf, so there is no hot key to steal
 *    and no server compromise that becomes a mint. `docs/DEV.md` requires this.
 *
 * 2. These controls do not exist on mainnet. Not disabled — ABSENT. See
 *    `devControlsAvailable`: on chain 8453 the builders refuse and the UI never
 *    renders. A "mint" button that is merely greyed out on mainnet is one bad
 *    conditional away from being a real one.
 *
 * Everything below is pure: given inputs, produce calldata. That makes the
 * dangerous part (which function, which decimals, which cap) unit-testable
 * without a chain, a wallet, or a signature.
 */

export const BASE_SEPOLIA = 84532;
export const BASE_MAINNET = 8453;

/** Chains where dev controls may appear. Mainnet is deliberately absent. */
/** @public — intentional API surface (chain list + ceilings, read by tests and wiring). */
export const DEV_CONTROL_CHAINS: readonly number[] = [BASE_SEPOLIA, 31337] as const;

export function devControlsAvailable(chainId: number | null | undefined): boolean {
  return typeof chainId === "number" && DEV_CONTROL_CHAINS.includes(chainId);
}

/** @public — intentional API surface (calldata the operator's wallet signs). */
export type Call = { to: Hex; data: Hex; label: string };

export type BuildResult = { ok: true; call: Call } | { ok: false; error: string };

/** Minimal ABIs — only the functions these controls are allowed to reach. */
const MINT_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amt", type: "uint256" }], outputs: [] },
] as const;

const APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const ADD_ABI = [
  { type: "function", name: "add", stateMutability: "nonpayable", inputs: [{ name: "a0", type: "uint256" }, { name: "a1", type: "uint256" }, { name: "minShares", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const SET_PRICE_ABI = [
  { type: "function", name: "setPrice", stateMutability: "nonpayable", inputs: [{ name: "p", type: "uint256" }], outputs: [] },
] as const;

/**
 * Sanity ceilings. These are test tokens, but a fat-fingered 1e30 mint makes
 * the pools useless and the bug report worthless, so the amount a human types
 * is bounded before it becomes calldata.
 */
/** @public — intentional API surface (chain list + ceilings, read by tests and wiring). */
export const MAX_MINT = 100_000_000;
/** USDC per ETH. Outside this the oracle is not being tested, it is being broken. */
/** @public — intentional API surface (chain list + ceilings, read by tests and wiring). */
export const MIN_PRICE = 1;
/** @public — intentional API surface (chain list + ceilings, read by tests and wiring). */
export const MAX_PRICE = 1_000_000;

function guard(chainId: number | null | undefined, ...addrs: (string | undefined)[]): string | null {
  if (!devControlsAvailable(chainId)) {
    return chainId === BASE_MAINNET
      ? "Dev controls do not exist on Base mainnet."
      : "Dev controls are only available on Base Sepolia.";
  }
  for (const a of addrs) {
    if (!a || !isAddress(a)) return "Contract address is not configured for this network.";
  }
  return null;
}

/** Parse a human amount, rejecting anything that is not a sane positive number. */
export function parseAmount(raw: string, decimals: number, max = MAX_MINT): { ok: true; value: bigint } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter an amount." };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, error: "Amount must be a plain positive number." };
  const asNum = Number(trimmed);
  if (!Number.isFinite(asNum) || asNum <= 0) return { ok: false, error: "Amount must be greater than zero." };
  if (asNum > max) return { ok: false, error: `Amount above the ${max.toLocaleString("en-US")} safety cap.` };
  const frac = trimmed.split(".")[1] ?? "";
  if (frac.length > decimals) return { ok: false, error: `This token has ${decimals} decimals.` };
  return { ok: true, value: parseUnits(trimmed, decimals) };
}

/** Mint test tokens to an address. TestERC20/WPIT only, testnet only. */
export function buildMint(args: {
  chainId: number | null;
  token: string | undefined;
  to: string | undefined;
  amount: string;
  decimals: number;
  symbol: string;
}): BuildResult {
  const g = guard(args.chainId, args.token, args.to);
  if (g) return { ok: false, error: g };
  const amt = parseAmount(args.amount, args.decimals);
  if (!amt.ok) return { ok: false, error: amt.error };
  return {
    ok: true,
    call: {
      to: args.token as Hex,
      data: encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [args.to as Hex, amt.value] }),
      label: `Mint ${args.amount} ${args.symbol}`,
    },
  };
}

/** Approve a pool to pull one leg. Bounded to the exact amount, never max. */
export function buildApprove(args: {
  chainId: number | null;
  token: string | undefined;
  spender: string | undefined;
  amount: string;
  decimals: number;
  symbol: string;
}): BuildResult {
  const g = guard(args.chainId, args.token, args.spender);
  if (g) return { ok: false, error: g };
  const amt = parseAmount(args.amount, args.decimals);
  if (!amt.ok) return { ok: false, error: amt.error };
  return {
    ok: true,
    call: {
      to: args.token as Hex,
      // Exact-amount allowance. WP-05 / #12 banned unbounded approvals on the
      // vault; the same discipline applies to a control that a human clicks.
      data: encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [args.spender as Hex, amt.value] }),
      label: `Approve ${args.amount} ${args.symbol}`,
    },
  };
}

/**
 * Add liquidity to a SimplePair.
 *
 * `minShares` is 0 only because the operator is the sole LP on a testnet pool
 * they just funded; the DEADLINE is real (`nowSec + ttlSec`), because a pending
 * top-up that lands an hour later lands at a price nobody agreed to.
 */
export function buildPoolAdd(args: {
  chainId: number | null;
  pool: string | undefined;
  amount0: string;
  amount1: string;
  decimals0: number;
  decimals1: number;
  nowSec: number;
  ttlSec?: number;
}): BuildResult {
  const g = guard(args.chainId, args.pool);
  if (g) return { ok: false, error: g };
  const a0 = parseAmount(args.amount0, args.decimals0);
  if (!a0.ok) return { ok: false, error: a0.error };
  const a1 = parseAmount(args.amount1, args.decimals1);
  if (!a1.ok) return { ok: false, error: a1.error };
  const ttl = args.ttlSec ?? 900;
  const deadline = BigInt(Math.floor(args.nowSec) + ttl);
  return {
    ok: true,
    call: {
      to: args.pool as Hex,
      data: encodeFunctionData({ abi: ADD_ABI, functionName: "add", args: [a0.value, a1.value, 0n, deadline] }),
      label: `Add ${args.amount0} / ${args.amount1} to pool`,
    },
  };
}

/** Set the testnet ManualOracle price, in USDC per ETH (6 dp). */
export function buildSetPrice(args: { chainId: number | null; oracle: string | undefined; usdPerEth: string }): BuildResult {
  const g = guard(args.chainId, args.oracle);
  if (g) return { ok: false, error: g };
  const parsed = parseAmount(args.usdPerEth, 6, MAX_PRICE);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (Number(args.usdPerEth) < MIN_PRICE) return { ok: false, error: `Price below the ${MIN_PRICE} USDC floor.` };
  return {
    ok: true,
    call: {
      to: args.oracle as Hex,
      data: encodeFunctionData({ abi: SET_PRICE_ABI, functionName: "setPrice", args: [parsed.value] }),
      label: `Set oracle to ${args.usdPerEth} USDC/ETH`,
    },
  };
}
