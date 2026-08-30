/** Shared types for the spot swap aggregator flow (server ↔ client). */

export type SwapSide = "sell";

export type QuoteRequest = {
  /** Sell token address (0xeee… for native ETH). */
  sellToken: string;
  /** Buy token address. */
  buyToken: string;
  /** Integer amount of the sell token in its own base units (wei / 6dp). */
  sellAmount: string;
  /** Connected wallet, required for an executable quote (tx build). */
  taker?: string;
  /** Slippage tolerance in bps. */
  slippageBps?: number;
  /** True once the wallet's WPIT holding has been verified (applies discount). */
  holdsWpit?: boolean;
};

export type QuoteFee = {
  /** Fee bps actually charged (already discount-adjusted). */
  bps: number;
  /** Whether the WPIT-holder discount was applied. */
  discounted: boolean;
  /** Fee token address (the sell token). */
  token: string;
  /** Fee amount in the fee token's base units, if the aggregator returned it. */
  amount?: string;
};

export type QuoteRoute = {
  /** Human-readable venue names in the chosen route, e.g. ["Uniswap_V3"]. */
  sources: string[];
  hops: number;
};

export type SwapTx = {
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasPrice?: string;
};

export type QuoteResult =
  | {
      ok: true;
      /** Sell amount echoed back (base units). */
      sellAmount: string;
      /** Expected buy amount (base units). */
      buyAmount: string;
      /** Guaranteed minimum buy amount after slippage (base units). */
      minBuyAmount: string;
      /** Price impact fraction (e.g. 0.0031 = 0.31%), if provided. */
      priceImpact?: number;
      fee: QuoteFee;
      route: QuoteRoute;
      /** Executable transaction (present only when `taker` was supplied). */
      tx?: SwapTx;
      /** ERC-20 spender needing approval, if the sell token isn't native. */
      allowanceTarget?: string;
      /** Approval amount required (base units), if any. */
      allowanceAmount?: string;
      /** Estimated total gas (wei), if provided. */
      gas?: string;
    }
  | {
      ok: false;
      error: string;
      /** true when the failure is "no liquidity route", not a config/key error. */
      noRoute?: boolean;
    };
