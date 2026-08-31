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
  WPIT_TOKEN,
} from "./config";
import { DEFAULT_CHAIN_ID, chainById, publicClientFor } from "./chains";
import type { QuoteRequest, QuoteResult } from "./types";
import { erc20Abi, type Hex } from "viem";

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

/**
 * Server-side WPIT holding check for FIRM quotes. The client's `holdsWpit` flag
 * is a display hint only — never trusted for pricing: anyone could POST the
 * server fn with holdsWpit=true to grab the discount without holding WPIT.
 * When WPIT is live and a taker is present, we read balanceOf on-chain and use
 * that. On any RPC failure we fail conservative (no discount).
 */
async function verifyHoldsWpit(chainId: number, taker: string): Promise<boolean> {
  // WPIT exists on Base only — on any other chain the discount cannot apply.
  if (chainId !== BASE_CHAIN_ID) return false;
  if (!WPIT_TOKEN || !/^0x[0-9a-fA-F]{40}$/.test(WPIT_TOKEN)) return false;
  const client = publicClientFor(chainId);
  if (!client) return false;
  try {
    const bal = (await client.readContract({
      address: WPIT_TOKEN as Hex,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [taker as Hex],
    })) as bigint;
    return bal > 0n;
  } catch {
    return false;
  }
}

type ZeroXIssue = { liquidityAvailable?: boolean };
type ZeroXFee = { amount?: string; token?: string } | null;
type ZeroXResponse = {
  liquidityAvailable?: boolean;
  quoteId?: string;
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
  chainId: number,
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
    chainId,
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
    gasFee: json.totalNetworkFee,
    quoteId: json.quoteId,
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

  const chainId = req.chainId ?? DEFAULT_CHAIN_ID;
  const chain = chainById(chainId);
  if (!chain) {
    return { ok: false, error: `Unsupported chain (${chainId}).` };
  }

  const wantTx = Boolean(req.taker);

  // Firm quotes price the fee from the SERVER-VERIFIED WPIT balance, not the
  // client's claim. (Indicative /price quotes keep the hint — nothing executes
  // on them, and the firm quote shows the real fee before signing.)
  let holdsWpit = Boolean(req.holdsWpit) && chainId === BASE_CHAIN_ID;
  if (wantTx && WPIT_LIVE && req.taker) {
    holdsWpit = await verifyHoldsWpit(chainId, req.taker);
  }
  const feeBps = feeBpsFor(holdsWpit);

  const params = new URLSearchParams({
    chainId: String(chainId),
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

  return toResult(json, feeBps, holdsWpit, req.sellToken, wantTx, chainId);
}
