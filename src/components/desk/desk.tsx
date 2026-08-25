import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AccountBar } from "@/components/desk/account-bar";
import { History } from "@/components/desk/history";
import { PitChart } from "@/components/desk/chart";
import { OptionChain } from "@/components/desk/option-chain";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Portfolio } from "@/components/desk/portfolio";
import { Watchlist } from "@/components/desk/watchlist";
import { Button } from "@/components/ui/button";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { getSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx } from "@/lib/utils";
import { chainLabel } from "@/lib/wolfpit/chain";
import { cn } from "@/lib/utils";

type Pane = "watch" | "chart" | "trade" | "port" | "hist";

export function Desk() {
  const ethCandles = useWolf((s) => s.candles);
  const live = useWolf((s) => s.liveSource);
  const liveAt = useWolf((s) => s.liveAt);
  const focus = useDesk((s) => s.focus);
  const [pane, setPane] = useState<Pane>("watch");
  const [bottom, setBottom] = useState<"port" | "chain">("port");
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const [chartBars, setChartBars] = useState<Candle[]>(ethCandles);
  const [sidePref, setSidePref] = useState<"buy" | "sell" | null>(null);

  const px = focus.price || useWolf.getState().eth;
  const ch = focus.change24;

  useEffect(() => {
    if (focus.symbol === "ETH" && interval === "1m") {
      setChartBars(ethCandles);
      return;
    }
    let dead = false;
    void getSymbolCandles({ data: { symbol: focus.symbol, interval, binance: focus.binance } })
      .then((bars) => {
        if (!dead && bars.length) setChartBars(bars);
        else if (!dead && focus.symbol === "ETH") setChartBars(ethCandles);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [focus.symbol, focus.binance, interval, ethCandles]);

  function openChart(l?: Listing) {
    void l;
    setPane("chart");
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <AccountBar />
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
        <h1 className="shrink-0 text-sm font-medium">
          {focus.symbol}-USD
        </h1>
        <span className="font-mono text-lg tabular-nums">{fmtPx(px)}</span>
        <span className={`font-mono text-xs tabular-nums ${ch >= 0 ? "text-up" : "text-down"}`}>{fmtPct(ch)}</span>
        <span className="hidden truncate text-xs text-muted sm:inline">{focus.name} · {focus.chain}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider text-brass">
          {liveAt ? live : "Connecting"} · paper · {chainLabel()}
        </span>
      </div>

      <div className="min-h-0 flex-1 lg:hidden">
        {pane === "watch" && <Watchlist onPick={() => setPane("chart")} />}
        {pane === "chart" && (
          <div className="flex h-full min-h-0 flex-col">
            <TokenMeta />
            <IntervalBar interval={interval} setInterval={setInterval} />
            <div className="relative min-h-0 flex-1">
              <PitChart candles={chartBars} height={320} />
              <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2">
                <Button
                  variant="up"
                  onClick={() => {
                    setSidePref("buy");
                    setPane("trade");
                    ping("Buy ticket", "up");
                  }}
                >
                  Buy
                </Button>
                <Button
                  variant="down"
                  onClick={() => {
                    setSidePref("sell");
                    setPane("trade");
                    ping("Sell ticket", "down");
                  }}
                >
                  Sell
                </Button>
              </div>
            </div>
          </div>
        )}
        {pane === "trade" && <OrderTicket prefer={sidePref} />}
        {pane === "port" && <Portfolio onPick={() => setPane("chart")} />}
        {pane === "hist" && <History />}
      </div>

      <nav className="grid grid-cols-5 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden">
        {(["watch", "chart", "trade", "port", "hist"] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setPane(k);
              ping(k === "watch" ? "Board" : k === "port" ? "Wallet" : k === "hist" ? "History" : k, "brass");
            }}
            className={cn(
              "flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider",
              pane === k ? "text-fg" : "text-muted",
            )}
          >
            {k === "watch" ? "Board" : k === "chart" ? "Chart" : k === "trade" ? "Trade" : k === "port" ? "Wallet" : "History"}
          </button>
        ))}
      </nav>

      <div className="hidden min-h-0 flex-1 lg:block">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize="22%" minSize="16%" maxSize="32%" className="h-full overflow-hidden">
            <Watchlist onPick={openChart} />
          </Panel>
          <Separator className="w-px bg-border" />
          <Panel defaultSize="52%" minSize="36%">
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize="58%" minSize="36%" className="h-full overflow-hidden">
                <TokenMeta />
                <IntervalBar interval={interval} setInterval={setInterval} />
                <PitChart candles={chartBars} height={280} />
              </Panel>
              <Separator className="h-px bg-border" />
              <Panel defaultSize="42%" minSize="24%">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex border-b border-border">
                    {(["port", "chain", "hist"] as const).map((k) => (
                      <button
                        key={k}
                        className={cn(
                          "h-11 px-4 text-xs uppercase tracking-wider",
                          (k === "hist" ? pane === "hist" : bottom === k) ? "border-b border-accent text-fg" : "text-muted",
                        )}
                        onClick={() => {
                          if (k === "hist") setPane("hist");
                          else {
                            setBottom(k);
                            setPane("chart");
                          }
                        }}
                      >
                        {k === "port" ? "Wallet" : k === "chain" ? "Chain" : "History"}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {pane === "hist" ? <History /> : bottom === "port" ? <Portfolio onPick={openChart} /> : <OptionChain />}
                  </div>
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

function TokenMeta() {
  const focus = useDesk((s) => s.focus);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] text-muted">
      <span className="text-fg">{focus.name}</span>
      <span>{focus.chain}</span>
      {focus.contract ? <span className="font-mono">{focus.contract.slice(0, 6)}…{focus.contract.slice(-4)}</span> : null}
      <span className="ml-auto font-mono">Vol {focus.volume24 ? `$${(focus.volume24 / 1e6).toFixed(1)}M` : "—"}</span>
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
