import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountBar } from "@/components/desk/account-bar";
import { ChartCard } from "@/components/desk/chart";
import { MiniTape } from "@/components/desk/mini-tape";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Positions } from "@/components/desk/positions";
import { Watchlist } from "@/components/desk/watchlist";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { BAR_MS, dayPnl, equity, liqHealth, markOf, synthCandles, usedMargin } from "@/lib/wolfpit/engine";
import { loadSymbolCandles, type ChartInterval } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

type Tab = "list" | "trade" | "pos";

export function Desk({ seed, pane }: { seed?: string; pane?: Tab }) {
  const nav = useNavigate();
  const s = useWolf();
  const focus = useDesk((d) => d.focus);
  const saved = useDesk((d) => d.saved);
  const toggleSave = useDesk((d) => d.toggleSave);
  const [tab, setTab] = useState<Tab>(pane ?? (seed ? "trade" : "list"));
  const view = pane ?? tab;
  const [prefer, setPrefer] = useState<"buy" | "sell" | null>(null);
  const [want, setWant] = useState<"spot" | "future" | "option" | null>(null);
  const [interval, setIv] = useState<ChartInterval>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");

  useEffect(() => {
    if (!seed) return;
    const sym = seed.toUpperCase();
    const hit = useDesk.getState().universe.find((u) => u.symbol === sym);
    useDesk.getState().setFocus(
      hit ?? { symbol: sym, name: sym, price: 0, change24: 0, volume24: 0 },
    );
    setTab("trade");
  }, [seed]);

  useEffect(() => {
    const listing = useDesk.getState().focus;
    const ms = BAR_MS[interval];
    const px = listing.symbol === "WPIT" ? useWolf.getState().wpit : listing.price || useWolf.getState().eth;
    const seed = listing.symbol.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    if (listing.symbol === "WPIT") {
      const live = synthCandles(px || 0.01, ms, Date.now(), seed, true);
      live[live.length - 1]!.c = px;
      live[live.length - 1]!.h = Math.max(live[live.length - 1]!.h, px);
      live[live.length - 1]!.l = Math.min(live[live.length - 1]!.l, px);
      setBars(live);
      setStatus("ok");
      return;
    }
    let dead = false;
    setStatus("load");
    void loadSymbolCandles({
      symbol: listing.symbol,
      interval,
      binance: listing.binance,
      geckoId: listing.geckoId,
      network: listing.network,
      poolAddress: listing.poolAddress,
    }).then((rows) => {
      if (dead) return;
      if (rows.length >= 8) {
        setBars(rows);
        setStatus("ok");
        return;
      }
      setBars(synthCandles(px || 1, ms, Date.now(), seed, false));
      setStatus("ok");
    });
    return () => {
      dead = true;
    };
  }, [focus.symbol, focus.binance, focus.geckoId, focus.network, focus.poolAddress, interval, focus.price]);

  function pick(l: Listing) {
    useDesk.getState().setFocus(l);
    useWolf.getState().listToken(l.symbol, l.price || 1);
    setPrefer(null);
    setTab("trade");
  }

  const eq = equity(s);
  const day = dayPnl(s);
  const health = liqHealth(s);
  const used = usedMargin(s);
  const under = focus.symbol === "USDC" ? "ETH" : focus.symbol.toUpperCase();
  const spot = markOf(s, under) || focus.price || 0;
  const bid = under === "ETH" ? s.ethBid || spot : spot * 0.9992;
  const ask = under === "ETH" ? s.ethAsk || spot : spot * 1.0008;
  const chg = focus.change24;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="hidden lg:block">
        <AccountBar />
      </div>
      <div className="flex h-9 items-center justify-between gap-3 border-b border-border px-3 lg:hidden">
        <span className="font-mono text-[11px] text-muted">
          Net {fmtUsd(eq)}
        </span>
        <span className={cn("font-mono text-[11px]", day >= 0 ? "text-up" : "text-down")}>
          Day {day >= 0 ? "+" : "−"}
          {fmtUsd(Math.abs(day))}
        </span>
        <span className={cn("font-mono text-[11px]", health.tone === "up" ? "text-up" : health.tone === "down" ? "text-down" : "text-warn")}>
          {health.label}
        </span>
      </div>
      {!pane ? (
        <div className="flex border-b border-border lg:hidden">
          {(["list", "trade", "pos"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "pressable h-11 flex-1 text-[11px] uppercase tracking-wider",
                tab === t ? "border-b border-brass text-brass" : "text-muted",
              )}
            >
              {t === "list" ? "Watchlist" : t === "trade" ? "Trade" : "Positions"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[16.5rem_minmax(0,1fr)_16.5rem]">
        <aside className={cn("min-h-0 overflow-hidden border-r border-border", view === "list" ? "block" : "hidden lg:block")}>
          <div className="border-b border-border px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">Account</p>
            <p className="font-display text-2xl leading-none">{fmtUsd(eq)}</p>
            <p className={cn("mt-1 font-mono text-[11px]", day >= 0 ? "text-up" : "text-down")}>
              Day {day >= 0 ? "+" : "−"}
              {fmtUsd(Math.abs(day))}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-muted">
              <dt>Cash</dt>
              <dd className="text-right text-fg">{fmtUsd(s.account.usdc)}</dd>
              <dt>Margin used</dt>
              <dd className="text-right text-fg">{fmtUsd(used)}</dd>
              <dt>Liq health</dt>
              <dd className={cn("text-right", health.tone === "up" ? "text-up" : health.tone === "down" ? "text-down" : "text-warn")}>
                {health.label}
              </dd>
            </dl>
          </div>
          <div className="h-[calc(100%-7.5rem)] min-h-0">
            <Watchlist onPick={pick} />
          </div>
        </aside>

        <section className={cn("flex min-h-0 flex-col overflow-y-auto overscroll-y-contain lg:overflow-hidden", view === "trade" ? "flex" : "hidden lg:flex")}>
          <div className="shrink-0 border-b border-border px-3 py-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    className={cn("pressable text-lg leading-none", saved.includes(under) ? "text-brass" : "text-subtle")}
                    onClick={() => toggleSave(under)}
                    aria-label="Save to watchlist"
                  >
                    {saved.includes(under) ? "★" : "☆"}
                  </button>
                  <h1 className="font-display text-xl font-medium leading-none">{under}</h1>
                  <span className={cn("font-mono text-lg tabular-nums", chg >= 0 ? "text-up" : "text-down")}>
                    {spot ? fmtPx(spot) : "—"}
                  </span>
                  <span className={cn("font-mono text-[11px]", chg >= 0 ? "text-up" : "text-down")}>{fmtPct(chg)}</span>
                </div>
                <p className="truncate text-[11px] text-muted">{focus.name}</p>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="pressable h-10 min-w-[4.5rem] rounded-[var(--radius-sm)] bg-down px-3 text-center text-fg"
                  onClick={() => {
                    setPrefer("sell");
                    setWant("spot");
                    setTab("trade");
                  }}
                >
                  <div className="text-[9px] uppercase tracking-wider">Sell</div>
                  <div className="font-mono text-xs leading-none">{spot ? fmtPx(bid) : "—"}</div>
                </button>
                <button
                  type="button"
                  className="pressable h-10 min-w-[4.5rem] rounded-[var(--radius-sm)] bg-up px-3 text-center text-bg"
                  onClick={() => {
                    setPrefer("buy");
                    setWant("spot");
                    setTab("trade");
                  }}
                >
                  <div className="text-[9px] uppercase tracking-wider">Buy</div>
                  <div className="font-mono text-xs leading-none">{spot ? fmtPx(ask) : "—"}</div>
                </button>
              </div>
            </div>
          </div>
          <MiniTape onPick={pick} />
          <div className="shrink-0 p-3">
            <ChartCard
              symbol={under}
              name={focus.name}
              price={spot}
              changePct={chg}
              candles={bars}
              interval={interval}
              status={status}
              onInterval={setIv}
              height={240}
            />
          </div>
          <div className="min-h-[14rem] flex-1 lg:min-h-0">
            <OrderTicket prefer={prefer} under={under} want={want} />
          </div>
        </section>

        <div className={cn("min-h-0", view === "pos" ? "block" : "hidden lg:block")}>
          <Positions />
        </div>
      </div>
    </div>
  );
}