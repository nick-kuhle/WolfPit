import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  miniQty,
  optMark,
  tokenPx,
  usedMargin,
} from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import type { Candle } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtPx, fmtQty, fmtUsd } from "@/lib/utils";

const COLS = "grid grid-cols-[minmax(0,1fr)_5.1rem_4.6rem_5.4rem] items-baseline gap-x-2 px-3";

export function Positions({ flush }: { flush?: boolean }) {
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
  const ripe = harvestDue(s);
  const minis = groupedFutures(s);
  const vanillas = groupedOptions(s);
  const extras = Object.entries(s.account.tokens ?? {}).filter(([, q]) => Math.abs(q) > 1e-8);
  const holdings = [
    { k: "USDC", qty: s.account.usdc, mark: 1 },
    { k: "ETH", qty: s.account.eth, mark: s.eth },
    { k: "WPIT", qty: s.account.wpit, mark: s.wpit },
    ...extras.map(([k, qty]) => ({ k, qty, mark: tokenPx(s, k) })),
  ].filter((h) => h.k === "USDC" || Math.abs(h.qty) > 1e-6);

  return (
    <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-panel", !flush && "border-l border-border")}>
      <header className="shrink-0 border-b border-border px-3 pb-3 pt-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg leading-none">Positions</h2>
          <button
            type="button"
            className="pressable h-8 px-2 font-mono text-[11px] uppercase tracking-wider text-muted hover:text-brass"
            onClick={() => void nav({ to: "/orders" })}
          >
            Fills
          </button>
        </div>

        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_8.5rem] items-end gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">Net liq</div>
            <p className="font-display text-[2rem] leading-none tabular-nums">{fmtUsd(eq)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
              <Chip label="Open" n={openPnl} />
              <Chip label="Day" n={day} />
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  health.tone === "up" && "bg-up/15 text-up",
                  health.tone === "down" && "bg-down/15 text-down",
                  health.tone === "warn" && "bg-warn/15 text-warn",
                )}
              >
                {health.label}
              </span>
            </div>
          </div>
          <EquitySpark tape={s.equityTape ?? []} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric k="Available" v={fmtUsd(avail)} />
          <Metric k="Margin" v={fmtUsd(used)} />
          <Metric k="Health" v={health.label} tone={health.tone} className="hidden sm:flex" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn(COLS, "sticky top-0 z-10 border-b border-border bg-elevated py-1.5 font-mono text-[9px] uppercase tracking-wider text-subtle")}>
          <span>Symbol</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Mark</span>
          <span className="text-right">P/L</span>
        </div>

        <Sec title="Holdings">
          {holdings.map((h) => (
            <div key={h.k} className={cn(COLS, "h-9 font-mono text-[12px]")}>
              <span className="truncate font-medium">{h.k}</span>
              <span className="text-right tabular-nums">{fmtQty(h.qty)}</span>
              <span className="text-right tabular-nums text-muted">{fmtPx(h.mark)}</span>
              <span className="text-right tabular-nums">{fmtUsd(h.qty * h.mark)}</span>
            </div>
          ))}
        </Sec>

        <Sec title="Minis" count={minis.length}>
          {minis.length === 0 ? <Empty>No open minis</Empty> : null}
          {minis.map((p) => {
            const under = p.under ?? "ETH";
            const mark = markOf(s, under);
            const pnlP = futPnl(p, mark);
            const unit = miniQty(under);
            const contracts = unit > 0 ? p.sizeEth / unit : p.sizeEth;
            const qty = p.side === "long" ? contracts : -contracts;
            return (
              <PosRow
                key={p.id}
                symbol={`${under} Mini`}
                sub={`${p.side.toUpperCase()} · ${shortExp(p.expiry)} · liq ${fmtPx(futLiqPrice(p))}`}
                qty={qty}
                mark={mark}
                pnl={pnlP}
                long={p.side === "long"}
                onClose={() => closeFut(p.id)}
              />
            );
          })}
        </Sec>

        <Sec title="Options" count={vanillas.length}>
          {vanillas.length === 0 ? <Empty>No open vanillas</Empty> : null}
          {vanillas.map((p) => {
            const under = p.under ?? "ETH";
            const mid = optMark(s, p);
            const pnlP = (mid - p.premium) * p.sizeEth;
            const unit = miniQty(under);
            const contracts = unit > 0 ? p.sizeEth / unit : p.sizeEth;
            return (
              <PosRow
                key={p.id}
                symbol={`${under} ${fmtPx(p.strike)} ${p.type === "call" ? "C" : "P"}`}
                sub={`${shortExp(p.expiry)} · paid ${fmtPx(p.premium)}`}
                qty={contracts}
                mark={mid}
                pnl={pnlP}
                onClose={() => closeOpt(p.id)}
              />
            );
          })}
        </Sec>

        {s.lp.length > 0 ? (
          <Sec title="Farms">
            {s.lp.map((p) => {
              const val = lpValue(s, p.poolId, p.shares);
              const pending = farmPending(s, p.poolId);
              return (
                <PosRow
                  key={p.poolId}
                  symbol={p.poolId.replace("-TEST", "")}
                  sub={`${fmtPct(farmApy(s, p.poolId))} APY · ripe ${fmtQty(pending)} WPIT`}
                  qty={p.shares}
                  mark={p.shares > 0 ? val / p.shares : 0}
                  pnl={lpPnl(s, p)}
                  onClose={() => lpRemove(p.poolId, p.shares)}
                  closeLabel="Remove"
                />
              );
            })}
            <div className="flex items-center justify-between px-3 py-2 font-mono text-[11px]">
              <span className="text-muted">Ripe {fmtQty(ripe)} WPIT</span>
              <button type="button" className="text-brass disabled:text-subtle" disabled={ripe <= 0} onClick={() => harvest()}>
                Harvest
              </button>
            </div>
          </Sec>
        ) : null}

        {s.stake.amount > 0 ? (
          <Sec title="Stake">
            <PosRow
              symbol="WPIT"
              sub={`${(STAKE_APR * 100).toFixed(0)}% APR junior`}
              qty={s.stake.amount}
              mark={s.wpit}
              pnl={0}
              onClose={() => unstake()}
              closeLabel="Unstake"
            />
          </Sec>
        ) : null}
      </div>
    </aside>
  );
}

function PosRow({
  symbol,
  sub,
  qty,
  mark,
  pnl,
  long,
  onClose,
  closeLabel = "Close",
}: {
  symbol: string;
  sub: string;
  qty: number;
  mark: number;
  pnl: number;
  long?: boolean;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="border-t border-border/50 py-2">
      <div className={cn(COLS, "font-mono text-[12px]")}>
        <span className={cn("truncate font-medium", long === true && "text-up", long === false && "text-down")}>{symbol}</span>
        <span className={cn("text-right tabular-nums", qty >= 0 ? "text-up" : "text-down")}>{fmtQty(qty, true)}</span>
        <span className="text-right tabular-nums text-muted">{fmtPx(mark)}</span>
        <span className={cn("text-right tabular-nums", pnl >= 0 ? "text-up" : "text-down")}>{signed(pnl)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between px-3">
        <span className="truncate font-mono text-[10px] text-subtle">{sub}</span>
        <button type="button" className="pressable shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass hover:bg-brass/15" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

function EquitySpark({ tape }: { tape: Candle[] }) {
  const pts = tape.slice(-96);
  if (pts.length < 2) {
    return <div className="h-14 rounded-md border border-border bg-elevated" />;
  }
  const ys = pts.map((c) => c.c);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.01, 1);
  const w = 160;
  const h = 56;
  const pad = 3;
  const line = pts
    .map((c, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - pad - ((c.c - lo) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const lastY = h - pad - ((pts[pts.length - 1]!.c - lo) / span) * (h - pad * 2);
  const up = pts[pts.length - 1]!.c >= pts[0]!.c;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full overflow-visible" preserveAspectRatio="none" aria-label="Equity history">
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={lastY} r="2.2" fill={color} />
    </svg>
  );
}

function Chip({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-subtle">{label}</span>
      <span className={cn("tabular-nums", n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted")}>{signed(n)}</span>
    </span>
  );
}

function Metric({ k, v, tone, className }: { k: string; v: string; tone?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-md border border-border bg-elevated px-2.5 py-1.5", className)}>
      <span className="font-mono text-[9px] uppercase tracking-wider text-subtle">{k}</span>
      <span
        className={cn(
          "font-mono text-[12px] tabular-nums",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "warn" && "text-warn",
        )}
      >
        {v}
      </span>
    </div>
  );
}

function Sec({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <h3 className="flex items-center gap-2 px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
        {title}
        {typeof count === "number" ? <span className="text-subtle">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-3 text-[11px] text-muted">{children}</p>;
}

function signed(n: number) {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "$0.00";
  return `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;
}

function shortExp(at: number) {
  const full = fmtExpiry(at);
  const parts = full.split(" ");
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : full;
}
