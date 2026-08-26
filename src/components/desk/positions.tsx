import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  buyingPower,
  dayPnl,
  equity,
  farmApy,
  farmPending,
  fmtExpiry,
  futLiqPrice,
  futPnl,
  harvestDue,
  groupedFutures,
  groupedOptions,
  liqHealth,
  lpPnl,
  lpValue,
  markOf,
  optMark,
  tokenPx,
  usedMargin,
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
  const openPnl = eq - start;
  const health = liqHealth(s);
  const used = usedMargin(s);
  const avail = buyingPower(s);
  const harvested = s.harvestedWpit ?? 0;
  const minis = groupedFutures(s);
  const vanillas = groupedOptions(s);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-panel">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Positions</h2>
          <Button size="sm" variant="ghost" onClick={() => void nav({ to: "/orders" })}>
            Fills
          </Button>
        </div>
        <p className="mt-1 font-display text-2xl leading-none tabular-nums">{fmtUsd(eq)}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
          <Stat k="P/L Day" v={signed(day)} tone={day} />
          <Stat k="P/L Open" v={signed(openPnl)} tone={openPnl} />
          <Stat k="Net Liq" v={fmtUsd(eq)} />
          <Stat k="Available $" v={fmtUsd(avail)} />
          <Stat k="Margin" v={fmtUsd(used)} />
          <Stat k="Health" v={health.label} tone={health.tone === "down" ? -1 : health.tone === "warn" ? 0 : 1} />
        </dl>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 border-b border-border bg-elevated px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-subtle">
          <span>Symbol</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Mark</span>
          <span className="text-right">P/L Open</span>
        </div>

        <Sec title="Holdings">
          <Hold k="USDC" qty={s.account.usdc} mark={1} />
          <Hold k="ETH" qty={s.account.eth} mark={s.eth} />
          <Hold k="WPIT" qty={s.account.wpit} mark={s.wpit} />
          {Object.entries(s.account.tokens ?? {}).map(([sym, qty]) =>
            Math.abs(qty) > 1e-8 ? <Hold key={sym} k={sym} qty={qty} mark={tokenPx(s, sym)} /> : null,
          )}
        </Sec>

        <Sec title="Minis">
          {minis.length === 0 ? <Empty>No minis</Empty> : null}
          {minis.map((p) => {
            const mark = markOf(s, p.under ?? "ETH");
            const pnlP = futPnl(p, mark);
            const qty = p.side === "long" ? p.sizeEth : -p.sizeEth;
            return (
              <PosRow
                key={p.id}
                symbol={`${p.under ?? "ETH"} mini ${fmtExpiry(p.expiry)}`}
                sub={`${p.side.toUpperCase()} · liq ${fmtPx(futLiqPrice(p))} · IM ${fmtUsd(p.margin)}`}
                qty={qty}
                mark={mark}
                pnl={pnlP}
                tone={p.side === "long" ? "up" : "down"}
                onClose={() => closeFut(p.id)}
              />
            );
          })}
        </Sec>

        <Sec title="Options">
          {vanillas.length === 0 ? <Empty>No vanillas</Empty> : null}
          {vanillas.map((p) => {
            const mid = optMark(s, p);
            const pnlP = (mid - p.premium) * p.sizeEth;
            return (
              <PosRow
                key={p.id}
                symbol={`${p.under ?? "ETH"} ${fmtPx(p.strike)} ${p.type.toUpperCase()}`}
                sub={`paid ${fmtPx(p.premium)} · ${fmtExpiry(p.expiry)}`}
                qty={p.sizeEth}
                mark={mid}
                pnl={pnlP}
                onClose={() => closeOpt(p.id)}
              />
            );
          })}
        </Sec>

        <Sec title="Farms · LP">
          {s.lp.length === 0 ? <Empty>No LP</Empty> : null}
          {s.lp.map((p) => {
            const val = lpValue(s, p.poolId, p.shares);
            const pnlP = lpPnl(s, p);
            const pending = farmPending(s, p.poolId);
            const mark = p.shares > 0 ? val / p.shares : 0;
            return (
              <PosRow
                key={p.poolId}
                symbol={p.poolId.replace("-TEST", "")}
                sub={`${fmtPct(farmApy(s, p.poolId))} APY · ripe ${pending.toFixed(2)} WPIT`}
                qty={p.shares}
                mark={mark}
                pnl={pnlP}
                onClose={() => lpRemove(p.poolId, p.shares)}
                closeLabel="Remove"
              />
            );
          })}
          <div className="flex items-center justify-between px-3 py-2 font-mono text-[11px]">
            <span className="text-muted">
              Harvested {harvested.toFixed(1)} WPIT · ripe {harvestDue(s).toFixed(2)}
            </span>
            <button type="button" className="text-brass disabled:text-subtle" disabled={harvestDue(s) <= 0} onClick={() => harvest()}>
              Harvest
            </button>
          </div>
        </Sec>

        <Sec title="Stake">
          {s.stake.amount <= 0 ? (
            <Empty>None staked</Empty>
          ) : (
            <PosRow
              symbol="WPIT stake"
              sub={`${(STAKE_APR * 100).toFixed(0)}% APR`}
              qty={s.stake.amount}
              mark={s.wpit}
              pnl={0}
              onClose={() => unstake()}
              closeLabel="Unstake"
            />
          )}
        </Sec>
      </div>
    </aside>
  );
}

function Hold({ k, qty, mark }: { k: string; qty: number; mark: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 px-3 py-1.5 font-mono text-[11px]">
      <span>{k}</span>
      <span className="text-right tabular-nums">{qty.toPrecision(4)}</span>
      <span className="text-right tabular-nums text-muted">{fmtPx(mark)}</span>
      <span className="w-[4.6rem] text-right tabular-nums text-subtle">{fmtUsd(qty * mark)}</span>
    </div>
  );
}

function PosRow({
  symbol,
  sub,
  qty,
  mark,
  pnl,
  tone,
  onClose,
  closeLabel = "Close",
}: {
  symbol: string;
  sub: string;
  qty: number;
  mark: number;
  pnl: number;
  tone?: "up" | "down";
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="border-t border-border/60 px-3 py-1.5">
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 font-mono text-[11px]">
        <span className={cn("truncate uppercase", tone === "up" && "text-up", tone === "down" && "text-down")}>{symbol}</span>
        <span className={cn("text-right tabular-nums", qty >= 0 ? "text-up" : "text-down")}>
          {qty >= 0 ? "+" : ""}
          {qty.toPrecision(4)}
        </span>
        <span className="text-right tabular-nums">{fmtPx(mark)}</span>
        <span className={cn("w-[4.6rem] text-right tabular-nums", pnl >= 0 ? "text-up" : "text-down")}>{signed(pnl)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="font-mono text-[10px] text-subtle">{sub}</span>
        <button type="button" className="pressable text-[11px] text-brass" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: number }) {
  const cls =
    tone === undefined ? "text-fg" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-warn";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-subtle">{k}</dt>
      <dd className={cn("tabular-nums", cls)}>{v}</dd>
    </div>
  );
}

function signed(n: number) {
  return `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;
}

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <h3 className="px-3 pt-2 font-mono text-[10px] uppercase tracking-wider text-brass">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-[11px] text-muted">{children}</p>;
}
