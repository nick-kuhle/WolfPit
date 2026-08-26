import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PitChart } from "@/components/desk/chart";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Button } from "@/components/ui/button";
import { useDesk } from "@/lib/wolfpit/desk";
import { resampleCandles } from "@/lib/wolfpit/engine";
import { getSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import { shareAsset } from "@/lib/wolfpit/share";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export function AssetCard() {
  const focus = useDesk((s) => s.focus);
  const expanded = useDesk((s) => s.expanded);
  const closeCard = useDesk((s) => s.closeCard);
  const setExpanded = useDesk((s) => s.setExpanded);
  const listToken = useWolf((s) => s.listToken);
  const wpitBars = useWolf((s) => s.wpitCandles);
  const wpitPx = useWolf((s) => s.wpit);
  const [interval, setIv] = useState<ChartInterval>("1m");
  const [bars, setBars] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");
  const [ticket, setTicket] = useState<"buy" | "sell" | null>(null);

  useEffect(() => {
    listToken(focus.symbol, focus.price || 1);
  }, [focus.symbol, focus.price, listToken]);

  useEffect(() => {
    if (focus.symbol === "WPIT") {
      const ms = interval === "1d" ? 86_400_000 : interval === "1h" ? 3_600_000 : interval === "15m" ? 900_000 : interval === "5m" ? 300_000 : 60_000;
      const rows = resampleCandles(wpitBars, ms);
      setBars(rows);
      setStatus(rows.length >= 2 ? "ok" : "empty");
      return;
    }
    let dead = false;
    setStatus("load");
    setBars([]);
    void getSymbolCandles({
      data: {
        symbol: focus.symbol,
        interval,
        binance: focus.binance,
        geckoId: focus.geckoId,
        network: focus.network,
        poolAddress: focus.poolAddress,
      },
    })
      .then((rows) => {
        if (dead) return;
        setBars(rows);
        setStatus(rows.length >= 2 ? "ok" : "empty");
      })
      .catch(() => {
        if (!dead) setStatus("empty");
      });
    return () => {
      dead = true;
    };
  }, [focus.symbol, focus.binance, focus.geckoId, focus.network, focus.poolAddress, interval, wpitBars, wpitPx]);

  return (
    <div
      className={cn(
        "sheet-in z-30 flex min-h-0 flex-col overflow-hidden border-border bg-panel",
        expanded
          ? "fixed inset-0 border-0"
          : "fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[min(70dvh,36rem)] rounded-[var(--radius-xl)] border landscape:inset-y-2 landscape:bottom-2 landscape:left-auto landscape:right-2 landscape:w-[min(28rem,52vw)] landscape:max-h-none lg:absolute lg:inset-y-3 lg:right-3 lg:left-auto lg:bottom-auto lg:w-[min(26rem,40%)] lg:max-h-none",
      )}
    >
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-brass">
            {focus.symbol} · {focus.chain ?? "live"}
          </div>
          <h2 className="truncate font-display text-xl font-medium leading-tight">{focus.name}</h2>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-lg tabular-nums">{fmtPx(focus.symbol === "WPIT" ? wpitPx : focus.price)}</span>
            <span className={`font-mono text-sm ${focus.change24 >= 0 ? "text-up" : "text-down"}`}>
              {fmtPct(focus.change24)}
            </span>
            <span className="text-xs text-muted">{fmtUsd(focus.volume24)}</span>
          </div>
        </div>
        <div className="flex shrink-0">
          <button className="h-11 px-3 text-xs uppercase tracking-wider text-muted" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Shrink" : "Expand"}
          </button>
          <button className="h-11 px-3 text-xs uppercase tracking-wider text-muted" onClick={closeCard}>
            Close
          </button>
        </div>
      </header>

      <div className="flex gap-1 border-b border-border px-2">
        {(["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setIv(k)}
            className={cn("h-10 px-2.5 font-mono text-xs", interval === k ? "text-fg" : "text-muted")}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="relative h-44 shrink-0 bg-chart landscape:h-36 lg:h-52">
        {status === "load" ? <p className="p-4 text-sm text-muted">Loading {interval}…</p> : null}
        {status === "empty" ? <p className="p-4 text-sm text-muted">No candles. Try 1h.</p> : null}
        {status === "ok" ? <PitChart candles={bars} height={160} interval={interval} /> : null}
      </div>

      <div className="flex items-center gap-2 px-3 pt-3 text-xs">
        <Link
          to="/asset/$symbol"
          params={{ symbol: focus.symbol }}
          search={{
            name: focus.name,
            chain: focus.chain ?? "",
            contract: focus.contract ?? "",
            network: focus.network ?? "",
          }}
          className="text-brass underline-offset-2 hover:underline"
        >
          Open details
        </Link>
        <span className="text-subtle">·</span>
        <button className="text-muted hover:text-fg" onClick={() => void shareAsset(focus)}>
          Share
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <Button variant="up" onClick={() => setTicket("buy")}>
          Buy
        </Button>
        <Button variant="down" onClick={() => setTicket("sell")}>
          Sell
        </Button>
      </div>

      {ticket ? (
        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
          <OrderTicket prefer={ticket} />
        </div>
      ) : null}
    </div>
  );
}