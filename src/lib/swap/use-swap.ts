/**
 * useSwap — orchestrates the real on-chain spot flow:
 *   type amount → debounced indicative quote → firm quote → (approve) → swap.
 *
 * Wallet session comes from src/lib/wallet/session.ts (shared across the app).
 * Quotes come from the server fn (0x proxy). Chain reads/writes use viem
 * against the injected provider.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { spotQuote } from "./actions";
import {
  SWAP_SLIPPAGE_BPS,
  feeFor,
  tokenBySymbol,
  type SpotToken,
} from "./config";
import type { QuoteResult } from "./types";
import {
  approveToken,
  fromBaseUnits,
  holdsWpit as readHoldsWpit,
  sendSwapTx,
  toBaseUnits,
  tokenAllowance,
  tokenBalance,
  waitForReceipt,
} from "./chain";
import { useWallet, getProvider, switchToBase } from "@/lib/wallet/session";
import { ping } from "@/lib/wolfpit/alerts";
import { BASE_CHAIN_ID } from "./config";

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

export function useSwap(initialSell = "ETH", initialBuy = "USDC") {
  const wallet = useWallet();
  const [sell, setSell] = useState<SpotToken>(() => tokenBySymbol(initialSell)!);
  const [buy, setBuy] = useState<SpotToken>(() => tokenBySymbol(initialBuy)!);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sellBalance, setSellBalance] = useState<bigint | null>(null);
  const [buyBalance, setBuyBalance] = useState<bigint | null>(null);
  const [holds, setHolds] = useState(false);
  const quoteSeq = useRef(0);

  const onBase = wallet.chainId === BASE_CHAIN_ID;

  // Balances + WPIT holding whenever the wallet or token pair changes.
  const refreshBalances = useCallback(async () => {
    const owner = wallet.address;
    if (!owner) {
      setSellBalance(null);
      setBuyBalance(null);
      setHolds(false);
      return;
    }
    try {
      const [sb, bb, hw] = await Promise.all([
        tokenBalance(sell.address, owner),
        tokenBalance(buy.address, owner),
        readHoldsWpit(owner),
      ]);
      setSellBalance(sb);
      setBuyBalance(bb);
      setHolds(hw);
    } catch {
      // Read failures leave balances unknown; the UI degrades gracefully.
    }
  }, [wallet.address, sell.address, buy.address]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  // Debounced indicative quote as the user types.
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
            sellToken: sell.address,
            buyToken: buy.address,
            sellAmount,
            slippageBps: SWAP_SLIPPAGE_BPS,
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
  }, [amount, sell.address, sell.decimals, buy.address, holds]);

  function flip() {
    setSell(buy);
    setBuy(sell);
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

  /** Execute: firm quote → ensure Base → approve if needed → swap → confirm. */
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
      if (!onBase) {
        const ok = await switchToBase();
        if (!ok) {
          setError("Switch your wallet to Base to trade.");
          setPhase("error");
          return;
        }
      }

      setPhase("swapping");
      const sellAmount = toBaseUnits(amount, sell.decimals).toString();
      const firm = await spotQuote({
        data: {
          sellToken: sell.address,
          buyToken: buy.address,
          sellAmount,
          taker: owner,
          slippageBps: SWAP_SLIPPAGE_BPS,
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

      // ERC-20 approval (native ETH needs none).
      if (!sell.native && firm.allowanceTarget) {
        const need = BigInt(firm.allowanceAmount ?? sellAmount);
        const current = await tokenAllowance(sell.address, owner, firm.allowanceTarget);
        if (current < need) {
          setPhase("approving");
          const ah = await approveToken(
            provider,
            owner,
            sell.address,
            firm.allowanceTarget,
            BigInt(MAX_UINT),
          );
          await waitForReceipt(ah);
        }
      }

      setPhase("swapping");
      const hash = await sendSwapTx(provider, owner, firm.tx);
      setTxHash(hash);
      setPhase("confirming");
      ping("Swap sent · settling on Base", "brass");
      const ok = await waitForReceipt(hash);
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
  }, [wallet.address, onBase, amount, sell, buy, holds, refreshBalances]);

  const fee = feeFor(holds);

  return {
    state: {
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
    onBase,
    setSell,
    setBuy,
    setAmount,
    flip,
    reset,
    execute,
    fmtBal: (bal: bigint | null, t: SpotToken) => (bal === null ? "—" : fromBaseUnits(bal, t.decimals)),
  };
}
