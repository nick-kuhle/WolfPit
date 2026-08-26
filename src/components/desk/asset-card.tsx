import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PitChart } from "@/components/desk/chart";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Button } from "@/components/ui/button";
import { SideToggle } from "@/components/ui/toggle";
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
  const [tab, setTab] = useState<"chart" | "trade">("chart");
  const [side, setSide] = useState<"buy" | "sell">("buy");

  useEffect(() => {
    listToken(focus.symbol, focus.price || 1);
    setTab("chart");
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
          : "fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] h-[min(78dvh,40rem)] rounded-[var(--radius-xl)] border landscape:inset-y-2 landscape:bottom-2 landscape:left-auto landscape:right-2 landscape:h-auto landscape:w-[min(28rem,52vw)] lg:absolute lg:inset-y-3 lg:right-3 lg:left-auto lg:bottom-auto lg:h-auto lg:w-[min(26rem,40%)]",
      )}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2">
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
          <button className="pressable h-11 px-3 text-xs uppercase tracking-wider text-muted hover:text-fg" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Shrink" : "Expand"}
          </button>
          <button className="pressable h-11 px-3 text-xs uppercase tracking-wider text-muted hover:text-fg" onClick={closeCard}>
            Close
          </button>
        </div>
      </header>

      <div className="flex shrink-0 border-b border-border">
        {(["chart", "trade"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "pressable h-11 flex-1 text-xs uppercase tracking-wider",
              tab === k ? "border-b-2 border-brass text-fg" : "text-muted hover:text-fg",
            )}
          >
            {k === "chart" ? "Chart" : "Ticket"}
          </button>
        ))}
      </div>

      {tab === "chart" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-border px-2">
            {(["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setIv(k)}
                className={cn("pressable h-10 px-2.5 font-mono text-xs", interval === k ? "text-fg" : "text-muted hover:text-fg")}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="relative min-h-0 flex-1 bg-chart">
            {status === "load" ? <p className="p-4 text-sm text-muted">Loading {interval}…</p> : null}
            {status === "empty" ? <p className="p-4 text-sm text-muted">No candles. Try 1h.</p> : null}
            {status === "ok" ? <PitChart candles={bars} height={220} interval={interval} /> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-xs">
            <Link
              to="/asset/$symbol"
              params={{ symbol: focus.symbol }}
              search={{
                name: focus.name,
                chain: focus.chain ?? "",
                contract: focus.contract ?? "",
                network: focus.network ?? "",
              }}
              className="pressable text-brass hover:underline"
            >
              Details
            </Link>
            <button className="pressable text-muted hover:text-fg" onClick={() => void shareAsset(focus)}>
              Share
            </button>
          </div>
          <div className="shrink-0 space-y-2 p-3">
            <SideToggle value={side} onChange={setSide} />
            <Button
              variant={side === "buy" ? "up" : "down"}
              className="w-full"
              onClick={() => setTab("trade")}
            >
              Ticket {side}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <OrderTicket prefer={side} />
        </div>
      )}
    </div>
  );
}