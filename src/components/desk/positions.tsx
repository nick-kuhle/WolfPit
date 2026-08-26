import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  dayPnl,
  equity,
  farmApy,
  farmPending,
  fmtExpiry,
  futLiqPrice,
  futPnl,
  lpPnl,
  lpValue,
  markOf,
  optionQuote,
  tokenPx,
} from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export function Positions() {
  const nav = useNavigate();
  const s = useWolf();
  const closeFut = useWolf((st) => st.closeFut);
  const closeOpt = useWolf((st) => st.closeOpt);
  const lpRemove = useWolf((st) => st.lpRemove);
  const unstake = useWolf((st) => st.unstake);
  const harvest = useWolf((st) => st.harvest);
  const eq = equity(s);
  const day = dayPnl(s);
  const start = s.account.startEquity || eq;
  const pnl = eq - start;
  const harvested = s.harvestedWpit ?? 0;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-panel">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Positions</h2>
          <Button size="sm" variant="ghost" onClick={() => void nav({ to: "/orders" })}>
            Fills
          </Button>
        </div>
        <p className="mt-1 font-display text-2xl leading-none">{fmtUsd(eq)}</p>
        <p className={cn("mt-1 font-mono text-[11px]", pnl >= 0 ? "text-up" : "text-down")}>
          Book {pnl >= 0 ? "+" : "−"}
          {fmtUsd(Math.abs(pnl))} · day {day >= 0 ? "+" : "−"}
          {fmtUsd(Math.abs(day))}
        </p>
        <p className="font-mono text-[10px] text-muted">Realized {fmtUsd(s.account.realized)}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Sec title="Cash">
          <Row k="USDC" v={fmtUsd(s.account.usdc)} />
          <Row k="ETH" v={`${s.account.eth.toPrecision(4)} · ${fmtUsd(s.account.eth * s.eth)}`} />
          <Row k="WPIT" v={`${s.account.wpit.toFixed(1)} · ${fmtUsd(s.account.wpit * s.wpit)}`} />
          {Object.entries(s.account.tokens ?? {}).map(([sym, qty]) =>
            Math.abs(qty) > 1e-8 ? (
              <Row key={sym} k={sym} v={`${qty.toPrecision(4)} · ${fmtUsd(qty * tokenPx(s, sym))}`} />
            ) : null,
          )}
        </Sec>

        <Sec title="Minis">
          {s.futures.length === 0 ? <Empty>No minis</Empty> : null}
          {s.futures.map((p) => {
            const mark = markOf(s, p.under ?? "ETH");
            const pnlP = futPnl(p, mark);
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => void nav({ to: "/trade" })}
                >
                  <div className={cn("font-mono text-[11px] uppercase", p.side === "long" ? "text-up" : "text-down")}>
                    {p.side} {p.under ?? "ETH"}
                  </div>
                  <div className="font-mono text-[10px] text-muted">
                    {p.sizeEth} · {fmtPx(p.entry)} → {fmtPx(mark)} · liq {fmtPx(futLiqPrice(p))}
                  </div>
                  <div className="font-mono text-[10px] text-subtle">{fmtExpiry(p.expiry)}</div>
                </button>
                <div className="shrink-0 text-right">
                  <div className={cn("font-mono text-xs", pnlP >= 0 ? "text-up" : "text-down")}>{fmtUsd(pnlP)}</div>
                  <button type="button" className="pressable mt-1 text-[11px] text-brass" onClick={() => closeFut(p.id)}>
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </Sec>

        <Sec title="Options">
          {s.options.length === 0 ? <Empty>No vanillas</Empty> : null}
          {s.options.map((p) => {
            const q = optionQuote(s, p.type, p.strike, p.expiry, p.under ?? "ETH");
            const mid = ((q.bid || 0) + (q.ask || 0)) / 2 || p.premium;
            const pnlP = (mid - p.premium) * p.sizeEth;
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-mono text-[11px]">
                    {p.type.toUpperCase()} {p.under ?? "ETH"} {fmtPx(p.strike)}
                  </div>
                  <div className="font-mono text-[10px] text-muted">
                    {p.sizeEth} · paid {fmtPx(p.premium)} · {fmtExpiry(p.expiry)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("font-mono text-xs", pnlP >= 0 ? "text-up" : "text-down")}>{fmtUsd(pnlP)}</div>
                  <button type="button" className="pressable mt-1 text-[11px] text-brass" onClick={() => closeOpt(p.id)}>
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </Sec>

        <Sec title="Farms · LP tokens">
          {s.lp.length === 0 ? <Empty>No LP</Empty> : null}
          {s.lp.map((p) => {
            const val = lpValue(s, p.poolId, p.shares);
            const pnlP = lpPnl(s, p);
            const pending = farmPending(s, p.poolId);
            return (
              <div key={p.poolId} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[11px]">{p.poolId.replace("-TEST", "")}</div>
                    <div className="font-mono text-[10px] text-muted">
                      {p.shares.toPrecision(4)} LP · {fmtUsd(val)} · {fmtPct(farmApy(s, p.poolId))} APY
                    </div>
                    <div className="font-mono text-[10px] text-subtle">
                      Ripe {pending.toFixed(2)} WPIT
                      {p.costUsdc ? ` · cost ${fmtUsd(p.costUsdc)}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-mono text-xs", pnlP >= 0 ? "text-up" : "text-down")}>{fmtUsd(pnlP)}</div>
                    <button
                      type="button"
                      className="pressable mt-1 text-[11px] text-brass"
                      onClick={() => lpRemove(p.poolId, p.shares)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2 font-mono text-[11px]">
            <span className="text-muted">
              Harvested {harvested.toFixed(1)} WPIT · ripe {s.farmWpit.toFixed(2)}
            </span>
            <button type="button" className="text-brass disabled:text-subtle" disabled={s.farmWpit <= 0} onClick={() => harvest()}>
              Harvest
            </button>
          </div>
        </Sec>

        <Sec title="Stake">
          {s.stake.amount <= 0 ? (
            <Empty>None staked</Empty>
          ) : (
            <div className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="font-mono text-[11px]">{s.stake.amount.toFixed(1)} WPIT</div>
                <div className="font-mono text-[10px] text-muted">
                  {fmtUsd(s.stake.amount * s.wpit)} · {(STAKE_APR * 100).toFixed(0)}% APR
                </div>
              </div>
              <button type="button" className="pressable text-[11px] text-brass" onClick={() => unstake()}>
                Unstake
              </button>
            </div>
          )}
        </Sec>
      </div>
    </aside>
  );
}

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <h3 className="px-3 pt-3 font-mono text-[10px] uppercase tracking-wider text-brass">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 font-mono text-[11px]">
      <span className="text-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-[11px] text-subtle">{children}</p>;
}