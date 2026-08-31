import { useEffect, useMemo, useRef, useState } from "react";
import { ChartPane } from "@/components/desk/chart";
import { BAR_MS, synthCandles } from "@/lib/wolfpit/engine";
import { loadSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import type { Candle } from "@/lib/wolfpit/types";
import type { useSwap } from "@/lib/swap/use-swap";
import { cn, fmtPx } from "@/lib/utils";

/** Stablecoins we price *against* rather than chart. */
const QUOTE_SYMS = new Set(["USDC", "USDT", "DAI", "USD", "USDBC", "FDUSD", "USDE"]);

/**
 * Price chart for the pair the user is swapping.
 *
 * Honesty rules (a trading surface must never show a wrong number as a price):
 *   • The headline number is the LIVE quote rate (buy/sell amounts from the
 *     aggregator) whenever one exists — that is the executable price.
 *   • When the quote leg is a stable, the subject's USD candles ARE the pair
 *     series, so the chart history is real.
 *   • When the quote leg is not a stable (e.g. AERO/ETH) and BOTH legs have
 *     candle feeds, the series is the true ratio subject÷quote, bucket-joined.
 *   • Otherwise there is no real history for this pair — draw a synthetic
 *     series ANCHORED AT the live rate (never a fake "1.00") and badge it
 *     "sim" so it can't be mistaken for market data.
 */
export function SwapChart({ swap, height = 240 }: { swap: ReturnType<typeof useSwap>; height?: number }) {
  const { sell, buy, quote } = swap.state;
  const [interval, setIv] = useState<ChartInterval>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [live, setLive] = useState(false); // series is real market data
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");

  // The instrument to chart: prefer the non-stable leg. If both legs are
  // stables (e.g. USDC→USDT), just chart the sell leg.
  const subject = useMemo(() => {
    const sellStable = QUOTE_SYMS.has(sell.symbol.toUpperCase());
    const buyStable = QUOTE_SYMS.has(buy.symbol.toUpperCase());
    if (!sellStable) return sell;
    if (!buyStable) return buy;
    return sell;
  }, [sell, buy]);

  const quoteTok = subject.symbol === sell.symbol ? buy : sell;

  /** Live executable pair rate in human units, from the aggregator quote. */
  const liveRate = useMemo(() => {
    if (!quote || !quote.ok) return null;
    const buyN = Number(quote.buyAmount);
    const sellN = Number(quote.sellAmount);
    if (!Number.isFinite(buyN) || !Number.isFinite(sellN) || buyN <= 0 || sellN <= 0) return null;
    // Base-unit ratio → human units: decimals of the sell side cancel against
    // the buy side only after shifting by their difference.
    const shift = 10 ** (sell.decimals - buy.decimals);
    const r = (buyN / sellN) * shift;
    return Number.isFinite(r) && r > 0 ? r : null;
  }, [quote, sell.decimals, buy.decimals]);

  // Latest live rate without re-running the candle fetch on every quote
  // refresh (the quote updates as the user types; candle history does not).
  const liveRateRef = useRef<number | null>(null);
  liveRateRef.current = liveRate;

  useEffect(() => {
    let dead = false;
    setStatus("load");
    const ms = BAR_MS[interval];
    const seed = subject.symbol.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const quoteStable = QUOTE_SYMS.has(quoteTok.symbol.toUpperCase());

    const finish = (rows: Candle[], isLive: boolean) => {
      if (dead) return;
      setBars(rows);
      setLive(isLive);
      setStatus("ok");
    };

    if (quoteStable) {
      // Pair ≈ subject/USD — the subject's own candle feed is the pair series.
      void loadSymbolCandles({ symbol: subject.symbol, interval }).then((rows) => {
        if (dead) return;
        if (rows.length >= 8) finish(rows, true);
        else finish(synth(synthAnchor(), ms, seed), false);
      });
      return () => {
        dead = true;
      };
    }

    // Non-stable quote: build the true ratio series when both legs have feeds.
    void Promise.all([
      loadSymbolCandles({ symbol: subject.symbol, interval }),
      loadSymbolCandles({ symbol: quoteTok.symbol, interval }),
    ]).then(([a, b]) => {
      if (dead) return;
      const bByT = new Map(b.map((c) => [c.t, c]));
      const ratio = a.flatMap((ca) => {
        const cb = bByT.get(ca.t);
        if (!cb || cb.c <= 0 || cb.o <= 0) return [];
        return [
          {
            t: ca.t,
            o: ca.o / cb.o,
            h: ca.h / Math.max(cb.l, 1e-12),
            l: ca.l / Math.max(cb.h, 1e-12),
            c: ca.c / cb.c,
            v: ca.v,
          } satisfies Candle,
        ];
      });
      if (ratio.length >= 8) finish(ratio, true);
      else finish(synth(synthAnchor(), ms, seed), false);
    });

    function synthAnchor(): number {
      // Anchor the synthetic series at the REAL pair rate when we have one.
      return liveRateRef.current ?? 1;
    }
    function synth(px: number, ms: number, seed: number): Candle[] {
      return synthCandles(px > 0 ? px : 1, ms, Date.now(), seed, false);
    }

    return () => {
      dead = true;
    };
  }, [subject.symbol, quoteTok.symbol, interval]);

  const last = bars.length ? bars[bars.length - 1]!.c : 0;
  const first = bars.length ? bars[0]!.c : 0;
  const chg = first > 0 ? (last - first) / first : 0;
  // Headline = the executable rate when live; else the series' own last print.
  const headline = liveRate ?? (live ? last : 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-lg leading-tight">{subject.symbol}</h2>
          <span className="font-mono text-[11px] text-subtle">/ {quoteTok.symbol}</span>
          {headline > 0 ? (
            <span className={cn("font-mono text-sm tabular-nums", chg >= 0 ? "text-up" : "text-down")}>
              {fmtPx(headline)}
            </span>
          ) : null}
          {live && bars.length ? (
            <span className={cn("font-mono text-[11px]", chg >= 0 ? "text-up" : "text-down")}>
              {chg >= 0 ? "+" : "−"}
              {(Math.abs(chg) * 100).toFixed(2)}%
            </span>
          ) : null}
          {!live ? (
            <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-warn">
              sim · indicative
            </span>
          ) : null}
        </div>
        <span className="truncate pl-2 font-mono text-[10px] uppercase tracking-wider text-subtle">{subject.name}</span>
      </div>
      <ChartPane candles={bars} interval={interval} status={status} onInterval={setIv} compact={height} />
    </div>
  );
}
