import { useEffect, useState } from "react";
import { PitChart } from "@/components/desk/chart";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Button } from "@/components/ui/button";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk } from "@/lib/wolfpit/desk";
import { getSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export function AssetCard() {
  const focus = useDesk((s) => s.focus);
  const expanded = useDesk((s) => s.expanded);
  const closeCard = useDesk((s) => s.closeCard);
  const setExpanded = useDesk((s) => s.setExpanded);
  const listToken = useWolf((s) => s.listToken);
  const [interval, setIv] = useState<ChartInterval>("1m");
  const [bars, setBars] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");
  const [ticket, setTicket] = useState<"buy" | "sell" | null>(null);

  useEffect(() => {
    listToken(focus.symbol, focus.price || 1);
  }, [focus.symbol, focus.price, listToken]);

  useEffect(() => {
    let dead = false;
    setStatus("load");
    setBars([]);
    void getSymbolCandles({
      data: {
        symbol: focus.symbol,
        interval,
        binance: focus.binance,
        geckoId: focus.geckoId,
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
  }, [focus.symbol, focus.binance, focus.geckoId, interval]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-border bg-panel",
        expanded
          ? "fixed inset-0 z-40 border-0"
          : "absolute inset-x-3 bottom-3 top-[28%] z-30 rounded-[var(--radius-xl)] border shadow-[0_0_0_1px_rgba(255,255,255,0.06)] lg:inset-auto lg:right-6 lg:top-24 lg:h-[min(640px,calc(100dvh-8rem))] lg:w-[min(420px,42vw)]",
      )}
    >
      <header className="flex items-start gap-2 border-b border-border px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-brass">
            {focus.symbol}-USD · {focus.chain ?? "live"}
          </div>
          <h2 className="truncate font-display text-2xl font-medium leading-tight">{focus.name}</h2>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xl tabular-nums">{fmtPx(focus.price)}</span>
            <span className={`font-mono text-sm ${focus.change24 >= 0 ? "text-up" : "text-down"}`}>
              {fmtPct(focus.change24)}
            </span>
            <span className="text-xs text-muted">vol {fmtUsd(focus.volume24)}</span>
          </div>
          {focus.contract ? (
            <p className="mt-1 truncate font-mono text-[10px] text-subtle">{focus.contract}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className="h-11 px-3 text-xs uppercase tracking-wider text-muted hover:text-fg"
            onClick={() => {
              setExpanded(!expanded);
              ping(expanded ? "Card" : "Full pit", "brass");
            }}
          >
            {expanded ? "Shrink" : "Expand"}
          </button>
          <button
            className="h-11 px-3 text-xs uppercase tracking-wider text-muted hover:text-fg"
            onClick={() => {
              closeCard();
              ping("Board", "brass");
            }}
          >
            Close
          </button>
        </div>
      </header>

      <div className="flex gap-1 border-b border-border px-2">
        {(["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setIv(k);
              ping(`${focus.symbol} ${k}`, "brass");
            }}
            className={cn("h-11 px-2.5 font-mono text-xs", interval === k ? "text-fg" : "text-muted")}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="relative h-56 shrink-0 bg-chart sm:h-64">
        {status === "load" ? (
          <p className="p-4 text-sm text-muted">Fetching {focus.symbol} {interval}…</p>
        ) : null}
        {status === "empty" ? (
          <p className="p-4 text-sm text-muted">No candles for this timeframe. Try 1h or 1d.</p>
        ) : null}
        {status === "ok" ? <PitChart candles={bars} height={220} interval={interval} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <Button
          variant="up"
          onClick={() => {
            setTicket("buy");
            ping(`Buy ${focus.symbol}`, "up");
          }}
        >
          Buy
        </Button>
        <Button
          variant="down"
          onClick={() => {
            setTicket("sell");
            ping(`Sell ${focus.symbol}`, "down");
          }}
        >
          Sell
        </Button>
      </div>

      {ticket ? (
        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
          <OrderTicket prefer={ticket} />
        </div>
      ) : (
        <p className="px-3 pb-4 text-xs leading-relaxed text-muted">
          Spot trades {focus.symbol}-USDC paper. Minis and vanillas are ETH-dated until this name has its own
          inventory. Expand for the full ticket.
        </p>
      )}
    </div>
  );
}
