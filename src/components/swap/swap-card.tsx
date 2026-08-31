import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSwap } from "@/lib/swap/use-swap";
import { fromBaseUnits } from "@/lib/swap/chain";
import { chainById, nativeTokenOf } from "@/lib/swap/chains";
import { SWAP_CHAINS } from "@/lib/swap/chains";
import { searchChainTokens } from "@/lib/swap/token-search";
import {
  FEE_ENABLED,
  SLIPPAGE_PRESETS,
  SPOT_TOKENS,
  WPIT_LIVE,
  bpsToPct,
  type SpotToken,
} from "@/lib/swap/config";
import type { FoundToken } from "@/lib/swap/types";
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

/**
 * SwapCard owns its own useSwap instance (standalone use). When you need to
 * share swap state with something outside the card (e.g. a price chart for the
 * selected pair), lift useSwap in the parent and render <SwapWidget swap={…} />.
 */
export function SwapCard() {
  const swap = useSwap();
  return <SwapWidget swap={swap} />;
}

export function SwapWidget({ swap }: { swap: ReturnType<typeof useSwap> }) {
  const w = useWallet();
  const { state, fee, onRightChain } = swap;
  const q = state.quote;
  const chain = chainById(state.chainId);
  const native = nativeTokenOf(state.chainId);

  const connected = Boolean(w.address);
  const busy = ["quoting", "approving", "swapping", "confirming"].includes(state.phase);

  const [picking, setPicking] = useState<null | "sell" | "buy">(null);

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

  /** Native gas estimate (wei) from the quote, formatted in the native token. */
  const gasEst = useMemo(() => {
    if (!q || !q.ok || !q.gasFee || !native) return "";
    try {
      return fromBaseUnits(q.gasFee, native.decimals);
    } catch {
      return "";
    }
  }, [q, native]);

  /** Fee actually charged, in the sell token (base units → human). */
  const feeAmt = useMemo(() => {
    if (!q || !q.ok || !q.fee.amount) return "";
    try {
      return fromBaseUnits(q.fee.amount, state.sell.decimals);
    } catch {
      return "";
    }
  }, [q, state.sell.decimals]);

  function setMax() {
    if (state.sellBalance === null) return;
    let bal = state.sellBalance;
    if (state.sell.native) {
      const buffer = 200000000000000n; // 0.0002 native, kept for gas
      bal = bal > buffer ? bal - buffer : 0n;
    }
    swap.setAmount(fromBaseUnits(bal, state.sell.decimals));
  }

  const ctaLabel = (() => {
    if (!connected) return "Connect wallet";
    if (!onRightChain) return `Switch to ${chain?.label ?? "network"} & swap`;
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
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">Spot · live</p>
            <h2 className="font-display text-lg leading-tight">Market swap</h2>
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <span className="font-mono text-[10px] text-muted">{truncAddr(w.address)}</span>
            ) : null}
            <ChainSelect value={state.chainId} onChange={swap.chooseChain} />
          </div>
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
              <TokenButton token={state.sell} onClick={() => setPicking("sell")} />
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
              <TokenButton token={state.buy} onClick={() => setPicking("buy")} />
            </div>
          </div>
        </div>

        {/* DETAILS + KNOBS */}
        <div className="px-4 py-4">
          <div className="space-y-1.5 rounded-xl border border-border/70 bg-surface/50 px-3 py-2.5 font-mono text-[11px]">
            <Detail k="Network">
              <span className={cn(connected && !onRightChain ? "text-warn" : "text-fg")}>
                {chain?.label ?? "—"}
                {connected && !onRightChain ? ` · wallet on ${chainName(w.chainId)}` : ""}
              </span>
            </Detail>
            <Detail k="Rate">
              {rate ? `1 ${state.sell.symbol} ≈ ${fmtNum(String(rate), 4)} ${state.buy.symbol}` : "—"}
            </Detail>
            <Detail k="Route">
              {q && q.ok && q.route.sources.length
                ? q.route.sources.map((s) => s.replace(/_/g, " ")).join(" + ")
                : "Best of aggregated liquidity"}
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
                {feeAmt ? <span className="text-subtle">≈ {fmtNum(feeAmt)} {state.sell.symbol}</span> : null}
              </span>
            </Detail>
            <Detail k="Min received">{q && q.ok ? `${fmtNum(minOut)} ${state.buy.symbol}` : "—"}</Detail>
            {q && q.ok && q.priceImpact !== undefined ? (
              <Detail k="Price impact">
                <span className={cn(q.priceImpact > 0.03 ? "text-warn" : "text-muted")}>
                  {(q.priceImpact * 100).toFixed(2)}%
                </span>
              </Detail>
            ) : null}
            <Detail k="Est. gas">
              {gasEst ? `≈ ${fmtNum(gasEst, 6)} ${native?.symbol ?? ""}` : q && q.ok ? "in wallet preview" : "—"}
            </Detail>
          </div>

          {/* Slippage knob */}
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/50 px-3 py-2 font-mono text-[11px]">
            <span className="text-subtle">Slippage</span>
            <div className="flex items-center gap-1">
              {SLIPPAGE_PRESETS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => swap.setSlippageBps(bps)}
                  className={cn(
                    "pressable rounded-full border px-2 py-0.5",
                    swap.slippageBps === bps ? "border-brass text-brass" : "border-border text-muted hover:text-fg",
                  )}
                >
                  {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
                </button>
              ))}
              <SlippageCustom value={swap.slippageBps} onChange={swap.setSlippageBps} />
            </div>
          </div>

          {WPIT_LIVE && state.chainId === 8453 ? null : !WPIT_LIVE ? (
            <p className="mt-2 text-[10px] leading-relaxed text-subtle">
              Hold WPIT (Base) for 50% off trading fees. WPIT lists after launch — until then every wallet pays the
              standard {bpsToPct(fee.fullBps)}.{" "}
              <Link to="/info" className="text-brass hover:underline">
                Fee details
              </Link>
            </p>
          ) : null}

          {!FEE_ENABLED ? (
            <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-2 py-1.5 text-[10px] text-warn">
              Router not fully configured (fee wallet / API key). Quotes and swaps go live once deploy env is set.
            </p>
          ) : null}

          {state.error ? (
            <p className="mt-2 rounded-lg border border-down/40 bg-down/10 px-2 py-1.5 text-[11px] text-down">
              {state.error}
            </p>
          ) : null}

          {state.phase === "done" && state.txHash && chain ? (
            <a
              href={`${chain.explorer}/tx/${state.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block rounded-lg border border-up/40 bg-up/10 px-2 py-1.5 text-[11px] text-up hover:underline"
            >
              Swap settled ✓ — view on explorer ({truncAddr(state.txHash)})
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
            Market orders route through a DEX aggregator for best execution. Non-custodial — funds move directly
            from your wallet.
          </p>
        </div>
      </div>

      {picking ? (
        <TokenPicker
          side={picking}
          chainId={state.chainId}
          onPick={(t) => {
            if (picking === "sell") swap.setSell(t);
            else swap.setBuy(t);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
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

function ChainSelect({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const w = useWallet();
  const wrongChain = w.chainId !== null && w.chainId !== value;
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-9 cursor-pointer appearance-none rounded-full border pl-3 pr-7 font-mono text-[11px] outline-none focus:border-brass",
          wrongChain ? "border-warn text-warn" : "border-brass/50 bg-elevated text-brass",
        )}
        aria-label="Select network"
      >
        {SWAP_CHAINS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.id === 8453 ? " ★" : ""}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-subtle">▾</span>
    </div>
  );
}

function TokenButton({ token, onClick }: { token: SpotToken; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-elevated px-3 font-medium hover:border-brass"
    >
      <span className="grid size-6 place-items-center rounded-full border border-brass/40 text-[9px] text-brass">
        {token.symbol.slice(0, 2).toUpperCase()}
      </span>
      <span className="max-w-[7rem] truncate">{token.symbol}</span>
      <span className="text-subtle">▾</span>
    </button>
  );
}

function SlippageCustom({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "pressable rounded-full border px-2 py-0.5",
          ![10, 30, 50, 100].includes(value) ? "border-brass text-brass" : "border-border text-muted hover:text-fg",
        )}
      >
        {[10, 30, 50, 100].includes(value) ? "custom" : `${(value / 100).toFixed(2)}%`}
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const pct = Number(draft);
        if (Number.isFinite(pct) && pct > 0 && pct <= 50) onChange(Math.round(pct * 100));
        setOpen(false);
        setDraft("");
      }}
    >
      <input
        autoFocus
        inputMode="decimal"
        placeholder="0.5"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => {
          setOpen(false);
          setDraft("");
        }}
        className="h-6 w-14 rounded-full border border-border bg-elevated px-2 text-center outline-none focus:border-brass"
        aria-label="Custom slippage percent"
      />
      <span className="text-subtle">%</span>
    </form>
  );
}

function TokenPicker({
  side,
  chainId,
  onPick,
  onClose,
}: {
  side: "sell" | "buy";
  chainId: number;
  onPick: (t: SpotToken) => void;
  onClose: () => void;
}) {
  const chain = chainById(chainId);
  const native = nativeTokenOf(chainId);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<FoundToken[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // Debounced search: native + (Base quick picks | aggregator results).
  useEffect(() => {
    const query = q.trim();
    const seqNow = ++seq.current;
    const t = window.setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const res = await searchChainTokens({ data: { chainId, q: query } });
        if (seqNow !== seq.current) return;
        if (res.ok) {
          let list = res.tokens;
          if (!query && chainId === 8453) {
            // Base defaults first when the query is empty.
            const seen = new Set(list.map((r) => r.address.toLowerCase()));
            const picks: FoundToken[] = SPOT_TOKENS.filter((p) => !seen.has(p.address.toLowerCase())).map((p) => ({
              chainId,
              ...p,
            }));
            list = [...list, ...picks];
          }
          setRows(list.slice(0, 20));
        } else {
          setRows([]);
          setErr(res.error);
        }
      } catch {
        if (seqNow !== seq.current) return;
        setRows([]);
        setErr("Search failed — try again.");
      } finally {
        if (seqNow === seq.current) setBusy(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, chainId]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-bg/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="sheet-in flex max-h-[min(80dvh,30rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-brass/40 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">
            Select token · {side === "sell" ? "you pay" : "you receive"}
          </p>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${chain?.label ?? ""} — symbol, name, or 0x address`}
            className="mt-2 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-xs outline-none focus:border-brass"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {busy && !rows.length ? <p className="px-4 py-3 text-xs text-muted">Searching…</p> : null}
          {rows.map((t) => (
            <button
              key={t.address}
              type="button"
              onClick={() => onPick({ symbol: t.symbol, name: t.name, address: t.address, decimals: t.decimals, native: t.native })}
              className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-3 text-left hover:bg-elevated"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-brass/40 text-[10px] text-brass">
                  {t.symbol.slice(0, 3).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{t.symbol}</div>
                  <div className="truncate text-[11px] text-muted">{t.name}</div>
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-[10px] text-subtle">
                {t.native ? "native" : `${t.address.slice(0, 6)}…${t.address.slice(-4)}`}
              </div>
            </button>
          ))}
          {!busy && !rows.length && err ? <p className="px-4 py-3 text-xs text-down">{err}</p> : null}
          {!busy && !rows.length && !err && native ? (
            <button
              type="button"
              onClick={() => onPick({ ...native })}
              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-elevated"
            >
              <span className="grid size-8 place-items-center rounded-full border border-brass/40 text-[10px] text-brass">
                {native.symbol.slice(0, 3).toUpperCase()}
              </span>
              <div>
                <div className="font-mono text-sm">{native.symbol}</div>
                <div className="text-[11px] text-muted">{native.name} · native</div>
              </div>
            </button>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-border p-3">
          <Button variant="outline" className="h-10 w-full" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
