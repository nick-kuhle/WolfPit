import { useEffect, useMemo, useRef, useState } from "react";
import { ChartCard } from "@/components/desk/chart";
import { BAR_MS, synthCandles } from "@/lib/wolfpit/engine";
import { loadSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import { candleArgsFor, isStableSymbol, pickSubject, resolveTokenFeed, type TokenFeed } from "@/lib/swap/chart-feed";
import type { Candle } from "@/lib/wolfpit/types";
import type { useSwap } from "@/lib/swap/use-swap";
import { fmtPx } from "@/lib/utils";

/**
 * Price chart for the pair the user is swapping.
 *
 * What was broken (fixed 2026-08-31)
 * ----------------------------------
 * This chart called `loadSymbolCandles({ symbol })` with the symbol ALONE.
 * That helper can only reach a feed it is told how to reach: a CEX pair from
 * its symbol maps, a CoinGecko id, or network + poolAddress. For any token
 * outside the ~30 CEX majors it therefore returned zero bars, the component
 * fell through to `synthCandles(1, …)`, and the live desk drew a fabricated
 * random walk around 1.00 while the simulation desk — which passes the pool
 * through from its tape row — drew the real thing. Verified against the live
 * APIs: `{ symbol: "Basecat" }` → 0 bars, `{ symbol: "Basecat", network:
 * "base", poolAddress: "0xf794…8944" }` → 200 bars.
 *
 * It also charted the SELL leg, so ETH → Basecat was headed "ETH / Basecat"
 * instead of showing Basecat at all.
 *
 * Honesty rules (a trading surface must never show a wrong number as a price)
 * --------------------------------------------------------------------------
 *   • The chart subject is the leg the user is taking a view on: the long-tail
 *     token over a major, a major over a stablecoin (see `pickSubject`).
 *   • The series is the subject's real USD price — the SAME series the
 *     simulation desk draws for that token, resolved from its contract to its
 *     deepest pool. The headline is that series' last print, labelled `/ USD`.
 *   • The executable pair rate from the aggregator is shown as its own line,
 *     labelled as a quote, so it is never confused with the charted series.
 *   • If no real series exists for the subject, draw a synthetic one anchored
 *     at the best real price we hold and badge it "sim · indicative".
 */
export function SwapChart({ swap, height = 240 }: { swap: ReturnType<typeof useSwap>; height?: number }) {
  const { chainId, sell, buy, quote } = swap.state;
  const [interval, setIv] = useState<ChartInterval>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [live, setLive] = useState(false); // series is real market data
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");
  const [feed, setFeed] = useState<TokenFeed | null>(null);

  // The instrument to chart. Ties resolve to the sell leg, so the choice stays
  // put while the user is still picking the other side.
  const { subject, quote: quoteTok } = useMemo(() => pickSubject(sell, buy), [sell, buy]);

  /**
   * Live executable pair rate in human units, read the way the ticket reads it:
   * buy-token per 1 sell-token. Shown as its own line rather than as the
   * chart's headline — the chart is denominated in USD.
   */
  const pairRate = useMemo(() => {
    if (!quote || !quote.ok) return null;
    const buyN = Number(quote.buyAmount);
    const sellN = Number(quote.sellAmount);
    if (!Number.isFinite(buyN) || !Number.isFinite(sellN) || buyN <= 0 || sellN <= 0) return null;
    // Base-unit ratio → human units: shift by the decimals difference.
    const shift = 10 ** (sell.decimals - buy.decimals);
    const buyPerSell = (buyN / sellN) * shift;
    return Number.isFinite(buyPerSell) && buyPerSell > 0 ? buyPerSell : null;
  }, [quote, sell.decimals, buy.decimals]);

  /**
   * The subject's USD price implied by the live quote, used to anchor a
   * fallback series when the subject has no feed but the other leg is a
   * stablecoin (then one unit of the quote leg IS one dollar).
   */
  const impliedUsd = useMemo(() => {
    if (pairRate == null || !isStableSymbol(quoteTok.symbol)) return null;
    // pairRate is buy-per-sell; convert to "quote-leg units per 1 subject".
    const perSubject = subject.symbol === sell.symbol ? pairRate : 1 / pairRate;
    return Number.isFinite(perSubject) && perSubject > 0 ? perSubject : null;
  }, [pairRate, quoteTok.symbol, subject.symbol, sell.symbol]);

  const impliedRef = useRef<number | null>(null);
  impliedRef.current = impliedUsd;

  // 1) Resolve the subject contract to a chartable feed (pool / CEX / gecko id).
  useEffect(() => {
    let dead = false;
    setFeed(null);
    setStatus("load");
    void resolveTokenFeed({
      chainId,
      address: subject.address,
      symbol: subject.symbol,
      native: subject.native,
    }).then((f) => {
      if (!dead) setFeed(f);
    });
    return () => {
      dead = true;
    };
  }, [chainId, subject.address, subject.symbol, subject.native]);

  // 2) Load the candles for that feed, and keep them fresh (live desk).
  useEffect(() => {
    if (!feed) return;
    let dead = false;
    setStatus("load");
    const ms = BAR_MS[interval];
    const seed = subject.symbol.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const args = candleArgsFor(subject, feed);

    const pull = () => {
      void loadSymbolCandles({ ...args, interval }).then((rows) => {
        if (dead) return;
        if (rows.length >= 8) {
          setBars(rows);
          setLive(true);
          setStatus("ok");
          return;
        }
        // No real series. Anchor the indicative one at the best real price we
        // hold — the resolver's spot, else the quote-implied USD — never 1.00.
        const anchor = feed.priceUsd && feed.priceUsd > 0 ? feed.priceUsd : (impliedRef.current ?? 0);
        setBars(synthCandles(anchor > 0 ? anchor : 1, ms, Date.now(), seed, false));
        setLive(false);
        setStatus("ok");
      });
    };

    pull();
    const timer = setInterval(pull, 60_000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [feed, subject, interval]);

  const last = bars.length ? bars[bars.length - 1]!.c : 0;
  const first = bars.length ? bars[0]!.c : 0;
  const chg = first > 0 ? (last - first) / first : 0;
  // Headline = the charted series' own last print, in USD.
  const headline = live ? last : (feed?.priceUsd ?? 0);

  return (
    <ChartCard
      symbol={subject.symbol}
      quoteSymbol="USD"
      name={subject.name}
      price={headline}
      changePct={live && bars.length ? chg : null}
      tag={
        // Only once the load has settled: badging "indicative" while the real
        // series is still in flight labels good data as fake.
        status === "ok" && !live ? (
          <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-warn">
            sim · indicative
          </span>
        ) : null
      }
      note={
        pairRate != null ? (
          <>
            <span className="text-subtle">quote</span> 1 {sell.symbol} ={" "}
            <span className="text-fg">{fmtPx(pairRate)}</span> {buy.symbol}
          </>
        ) : null
      }
      candles={bars}
      interval={interval}
      status={status}
      onInterval={setIv}
      height={height}
    />
  );
}
