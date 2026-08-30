import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSwap } from "@/lib/swap/use-swap";
import { fromBaseUnits } from "@/lib/swap/chain";
import {
  FEE_ENABLED,
  SPOT_TOKENS,
  WPIT_LIVE,
  bpsToPct,
  tokenBySymbol,
  type SpotToken,
} from "@/lib/swap/config";
import { useWallet, truncAddr, chainName } from "@/lib/wallet/session";
import { cn } from "@/lib/utils";

function fmtNum(v: string, dp = 6): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

export function SwapCard() {
  const w = useWallet();
  const swap = useSwap();
  const { state, fee, onBase } = swap;
  const q = state.quote;

  const connected = Boolean(w.address);
  const busy = ["quoting", "approving", "swapping", "confirming"].includes(state.phase);

  const buyOut = useMemo(() => {
    if (!q || !q.ok) return "";
    return fromBaseUnits(q.buyAmount, state.buy.decimals);
  }, [q, state.buy.decimals]);

  const minOut = useMemo(() => {
    if (!q || !q.ok) return "";
    return fromBaseUnits(q.minBuyAmount, state.buy.decimals);
  }, [q, state.buy.decimals]);

  const rate = useMemo(() => {
    const a = Number(state.amount);
    const o = Number(buyOut);
    if (!a || !o) return null;
    return o / a;
  }, [state.amount, buyOut]);

  const sellBalStr = swap.fmtBal(state.sellBalance, state.sell);
  const overBalance =
    state.sellBalance !== null &&
    Number(state.amount) > 0 &&
    Number(state.amount) > Number(fromBaseUnits(state.sellBalance, state.sell.decimals));

  function setMax() {
    if (state.sellBalance === null) return;
    // Leave a little native ETH for gas.
    let bal = state.sellBalance;
    if (state.sell.native) {
      const buffer = 200000000000000n; // 0.0002 ETH
      bal = bal > buffer ? bal - buffer : 0n;
    }
    swap.setAmount(fromBaseUnits(bal, state.sell.decimals));
  }

  const buyOptions = SPOT_TOKENS.filter((t) => t.symbol !== state.sell.symbol);
  const sellOptions = SPOT_TOKENS.filter((t) => t.symbol !== state.buy.symbol);

  const ctaLabel = (() => {
    if (!connected) return "Connect wallet";
    if (!onBase) return "Switch to Base & swap";
    if (state.phase === "approving") return "Approving…";
    if (state.phase === "swapping") return "Confirm in wallet…";
    if (state.phase === "confirming") return "Settling on-chain…";
    if (state.phase === "quoting") return "Finding best route…";
    if (overBalance) return "Insufficient balance";
    return `Swap ${state.sell.symbol} → ${state.buy.symbol}`;
  })();

  const ctaDisabled =
    busy ||
    overBalance ||
    (connected && (!q || !q.ok || !state.amount || Number(state.amount) <= 0));

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">Spot · Base</p>
            <h2 className="font-display text-lg leading-tight">Market swap</h2>
          </div>
          <span
            className={cn(
              "rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
              connected && onBase ? "border border-up text-up" : "border border-border text-muted",
            )}
          >
            {connected ? (onBase ? "Base" : chainName(w.chainId)) : "Aggregated"}
          </span>
        </div>

        {/* SELL */}
        <div className="px-4 pt-4">
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>You pay</span>
              <span>
                Balance: {connected ? fmtNum(sellBalStr) : "—"}{" "}
                {connected && state.sellBalance !== null ? (
                  <button type="button" onClick={setMax} className="ml-1 text-brass hover:underline">
                    Max
                  </button>
                ) : null}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={state.amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  swap.setAmount(v);
                }}
                className="min-w-0 flex-1 bg-transparent font-display text-3xl tabular-nums outline-none placeholder:text-subtle"
              />
              <TokenSelect value={state.sell} options={sellOptions} onChange={swap.setSell} />
            </div>
          </div>
        </div>

        {/* FLIP */}
        <div className="relative flex justify-center">
          <button
            type="button"
            onClick={swap.flip}
            className="pressable absolute -mt-3 grid size-8 place-items-center rounded-full border border-border bg-elevated text-brass"
            aria-label="Flip tokens"
          >
            ↓
          </button>
        </div>

        {/* BUY */}
        <div className="px-4 pt-4">
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>You receive (est.)</span>
              <span>Balance: {connected ? fmtNum(swap.fmtBal(state.buyBalance, state.buy)) : "—"}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="min-w-0 flex-1 font-display text-3xl tabular-nums text-fg">
                {q && q.ok ? fmtNum(buyOut) : <span className="text-subtle">0.0</span>}
              </div>
              <TokenSelect value={state.buy} options={buyOptions} onChange={swap.setBuy} />
            </div>
          </div>
        </div>

        {/* DETAILS */}
        <div className="px-4 py-4">
          <div className="space-y-1.5 rounded-xl border border-border/70 bg-surface/50 px-3 py-2.5 font-mono text-[11px]">
            <Detail k="Rate">
              {rate ? `1 ${state.sell.symbol} ≈ ${fmtNum(String(rate), 4)} ${state.buy.symbol}` : "—"}
            </Detail>
            <Detail k="Route">
              {q && q.ok && q.route.sources.length
                ? q.route.sources.map((s) => s.replace(/_/g, " ")).join(" + ")
                : "Best of Base DEXs"}
            </Detail>
            <Detail k={`Trading fee (${bpsToPct(fee.bps)})`}>
              <span className="flex items-center gap-1.5">
                {fee.discounted ? (
                  <>
                    <span className="text-subtle line-through">{bpsToPct(fee.fullBps)}</span>
                    <span className="text-up">{bpsToPct(fee.bps)}</span>
                    <span className="rounded bg-up/15 px-1 text-[9px] text-up">WPIT −50%</span>
                  </>
                ) : (
                  <span>{bpsToPct(fee.bps)}</span>
                )}
              </span>
            </Detail>
            <Detail k="Min received">
              {q && q.ok ? `${fmtNum(minOut)} ${state.buy.symbol}` : "—"}
            </Detail>
            {q && q.ok && q.priceImpact !== undefined ? (
              <Detail k="Price impact">
                <span className={cn(q.priceImpact > 0.03 ? "text-warn" : "text-muted")}>
                  {(q.priceImpact * 100).toFixed(2)}%
                </span>
              </Detail>
            ) : null}
          </div>

          {!WPIT_LIVE ? (
            <p className="mt-2 text-[10px] leading-relaxed text-subtle">
              Hold WPIT for 50% off trading fees. WPIT lists after launch — until then every wallet
              pays the standard {bpsToPct(fee.fullBps)}.{" "}
              <Link to="/info" className="text-brass hover:underline">
                Fee details
              </Link>
            </p>
          ) : !fee.discounted ? (
            <p className="mt-2 text-[10px] leading-relaxed text-subtle">
              Hold any WPIT to cut this fee to {bpsToPct(fee.discountBps)}.{" "}
              <Link to="/info" className="text-brass hover:underline">
                Learn how
              </Link>
            </p>
          ) : null}

          {!FEE_ENABLED ? (
            <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-2 py-1.5 text-[10px] text-warn">
              Router not fully configured (fee wallet / API key). Quotes and swaps go live once
              deploy env is set.
            </p>
          ) : null}

          {state.error ? (
            <p className="mt-2 rounded-lg border border-down/40 bg-down/10 px-2 py-1.5 text-[11px] text-down">
              {state.error}
            </p>
          ) : null}

          {state.phase === "done" && state.txHash ? (
            <a
              href={`https://basescan.org/tx/${state.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block rounded-lg border border-up/40 bg-up/10 px-2 py-1.5 text-[11px] text-up hover:underline"
            >
              Swap settled ✓ — view on BaseScan ({truncAddr(state.txHash)})
            </a>
          ) : null}

          <Button
            className="mt-3 h-12 w-full"
            variant={connected ? "up" : "default"}
            disabled={connected ? ctaDisabled : w.connecting}
            onClick={() => {
              if (!connected) {
                void w.connect();
                return;
              }
              void swap.execute();
            }}
          >
            {!connected && w.connecting ? "Waiting on wallet…" : ctaLabel}
          </Button>

          <p className="mt-2 text-center text-[10px] text-subtle">
            Market orders route through a DEX aggregator for best execution. Non-custodial — funds
            move directly from your wallet.
          </p>
        </div>
      </div>
    </div>
  );
}

function Detail({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-subtle">{k}</span>
      <span className="text-right text-fg">{children}</span>
    </div>
  );
}

function TokenSelect({
  value,
  options,
  onChange,
}: {
  value: SpotToken;
  options: SpotToken[];
  onChange: (t: SpotToken) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value.symbol}
        onChange={(e) => {
          const t = tokenBySymbol(e.target.value);
          if (t) onChange(t);
        }}
        className="h-10 cursor-pointer appearance-none rounded-full border border-border bg-elevated pl-3 pr-8 font-medium outline-none focus:border-brass"
        aria-label="Select token"
      >
        {options.map((t) => (
          <option key={t.symbol} value={t.symbol}>
            {t.symbol}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle">▾</span>
    </div>
  );
}
