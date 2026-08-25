import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AccountBar } from "@/components/desk/account-bar";
import { Blotter } from "@/components/desk/blotter";
import { PitChart } from "@/components/desk/chart";
import { OptionChain } from "@/components/desk/option-chain";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Watchlist } from "@/components/desk/watchlist";
import { Button } from "@/components/ui/button";
import { getLiveMarket, type ChartInterval } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx } from "@/lib/utils";
import { chainLabel } from "@/lib/wolfpit/chain";
import { cn } from "@/lib/utils";

type Pane = "watch" | "chart" | "trade" | "pos" | "menu";

export function Desk() {
  const eth = useWolf((s) => s.eth);
  const candles = useWolf((s) => s.candles);
  const iv = useWolf((s) => s.iv);
  const live = useWolf((s) => s.liveSource);
  const liveAt = useWolf((s) => s.liveAt);
  const ch =
    candles.length >= 2
      ? (candles[candles.length - 1]!.c - candles[0]!.c) / candles[0]!.c
      : 0;
  const [pane, setPane] = useState<Pane>("chart");
  const [bottom, setBottom] = useState<"blotter" | "chain">("blotter");
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const [chartBars, setChartBars] = useState<Candle[]>(candles);
  const [sidePref, setSidePref] = useState<"buy" | "sell" | null>(null);

  useEffect(() => {
    if (interval === "1m") {
      setChartBars(candles);
      return;
    }
    let dead = false;
    void getLiveMarket({ data: { interval } })
      .then((f) => {
        if (!dead) setChartBars(f.candles);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [interval, candles]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <AccountBar />
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
        <h1 className="shrink-0 text-sm font-medium">ETH-USD</h1>
        <span className="font-mono text-lg tabular-nums">{fmtPx(eth)}</span>
        <span className={`font-mono text-xs tabular-nums ${ch >= 0 ? "text-up" : "text-down"}`}>{fmtPct(ch)}</span>
        <span className="hidden font-mono text-xs text-muted sm:inline">IV {(iv * 100).toFixed(0)}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider text-brass">
          {liveAt ? live : "Connecting"} · paper · {chainLabel()}
        </span>
      </div>

      <div className="min-h-0 flex-1 lg:hidden">
        {pane === "watch" && <Watchlist />}
        {pane === "chart" && (
          <div className="flex h-full min-h-0 flex-col">
            <IntervalBar interval={interval} setInterval={setInterval} />
            <div className="relative min-h-0 flex-1">
              <PitChart candles={chartBars} height={320} />
              <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2">
                <Button
                  variant="up"
                  onClick={() => {
                    setSidePref("buy");
                    setPane("trade");
                  }}
                >
                  Buy
                </Button>
                <Button
                  variant="down"
                  onClick={() => {
                    setSidePref("sell");
                    setPane("trade");
                  }}
                >
                  Sell
                </Button>
              </div>
            </div>
          </div>
        )}
        {pane === "trade" && <OrderTicket prefer={sidePref} />}
        {pane === "pos" && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex border-b border-border">
              <button
                className={cn("h-11 flex-1 text-xs uppercase tracking-wider", bottom === "blotter" ? "border-b border-accent text-fg" : "text-muted")}
                onClick={() => setBottom("blotter")}
              >
                Positions
              </button>
              <button
                className={cn("h-11 flex-1 text-xs uppercase tracking-wider", bottom === "chain" ? "border-b border-accent text-fg" : "text-muted")}
                onClick={() => setBottom("chain")}
              >
                Chain
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{bottom === "blotter" ? <Blotter /> : <OptionChain />}</div>
          </div>
        )}
        {pane === "menu" && <DeskMenu />}
      </div>

      <nav className="grid grid-cols-5 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden">
        {(["watch", "chart", "trade", "pos", "menu"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setPane(k)}
            className={cn("flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider", pane === k ? "text-fg" : "text-muted")}
          >
            {k === "watch" ? "Quotes" : k === "chart" ? "Chart" : k === "trade" ? "Trade" : k === "pos" ? "Positions" : "More"}
          </button>
        ))}
      </nav>

      <div className="hidden min-h-0 flex-1 lg:block">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize="18%" minSize="14%" maxSize="28%" className="h-full overflow-hidden">
            <Watchlist />
          </Panel>
          <Separator className="w-px bg-border" />
          <Panel defaultSize="56%" minSize="36%">
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize="62%" minSize="36%" className="h-full overflow-hidden">
                <IntervalBar interval={interval} setInterval={setInterval} />
                <PitChart candles={chartBars} height={280} />
              </Panel>
              <Separator className="h-px bg-border" />
              <Panel defaultSize="38%" minSize="24%">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex border-b border-border">
                    <button
                      className={cn("h-11 px-4 text-xs uppercase tracking-wider", bottom === "blotter" ? "border-b border-accent text-fg" : "text-muted")}
                      onClick={() => setBottom("blotter")}
                    >
                      Positions
                    </button>
                    <button
                      className={cn("h-11 px-4 text-xs uppercase tracking-wider", bottom === "chain" ? "border-b border-accent text-fg" : "text-muted")}
                      onClick={() => setBottom("chain")}
                    >
                      Option chain
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">{bottom === "blotter" ? <Blotter /> : <OptionChain />}</div>
                </div>
              </Panel>
            </Group>
          </Panel>
          <Separator className="w-px bg-border" />
          <Panel defaultSize="26%" minSize="20%" maxSize="36%">
            <OrderTicket prefer={sidePref} />
          </Panel>
        </Group>
      </div>
    </div>
  );
}

function IntervalBar({ interval, setInterval }: { interval: ChartInterval; setInterval: (v: ChartInterval) => void }) {
  return (
    <div className="flex gap-1 border-b border-border px-2">
      {(["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
        <button
          key={k}
          onClick={() => setInterval(k)}
          className={cn("h-10 px-2 font-mono text-[11px]", interval === k ? "text-fg" : "text-muted")}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function DeskMenu() {
  const reset = useWolf((s) => s.reset);
  const src = useWolf((s) => s.liveSource);
  return (
    <div className="space-y-2 p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-brass">Live {src || "—"} · paper funds</p>
      <Link to="/pools" className="block rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        Pools
      </Link>
      <Link to="/stake" className="block rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        Stake
      </Link>
      <Link to="/plan" className="block rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        Plan
      </Link>
      <Link to="/admin" className="block rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        Ops
      </Link>
      <Button variant="outline" className="w-full" onClick={reset}>
        Reset paper
      </Button>
    </div>
  );
}
