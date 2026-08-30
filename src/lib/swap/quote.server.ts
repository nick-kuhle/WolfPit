/**
 * Server-side DEX aggregator proxy (0x Swap API v2, Base mainnet).
 *
 * Runs ONLY on the server so the 0x API key (ZEROX_API_KEY — server-only, never
 * VITE_) never reaches the browser. The client calls the `spotQuote` server fn
 * in actions.ts, which delegates here.
 *
 * The aggregator finds the best route across Base DEX liquidity (Uniswap v2/v3,
 * Aerodrome, etc.) — "cheapest/fastest/safest" is delegated to 0x's routing +
 * RFQ layer, and we forward the WolfPit affiliate fee so it is taken ON-CHAIN
 * in the same transaction and paid directly to the WolfPit fee wallet.
 *
 * Endpoints:
 *   price → indicative (no wallet needed, for live pricing as the user types)
 *   quote → firm + executable transaction (requires taker address)
 */

import {
  BASE_CHAIN_ID,
  FEE_RECIPIENT,
  SWAP_FEE_BPS,
  SWAP_FEE_BPS_DISCOUNTED,
  SWAP_SLIPPAGE_BPS,
  WPIT_LIVE,
} from "./config";
import type { QuoteRequest, QuoteResult } from "./types";

const ZEROX_BASE = "https://api.0x.org/swap/permit2";

function apiKey(): string | undefined {
  const k = process.env.ZEROX_API_KEY;
  return k && k.trim() ? k.trim() : undefined;
}

function feeBpsFor(holdsWpit: boolean | undefined): number {
  // The discount can only be earned once WPIT exists on-chain. Until then every
  // wallet pays the full fee, even if the client optimistically flagged it.
  if (WPIT_LIVE && holdsWpit && SWAP_FEE_BPS_DISCOUNTED > 0) return SWAP_FEE_BPS_DISCOUNTED;
  return SWAP_FEE_BPS;
}

type ZeroXIssue = { liquidityAvailable?: boolean };
type ZeroXFee = { amount?: string; token?: string } | null;
type ZeroXResponse = {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  sellAmount?: string;
  minBuyAmount?: string;
  totalNetworkFee?: string;
  gas?: string;
  route?: { fills?: { source?: string }[] };
  fees?: { integratorFee?: ZeroXFee };
  issues?: { allowance?: { spender?: string; actual?: string } | null } & ZeroXIssue;
  transaction?: { to?: string; data?: string; value?: string; gas?: string; gasPrice?: string };
  priceImpact?: string | number;
};

function toResult(
  json: ZeroXResponse,
  feeBps: number,
  holdsWpit: boolean | undefined,
  sellToken: string,
  wantTx: boolean,
): QuoteResult {
  if (json.liquidityAvailable === false) {
    return { ok: false, error: "No liquidity route for this pair/size right now.", noRoute: true };
  }
  const buyAmount = json.buyAmount;
  if (!buyAmount) {
    return { ok: false, error: "Aggregator returned no quote.", noRoute: true };
  }
  const sources = (json.route?.fills ?? [])
    .map((f) => f.source)
    .filter((x): x is string => Boolean(x));
  const uniqueSources = Array.from(new Set(sources));
  const impact =
    json.priceImpact !== undefined && json.priceImpact !== null
      ? Number(json.priceImpact) / 100
      : undefined;

  const tx =
    wantTx && json.transaction?.to && json.transaction?.data
      ? {
          to: json.transaction.to,
          data: json.transaction.data,
          value: json.transaction.value ?? "0",
          gas: json.transaction.gas,
          gasPrice: json.transaction.gasPrice,
        }
      : undefined;

  return {
    ok: true,
    sellAmount: json.sellAmount ?? "0",
    buyAmount,
    minBuyAmount: json.minBuyAmount ?? buyAmount,
    priceImpact: Number.isFinite(impact) ? impact : undefined,
    fee: {
      bps: feeBps,
      discounted: WPIT_LIVE && Boolean(holdsWpit) && feeBps < SWAP_FEE_BPS,
      token: json.fees?.integratorFee?.token ?? sellToken,
      amount: json.fees?.integratorFee?.amount,
    },
    route: { sources: uniqueSources, hops: sources.length },
    tx,
    allowanceTarget: json.issues?.allowance?.spender ?? undefined,
    allowanceAmount: json.issues?.allowance?.actual ?? undefined,
    gas: json.transaction?.gas ?? json.gas,
  };
}

/**
 * Fetch an aggregator quote. When `req.taker` is present we hit /quote (firm,
 * executable). Otherwise /price (indicative, for live pricing while typing).
 */
export async function fetchSpotQuote(req: QuoteRequest): Promise<QuoteResult> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      error: "Spot router not configured (missing ZEROX_API_KEY). Set it to enable live swaps.",
    };
  }
  if (!FEE_RECIPIENT) {
    return {
      ok: false,
      error: "Fee wallet not configured (missing VITE_FEE_RECIPIENT).",
    };
  }
  if (!req.sellAmount || req.sellAmount === "0") {
    return { ok: false, error: "Enter an amount." };
  }

  const wantTx = Boolean(req.taker);
  const feeBps = feeBpsFor(req.holdsWpit);

  const params = new URLSearchParams({
    chainId: String(BASE_CHAIN_ID),
    sellToken: req.sellToken,
    buyToken: req.buyToken,
    sellAmount: req.sellAmount,
    slippageBps: String(req.slippageBps ?? SWAP_SLIPPAGE_BPS),
    // WolfPit on-chain trading fee — paid directly to the WolfPit wallet.
    swapFeeRecipient: FEE_RECIPIENT,
    swapFeeBps: String(feeBps),
    // Charge the fee in the token the user is selling.
    swapFeeToken: req.sellToken,
  });
  if (req.taker) params.set("taker", req.taker);

  const endpoint = wantTx ? "quote" : "price";
  const url = `${ZEROX_BASE}/${endpoint}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "0x-api-key": key, "0x-version": "v2" },
    });
  } catch {
    return { ok: false, error: "Could not reach the aggregator. Try again." };
  }

  let json: ZeroXResponse & { reason?: string; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, error: `Aggregator error (${res.status}).` };
  }

  if (!res.ok) {
    const msg = json.reason || json.message || `Aggregator error (${res.status}).`;
    return { ok: false, error: msg, noRoute: res.status === 400 };
  }

  return toResult(json, feeBps, req.holdsWpit, req.sellToken, wantTx);
}
