/** Shared types for the spot swap aggregator flow (server ↔ client). */


export type QuoteRequest = {
  /** Chain to trade on (see SWAP_CHAINS in chains.ts; default Base 8453). */
  chainId?: number;
  /** Sell token address (0xeee… for the native asset). */
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

type QuoteFee = {
  /** Fee bps actually charged (already discount-adjusted). */
  bps: number;
  /** Whether the WPIT-holder discount was applied. */
  discounted: boolean;
  /** Fee token address (the sell token). */
  token: string;
  /** Fee amount in the fee token's base units, if the aggregator returned it. */
  amount?: string;
};

type QuoteRoute = {
  /** Human-readable venue names in the chosen route, e.g. ["Uniswap_V3"]. */
  sources: string[];
  hops: number;
};

type SwapTx = {
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasPrice?: string;
};

export type QuoteResult =
    | {
      ok: true;
      /** Chain the quote is valid on. */
      chainId: number;
      /** Sell amount echoed back (base units). */
      sellAmount: string;
      /** Expected buy amount (base units). */
      buyAmount: string;
      /** Guaranteed minimum buy amount after slippage (base units). */
      minBuyAmount: string;
      /**
       * Price impact in PERCENT (e.g. 0.42 = 0.42%), if provided. 0x v2's
       * `priceImpact` is a percentage number; invalid values above 100 are
       * omitted rather than displayed with a guessed unit.
       */
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
      /** Estimated total network fee in native wei (gas × gas price), if provided. */
      gasFee?: string;
      /** Firm-quote quoteId (echoed back on /price re-check), if provided. */
      quoteId?: string;
      /** 0x buy/sell/transfer tax detection (bps) for the traded tokens, if provided. */
      sellTaxBps?: number;
      buyTaxBps?: number;
      transferTaxBps?: number;
      /**
       * The spender inside the Permit2 EIP-712 payload, when the quote uses
       * Permit2. Safety cross-check: must equal `tx.to` (review fix F4).
       */
      permit2Spender?: string;
    }
  | {
      ok: false;
      error: string;
      /** true when the failure is "no liquidity route", not a config/key error. */
      noRoute?: boolean;
    };

/** A token found via search (tokens API or address resolution). */
export type FoundToken = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  native?: boolean;
  /** false for community hits (DexScreener/CoinGecko fallback) — UI warns. */
  verified?: boolean;
};

export type TokenSearchResult =
  | { ok: true; tokens: FoundToken[]; source: "aggregator" | "dexscreener" | "coingecko" | "fallback" }
  | { ok: false; error: string };
