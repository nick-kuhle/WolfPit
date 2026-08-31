import { useEffect, useMemo, useState } from "react";
import { ChartPane } from "@/components/desk/chart";
import { BAR_MS, synthCandles } from "@/lib/wolfpit/engine";
import { loadSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import type { Candle } from "@/lib/wolfpit/types";
import type { useSwap } from "@/lib/swap/use-swap";
import { cn, fmtPx } from "@/lib/utils";

/** Stablecoins we price *against* rather than chart. */
const QUOTE_SYMS = new Set(["USDC", "USDT", "DAI", "USD", "USDBC", "FDUSD", "USDE"]);

/**
 * Price chart for the pair the user is swapping. Charts the non-stable side of
 * the pair (e.g. ETH for ETH→USDC, or the token being bought when paying USDC),
 * on the same candle feed the desk uses. Falls back to synthetic candles when a
 * token has no external feed (arbitrary ERC-20s), so the pane never blanks.
 */
export function SwapChart({ swap, height = 240 }: { swap: ReturnType<typeof useSwap>; height?: number }) {
  const { sell, buy } = swap.state;
  const [interval, setIv] = useState<ChartInterval>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");

  // The instrument to chart: prefer the non-stable leg. If both leg symbols are
  // stables (e.g. USDC→USDT), just chart the sell leg.
  const subject = useMemo(() => {
    const sellStable = QUOTE_SYMS.has(sell.symbol.toUpperCase());
    const buyStable = QUOTE_SYMS.has(buy.symbol.toUpperCase());
    if (!sellStable) return sell;
    if (!buyStable) return buy;
    return sell;
  }, [sell, buy]);

  const quoteSym = subject.symbol === sell.symbol ? buy.symbol : sell.symbol;

  useEffect(() => {
    let dead = false;
    setStatus("load");
    const ms = BAR_MS[interval];
    const seed = subject.symbol.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    void loadSymbolCandles({ symbol: subject.symbol, interval }).then((rows) => {
      if (dead) return;
      if (rows.length >= 8) {
        setBars(rows);
        setStatus("ok");
        return;
      }
      // No external feed for this token — draw a stable synthetic series so the
      // pane still renders (arbitrary ERC-20s, testnets, thin memecoins).
      setBars(synthCandles(1, ms, Date.now(), seed, false));
      setStatus("ok");
    });
    return () => {
      dead = true;
    };
  }, [subject.symbol, interval]);

  const last = bars.length ? bars[bars.length - 1]!.c : 0;
  const first = bars.length ? bars[0]!.c : 0;
  const chg = first > 0 ? (last - first) / first : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-lg leading-tight">{subject.symbol}</h2>
          <span className="font-mono text-[11px] text-subtle">/ {quoteSym}</span>
          {status === "ok" && last > 0 ? (
            <span className={cn("font-mono text-sm tabular-nums", chg >= 0 ? "text-up" : "text-down")}>
              {fmtPx(last)}
            </span>
          ) : null}
          {status === "ok" && bars.length ? (
            <span className={cn("font-mono text-[11px]", chg >= 0 ? "text-up" : "text-down")}>
              {chg >= 0 ? "+" : "−"}
              {(Math.abs(chg) * 100).toFixed(2)}%
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">{subject.name}</span>
      </div>
      <ChartPane candles={bars} interval={interval} status={status} onInterval={setIv} compact={height} />
    </div>
  );
}
