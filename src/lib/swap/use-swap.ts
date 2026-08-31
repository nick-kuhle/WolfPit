/**
 * useSwap — orchestrates the real on-chain multi-chain spot flow:
 *   pick chain → pick/search tokens → debounced indicative quote →
 *   firm quote → (approve) → swap → receipt.
 *
 * Wallet session comes from src/lib/wallet/session.ts (shared across the app).
 * Quotes + token search come from server fns (aggregator proxy, key stays
 * server-side). Chain reads/writes use viem against the injected provider.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { spotQuote } from "./actions";
import { BASE_CHAIN_ID, SWAP_SLIPPAGE_BPS, WPIT_TOKEN, feeFor, type SpotToken } from "./config";
import { DEFAULT_CHAIN_ID, chainById, ensureChain, nativeTokenOf } from "./chains";
import type { QuoteResult } from "./types";
import {
  approveToken,
  fromBaseUnits,
  sendSwapTx,
  toBaseUnits,
  tokenAllowance,
  tokenBalance,
  waitForReceipt,
} from "./chain";
import { useWallet, getProvider } from "@/lib/wallet/session";
import { ping } from "@/lib/wolfpit/alerts";

export type SwapPhase =
  | "idle"
  | "quoting"
  | "quoted"
  | "needs-approval"
  | "approving"
  | "swapping"
  | "confirming"
  | "done"
  | "error";

export type SwapState = {
  chainId: number;
  sell: SpotToken;
  buy: SpotToken;
  amount: string;
  quote: QuoteResult | null;
  phase: SwapPhase;
  error: string | null;
  txHash: string | null;
  sellBalance: bigint | null;
  buyBalance: bigint | null;
  holdsWpit: boolean;
};

const MAX_UINT =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/** Compact human amount for ticket copy, e.g. "1.5" / "1,584.2". */
function shortAmt(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function baseQuickPicks(chainId: number): { sell: SpotToken; buy: SpotToken } {
  if (chainId === DEFAULT_CHAIN_ID) {
    return {
      sell: { symbol: "ETH", name: "Ether", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, native: true },
      buy: { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    };
  }
  const native = nativeTokenOf(chainId);
  if (native) return { sell: { ...native }, buy: { ...native } };
  return {
    sell: { symbol: "ETH", name: "Ether", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, native: true },
    buy: { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  };
}

export function useSwap() {
  const wallet = useWallet();
  const [chainId, setChainId] = useState<number>(DEFAULT_CHAIN_ID);
  const [pair, setPair] = useState(() => baseQuickPicks(DEFAULT_CHAIN_ID));
  const { sell, buy } = pair;
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sellBalance, setSellBalance] = useState<bigint | null>(null);
  const [buyBalance, setBuyBalance] = useState<bigint | null>(null);
  const [holds, setHolds] = useState(false);
  const [slippageBps, setSlippageBps] = useState<number>(SWAP_SLIPPAGE_BPS);
  const quoteSeq = useRef(0);

  const onRightChain = wallet.chainId === chainId;

  // Balances + WPIT holding whenever wallet / chain / pair changes.
  const refreshBalances = useCallback(async () => {
    const owner = wallet.address;
    if (!owner) {
      setSellBalance(null);
      setBuyBalance(null);
      setHolds(false);
      return;
    }
    try {
      const [sb, bb] = await Promise.all([
        tokenBalance(chainId, sell.address, owner),
        tokenBalance(chainId, buy.address, owner),
      ]);
      setSellBalance(sb);
      setBuyBalance(bb);
      // WPIT exists on Base only — skip the read anywhere else.
      setHolds(chainId === BASE_CHAIN_ID ? await readHoldsWpit(owner) : false);
    } catch {
      // Read failures leave balances unknown; the UI degrades gracefully.
    }
  }, [wallet.address, chainId, sell.address, buy.address]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  /** Switch the active chain; resets to that chain's sensible default pair. */
  const chooseChain = useCallback((next: number) => {
    setChainId(next);
    setPair(baseQuickPicks(next));
    setAmount("");
    setQuote(null);
    setPhase("idle");
    setError(null);
    setTxHash(null);
  }, []);

  function setSellToken(t: SpotToken) {
    if (t.address.toLowerCase() === buy.address.toLowerCase()) {
      flip();
      return;
    }
    setPair((p) => ({ ...p, sell: t }));
    setQuote(null);
    setPhase("idle");
  }

  function setBuyToken(t: SpotToken) {
    if (t.address.toLowerCase() === sell.address.toLowerCase()) {
      flip();
      return;
    }
    setPair((p) => ({ ...p, buy: t }));
    setQuote(null);
    setPhase("idle");
  }

  function flip() {
    setPair({ sell: buy, buy: sell });
    setAmount("");
    setQuote(null);
    setPhase("idle");
  }

  function reset() {
    setAmount("");
    setQuote(null);
    setPhase("idle");
    setError(null);
    setTxHash(null);
  }

  // Debounced indicative quote as the user types / pair or knobs change.
  useEffect(() => {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) {
      setQuote(null);
      setPhase("idle");
      setError(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setPhase("quoting");
    setError(null);
    const t = window.setTimeout(async () => {
      try {
        const sellAmount = toBaseUnits(amount, sell.decimals).toString();
        const res = await spotQuote({
          data: {
            chainId,
            sellToken: sell.address,
            buyToken: buy.address,
            sellAmount,
            slippageBps,
            holdsWpit: holds,
          },
        });
        if (seq !== quoteSeq.current) return; // stale
        setQuote(res);
        setPhase(res.ok ? "quoted" : "error");
        if (!res.ok) setError(res.error);
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setPhase("error");
        setError(e instanceof Error ? e.message : "Quote failed.");
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [amount, chainId, sell.address, sell.decimals, buy.address, buy.decimals, slippageBps, holds]);

  /** Execute: firm quote → ensure chain → approve if needed → swap → confirm. */
  const execute = useCallback(async () => {
    const owner = wallet.address;
    const provider = getProvider();
    if (!owner || !provider) {
      setError("Connect a wallet first.");
      setPhase("error");
      return;
    }
    setError(null);
    try {
      if (!onRightChain) {
        const ok = await ensureChain(provider, chainId);
        if (!ok) {
          setError(`Switch your wallet to ${chainById(chainId)?.label ?? "the selected chain"} to trade.`);
          setPhase("error");
          return;
        }
      }

      setPhase("swapping");
      const sellAmount = toBaseUnits(amount, sell.decimals).toString();
      const firm = await spotQuote({
        data: {
          chainId,
          sellToken: sell.address,
          buyToken: buy.address,
          sellAmount,
          taker: owner,
          slippageBps,
          holdsWpit: holds,
        },
      });
      setQuote(firm);
      if (!firm.ok) {
        setError(firm.error);
        setPhase("error");
        return;
      }
      if (!firm.tx) {
        setError("Aggregator returned no executable transaction.");
        setPhase("error");
        return;
      }

      // ERC-20 approval (native assets need none).
      if (!sell.native && firm.allowanceTarget) {
        const need = BigInt(firm.allowanceAmount ?? sellAmount);
        const current = await tokenAllowance(chainId, sell.address, owner, firm.allowanceTarget);
        if (current < need) {
          setPhase("approving");
          const ah = await approveToken(provider, owner, chainId, sell.address, firm.allowanceTarget, BigInt(MAX_UINT));
          await waitForReceipt(chainId, ah);
        }
      }

      setPhase("swapping");
      const hash = await sendSwapTx(provider, owner, chainId, firm.tx);
      setTxHash(hash);
      setPhase("confirming");
      ping("Swap sent · settling on-chain", "brass");
      const ok = await waitForReceipt(chainId, hash);
      if (!ok) {
        setError("Transaction reverted on-chain.");
        setPhase("error");
        return;
      }
      setPhase("done");
      // Uniform success notification: confetti pit-ticket, same as every fill.
      ping(
        `Swap settled · ${shortAmt(fromBaseUnits(sellAmount, sell.decimals))} ${sell.symbol} → ${shortAmt(fromBaseUnits(firm.buyAmount, buy.decimals))} ${buy.symbol}`,
        "up",
        true,
        "Fill",
      );
      void refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Swap failed.";
      // Common wallet rejection.
      setError(/reject|denied|user rejected/i.test(msg) ? "You rejected the transaction." : msg);
      setPhase("error");
    }
  }, [wallet.address, onRightChain, chainId, amount, sell, buy, slippageBps, holds, refreshBalances]);

  const fee = feeFor(holds && chainId === BASE_CHAIN_ID);

  return {
    state: {
      chainId,
      sell,
      buy,
      amount,
      quote,
      phase,
      error,
      txHash,
      sellBalance,
      buyBalance,
      holdsWpit: holds,
    } as SwapState,
    fee,
    slippageBps,
    setSlippageBps,
    onRightChain,
    chooseChain,
    setSell: setSellToken,
    setBuy: setBuyToken,
    setAmount,
    flip,
    reset,
    execute,
    fmtBal: (bal: bigint | null, t: SpotToken) => (bal === null ? "—" : fromBaseUnits(bal, t.decimals)),
  };
}

/** True when the wallet holds WPIT (Base-only read; catches throw → false). */
async function readHoldsWpit(owner: string): Promise<boolean> {
  if (!WPIT_TOKEN || !/^0x[0-9a-fA-F]{40}$/.test(WPIT_TOKEN)) return false;
  try {
    const bal = await tokenBalance(BASE_CHAIN_ID, WPIT_TOKEN, owner);
    return bal > 0n;
  } catch {
    return false;
  }
}
