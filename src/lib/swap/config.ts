/**
 * Spot swap configuration — real on-chain trading on Base.
 *
 * This module is the single source of truth for the launch spot desk:
 *   • which chain / tokens the router works against,
 *   • the WolfPit trading fee (transparently shown to the customer),
 *   • the 50% WPIT-holder discount (dormant until WPIT ships).
 *
 * Launch shape (see docs/DEPLOY-BASE.md, src/lib/wolfpit/features.ts):
 * NO house liquidity pool. Spot fills route through a DEX aggregator (0x Swap
 * API v2) against external Base liquidity, so we get best-execution routing
 * (cheapest/fastest/safest) without seeding a pool. Futures & options stay
 * launch-gated until the WETH/USDC pit pool exists.
 *
 * Every VITE_ value below is read at build time and is safe to expose in the
 * browser bundle (public addresses / bps only). The 0x API key is server-only
 * (ZEROX_API_KEY) and NEVER prefixed VITE_ — see src/lib/swap/quote.server.ts.
 */

export const BASE_CHAIN_ID = 8453;

/** Canonical Base token addresses (public; verify against docs at deploy). */
export const BASE_TOKENS = {
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

type ViteEnv = { env?: Record<string, string | undefined> };

function envVar(key: string): string | undefined {
  try {
    const v = (import.meta as ViteEnv).env?.[key];
    return v && String(v).trim() ? String(v).trim() : undefined;
  } catch {
    return undefined; // SSR / non-Vite context
  }
}

function isEvmAddress(v?: string): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

function numEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = envVar(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * WolfPit trading fee, in basis points, taken ON-CHAIN by the aggregator and
 * sent directly to the WolfPit fee wallet (0x `swapFeeRecipient`). Default 50
 * bps (0.50%). Override with VITE_SWAP_FEE_BPS.
 */
export const SWAP_FEE_BPS = Math.round(numEnv("VITE_SWAP_FEE_BPS", 50, 0, 1000));

/**
 * The WPIT-holder discount: the fee is cut by this fraction (0.5 = 50% off) for
 * any wallet that holds WPIT. Default 0.5. Override with VITE_SWAP_FEE_DISCOUNT.
 */
export const SWAP_FEE_DISCOUNT = numEnv("VITE_SWAP_FEE_DISCOUNT", 0.5, 0, 1);

/** Discounted fee in bps, rounded to the nearest integer bps (0x takes ints). */
export const SWAP_FEE_BPS_DISCOUNTED = Math.round(SWAP_FEE_BPS * (1 - SWAP_FEE_DISCOUNT));

/** Default slippage tolerance (bps) applied to aggregator quotes. */
export const SWAP_SLIPPAGE_BPS = Math.round(numEnv("VITE_SWAP_SLIPPAGE_BPS", 50, 1, 500));

/** WolfPit wallet that receives the on-chain trading fee ("directly to WolfPit"). */
export const FEE_RECIPIENT = envVar("VITE_FEE_RECIPIENT");

/**
 * WPIT token address. Undefined until WPIT ships — while undefined, the discount
 * cannot be earned (no token to hold), so every wallet pays the full fee. The
 * discount logic is live from day one and activates automatically the moment
 * VITE_WPIT is set to a real address.
 */
export const WPIT_TOKEN = envVar("VITE_WPIT");

/** True when a WolfPit fee wallet is configured (fees can actually be taken). */
export const FEE_ENABLED = isEvmAddress(FEE_RECIPIENT);

/** True when WPIT exists on-chain, so the holder discount can be earned. */
export const WPIT_LIVE = isEvmAddress(WPIT_TOKEN);

/**
 * Resolve the applicable fee for a wallet.
 * @param holdsWpit whether the connected wallet currently holds any WPIT.
 */
/** Whether a non-zero discount is even configured. */
export const DISCOUNT_CONFIGURED = SWAP_FEE_DISCOUNT > 0 && SWAP_FEE_BPS_DISCOUNTED < SWAP_FEE_BPS;

export function feeFor(holdsWpit: boolean): {
  bps: number;
  discounted: boolean;
  fullBps: number;
  discountBps: number;
} {
  const discounted = WPIT_LIVE && holdsWpit && DISCOUNT_CONFIGURED;
  return {
    bps: discounted ? SWAP_FEE_BPS_DISCOUNTED : SWAP_FEE_BPS,
    discounted,
    fullBps: SWAP_FEE_BPS,
    discountBps: SWAP_FEE_BPS_DISCOUNTED,
  };
}

/** bps → percent string, e.g. 50 → "0.50%". */
export function bpsToPct(bps: number, dp = 2): string {
  return `${(bps / 100).toFixed(dp)}%`;
}

export type SpotToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** true for the chain-native asset (ETH/BNB/POL/…), which needs no approval. */
  native?: boolean;
};

/**
 * Quick-pick tokens on Base (the default chain). Every other token on every
 * supported chain is reachable via search / pasting a contract address — see
 * token-search.ts and the token picker in swap-card.tsx.
 */
export const SPOT_TOKENS: SpotToken[] = [
  { symbol: "ETH", name: "Ether", address: BASE_TOKENS.ETH, decimals: 18, native: true },
  { symbol: "WETH", name: "Wrapped Ether", address: BASE_TOKENS.WETH, decimals: 18 },
  { symbol: "USDC", name: "USD Coin", address: BASE_TOKENS.USDC, decimals: 6 },
];

export function tokenBySymbol(sym: string): SpotToken | undefined {
  return SPOT_TOKENS.find((t) => t.symbol === sym.toUpperCase());
}

/** Slippage-tolerance presets shown in the UI (bps). */
export const SLIPPAGE_PRESETS = [10, 30, 50, 100] as const;
