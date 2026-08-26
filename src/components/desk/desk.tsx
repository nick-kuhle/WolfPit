import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AccountBar } from "@/components/desk/account-bar";
import { ChartPane } from "@/components/desk/chart";
import { Watchlist } from "@/components/desk/watchlist";
import { Button } from "@/components/ui/button";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import {
  dayPnl,
  equity,
  farmApy,
  fmtExpiry,
  futLiqPrice,
  futPnl,
  liqHealth,
  lpValue,
  tokenPx,
  usedMargin,
} from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { assetSearch } from "@/lib/wolfpit/share";
import { cn, fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export function Desk() {
  const nav = useNavigate();
  const s = useWolf();
  const [wide, setWide] = useState(false);
  const eq = equity(s);
  const day = dayPnl(s);
  const health = liqHealth(s);
  const used = usedMargin(s);
  const farmUsd = s.farmWpit * s.wpit;
  const stakeUsd = s.stake.amount * s.wpit;
  const tape = (s.equityTape ?? []).length >= 2 ? s.equityTape : [{ t: s.clock, o: eq, h: eq, l: eq, c: eq, v: 1 }];
  const universe = useDesk((d) => d.universe);

  function openAsset(l: Listing) {
    useDesk.getState().setFocus(l);
    useWolf.getState().listToken(l.symbol, l.price || 1);
    void nav({
      to: "/asset/$symbol",
      params: { symbol: l.symbol },
      search: assetSearch(l),
    });
  }

  const holdings: { sym: string; qty: number; px: number }[] = [
    { sym: "USDC", qty: s.account.usdc, px: 1 },
    { sym: "ETH", qty: s.account.eth, px: s.eth },
    { sym: "WPIT", qty: s.account.wpit, px: s.wpit },
    ...Object.entries(s.account.tokens ?? {}).map(([sym, qty]) => {
      const live = universe.find((u) => u.symbol === sym);
      return { sym, qty, px: live?.price || tokenPx(s, sym) };
    }),
  ].filter((h) => Math.abs(h.qty) > 1e-8);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <AccountBar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="ticket-card overflow-hidden rounded-[var(--radius-xl)] border border-brass/40 bg-panel">
            <div className="flex items-end justify-between px-4 pt-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brass">Book · live</p>
                <h1 className="font-display text-3xl font-medium">{fmtUsd(eq)}</h1>
              </div>
              <div className={`font-mono text-sm ${day >= 0 ? "text-up" : "text-down"}`}>
                day {day >= 0 ? "+" : "−"}
                {fmtUsd(Math.abs(day))}
              </div>
            </div>
            <div className="px-3 pb-2 pt-3">
              <ChartPane
                candles={tape}
                interval="1h"
                expanded={wide}
                onToggle={() => setWide((v) => !v)}
                compact={128}
              />
            </div>
          </section>

          <aside className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <StatTile k="Cash" v={fmtUsd(s.account.usdc)} tone="ticket" />
            <StatTile k="Margin" v={fmtUsd(used)} sub={`${fmtUsd(s.account.usdc)} free`} />
            <StatTile k="Liq health" v={health.label} tone={health.tone} sub={`${health.score.toFixed(2)}× maint`} />
            <StatTile k="Day P/L" v={`${day >= 0 ? "+" : "−"}${fmtUsd(Math.abs(day))}`} tone={day >= 0 ? "up" : "down"} />
            <StatTile k="Farm ripe" v={`${s.farmWpit.toFixed(1)} WPIT`} sub={fmtUsd(farmUsd)} />
            <StatTile k="Staked" v={`${s.stake.amount.toFixed(0)} WPIT`} sub={`${(STAKE_APR * 100).toFixed(0)}% · ${fmtUsd(stakeUsd)}`} />
          </aside>
        </div>

        <section className="px-3 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-xl">Holdings</h2>
            <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">tap a ticket</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {holdings.map((h) => (
              <button
                key={h.sym}
                onClick={() =>
                  openAsset({
                    symbol: h.sym,
                    name: h.sym,
                    price: h.px,
                    change24: 0,
                    volume24: 0,
                    chain: h.sym === "WPIT" ? "Base" : "",
                  })
                }
                className="pressable ticket-card rounded-[var(--radius-lg)] border border-border bg-elevated p-3 text-left hover:border-brass"
              >
                <div className="font-mono text-[11px] text-brass">{h.sym}</div>
                <div className="mt-1 font-display text-2xl leading-none">{h.qty >= 1000 ? h.qty.toFixed(0) : h.qty.toPrecision(4)}</div>
                <div className="mt-1 font-mono text-xs text-muted">{fmtUsd(h.qty * h.px)}</div>
              </button>
            ))}
          </div>
        </section>

        {s.futures.length > 0 ? (
          <section className="px-3 pb-3">
            <h2 className="mb-2 font-display text-xl">Minis</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {s.futures.map((p) => {
                const pnl = futPnl(p, s.eth);
                return (
                  <div key={p.id} className="ticket-card rounded-[var(--radius-lg)] border border-border bg-panel p-3">
                    <div className="flex justify-between">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${p.side === "long" ? "bg-up text-bg" : "bg-down text-fg"}`}>
                        {p.side}
                      </span>
                      <span className={`font-mono text-sm ${pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pnl)}</span>
                    </div>
                    <div className="mt-2 font-display text-lg">{p.sizeEth} ETH</div>
                    <div className="font-mono text-[11px] text-muted">
                      {fmtPx(p.entry)} → {fmtPx(s.eth)} · liq {fmtPx(futLiqPrice(p))}
                    </div>
                    <div className="font-mono text-[10px] text-subtle">{fmtExpiry(p.expiry)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {s.lp.length > 0 ? (
          <section className="px-3 pb-3">
            <h2 className="mb-2 font-display text-xl">Farms</h2>
            <div className="flex flex-wrap gap-2">
              {s.lp.map((p) => (
                <div key={p.poolId} className="rounded-full border border-brass/40 bg-elevated px-4 py-2">
                  <span className="font-mono text-xs">{p.poolId.replace("-TEST", "")}</span>
                  <span className="ml-2 text-brass">{fmtUsd(lpValue(s, p.poolId, p.shares))}</span>
                  <span className="ml-2 text-[10px] text-muted">{fmtPct(farmApy(s, p.poolId))}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="border-t border-border">
          <div className="flex items-center justify-between px-3 py-2">
            <h2 className="font-display text-xl">Watchlist</h2>
            <Button size="sm" variant="outline" onClick={() => void nav({ to: "/orders" })}>
              Fills
            </Button>
          </div>
          <div className="h-[min(50vh,28rem)]">
            <Watchlist onPick={openAsset} />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatTile({
  k,
  v,
  sub,
  tone,
}: {
  k: string;
  v: string;
  sub?: string;
  tone?: "up" | "down" | "warn" | "ticket";
}) {
  return (
    <div
      className={cn(
        "ticket-card rounded-[var(--radius-lg)] border p-3",
        tone === "up" && "border-up/50 bg-up/10",
        tone === "down" && "border-down/50 bg-down/10",
        tone === "warn" && "border-warn/50 bg-warn/10",
        tone === "ticket" && "border-brass bg-brass/15",
        !tone && "border-border bg-elevated",
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">{k}</div>
      <div className="mt-1 font-display text-xl leading-tight">{v}</div>
      {sub ? <div className="mt-1 font-mono text-[10px] text-muted">{sub}</div> : null}
    </div>
  );
}
