import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import type { Candle, PoolId } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtPx, fmtQty, fmtUsd } from "@/lib/utils";
import { fracOdds, openTickets } from "@/lib/wolfpit/games";

const COLS = "grid grid-cols-[minmax(0,1fr)_5.1rem_4.6rem_5.4rem] items-baseline gap-x-2 px-3";

type Pending = {
  title: string;
  hint: string;
  rows: { k: string; v: string }[];
  confirm: string;
  tone?: "up" | "down" | "brass";
  run: () => void;
};

export function Positions({ flush }: { flush?: boolean }) {
  const nav = useNavigate();
  const s = useWolf();
  const closeFut = useWolf((st) => st.closeFut);
  const closeOpt = useWolf((st) => st.closeOpt);
  const lpRemove = useWolf((st) => st.lpRemove);
  const unstake = useWolf((st) => st.unstake);
  const harvest = useWolf((st) => st.harvest);
  const sellSpot = useWolf((st) => st.sellSpot);
  const buySpot = useWolf((st) => st.buySpot);
  const [pending, setPending] = useState<Pending | null>(null);
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
            <div key={h.k} className="border-t border-border/50 py-2 first:border-t-0">
              <div className={cn(COLS, "font-mono text-[12px]")}>
                <span className="truncate font-medium">{h.k}</span>
                <span className="text-right tabular-nums">{fmtQty(h.qty)}</span>
                <span className="text-right tabular-nums text-muted">{fmtPx(h.mark)}</span>
                <span className="text-right tabular-nums">{fmtUsd(h.qty * h.mark)}</span>
              </div>
              <div className="mt-0.5 flex justify-end px-3">
                {h.k === "USDC" ? (
                  <button
                    type="button"
                    className="pressable rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass hover:bg-brass/15"
                    onClick={() => {
                      const pool = s.pools["ETH-USDC"];
                      const usd = h.qty;
                      const rec = pool ? baseOutForQuote(pool, usd) : usd / Math.max(s.eth, 1e-9);
                      setPending({
                        title: "Bridge USDC",
                        hint: "USDC is the quote. Closing it sells USDC for ETH on the ETH-USDC pool — the paper stand-in for an off-pit bridge (Circle CCTP / Base).",
                        rows: [
                          { k: "Sell", v: `${fmtQty(usd)} USDC` },
                          { k: "Route", v: "ETH-USDC AMM" },
                          { k: "Receive ~", v: `${fmtQty(rec)} ETH` },
                          { k: "Mark", v: fmtPx(s.eth) },
                          { k: "Cash after", v: "$0.00 USDC" },
                        ],
                        confirm: "Bridge to ETH",
                        tone: "brass",
                        run: () => buySpot("ETH-USDC", usd),
                      });
                    }}
                  >
                    Bridge
                  </button>
                ) : h.qty > 1e-8 ? (
                  <button
                    type="button"
                    className="pressable rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass hover:bg-brass/15"
                    onClick={() => {
                      const poolId = spotPool(s, h.k);
                      const pool = poolId ? s.pools[poolId] : undefined;
                      const credit = pool ? h.qty * (pool.quoteReserve / pool.baseReserve) * (1 - pool.feeBps / 10_000) : h.qty * h.mark;
                      setPending({
                        title: `Close ${h.k} spot`,
                        hint: "Market sell into the pool. Confirm to send.",
                        rows: [
                          { k: "Sell", v: `${fmtQty(h.qty)} ${h.k}` },
                          { k: "Pool", v: poolId ?? "—" },
                          { k: "Mark", v: fmtPx(h.mark) },
                          { k: "Credit ~", v: fmtUsd(credit) },
                          { k: "Cash after ~", v: fmtUsd(s.account.usdc + credit) },
                        ],
                        confirm: "Confirm sell",
                        tone: "down",
                        run: () => {
                          if (poolId) sellSpot(poolId, h.qty);
                        },
                      });
                    }}
                  >
                    Close
                  </button>
                ) : null}
              </div>
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
                onClose={() =>
                  setPending({
                    title: `Close ${under} mini`,
                    hint: "Flatten the dated mini at the live mark. Margin comes back to cash.",
                    rows: [
                      { k: "Side", v: p.side.toUpperCase() },
                      { k: "Contracts", v: fmtQty(Math.abs(qty), true) },
                      { k: "Underlying", v: `${fmtQty(p.sizeEth)} ${under}` },
                      { k: "Mark", v: fmtPx(mark) },
                      { k: "P/L", v: signed(pnlP) },
                      { k: "Margin released", v: fmtUsd(p.margin) },
                      { k: "Liquidation was", v: fmtPx(futLiqPrice(p)) },
                      { k: "Expiry", v: fmtExpiry(p.expiry) },
                    ],
                    confirm: "Confirm close",
                    tone: "brass",
                    run: () => closeFut(p.id),
                  })
                }
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
                onClose={() =>
                  setPending({
                    title: `Close ${under} ${p.type}`,
                    hint: "Sell the vanilla back to the vault at the bid.",
                    rows: [
                      { k: "Contract", v: `${under} ${fmtPx(p.strike)} ${p.type.toUpperCase()}` },
                      { k: "Contracts", v: fmtQty(contracts) },
                      { k: "Mark / bid", v: fmtPx(mid) },
                      { k: "Paid", v: fmtPx(p.premium) },
                      { k: "P/L", v: signed(pnlP) },
                      { k: "Credit ~", v: fmtUsd(mid * p.sizeEth) },
                      { k: "Expiry", v: fmtExpiry(p.expiry) },
                    ],
                    confirm: "Confirm close",
                    tone: "brass",
                    run: () => closeOpt(p.id),
                  })
                }
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
                  onClose={() =>
                    setPending({
                      title: `Remove ${p.poolId.replace("-TEST", "")} LP`,
                      hint: "Both legs return to the wallet. Confirm to pull the stall.",
                      rows: [
                        { k: "Shares", v: fmtQty(p.shares) },
                        { k: "Value", v: fmtUsd(val) },
                        { k: "P/L", v: signed(lpPnl(s, p)) },
                        { k: "Ripe WPIT", v: fmtQty(pending) },
                      ],
                      confirm: "Confirm remove",
                      tone: "brass",
                      run: () => lpRemove(p.poolId, p.shares),
                    })
                  }
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
              onClose={() =>
                setPending({
                  title: "Unstake WPIT",
                  hint: "Junior stake returns to the wallet. Yield stops.",
                  rows: [
                    { k: "Amount", v: `${fmtQty(s.stake.amount)} WPIT` },
                    { k: "Mark", v: fmtPx(s.wpit) },
                    { k: "Value", v: fmtUsd(s.stake.amount * s.wpit) },
                  ],
                  confirm: "Confirm unstake",
                  tone: "brass",
                  run: () => unstake(),
                })
              }
              closeLabel="Unstake"
            />
          </Sec>
        ) : null}

        {openTickets(s).length > 0 ? (
          <Sec title="Track" count={openTickets(s).length}>
            {openTickets(s).map((b) => (
              <div key={b.id} className="border-t border-border/50 px-3 py-2">
                <div className={cn(COLS, "font-mono text-[12px]")}>
                  <span className="truncate font-medium">
                    #{b.runner} {b.name}
                  </span>
                  <span className="text-right tabular-nums">{fmtQty(b.stake)}</span>
                  <span className="text-right tabular-nums text-muted">{fracOdds(b.odds)}</span>
                  <span className="text-right tabular-nums text-brass">{fmtQty(b.stake * b.odds)}</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-subtle">
                  {b.kind} · WPIT ticket · pays if it hits
                </p>
              </div>
            ))}
          </Sec>
        ) : null}
      </div>
      {pending && typeof document !== "undefined"
        ? createPortal(
            <ConfirmSheet
              p={pending}
              onEdit={() => setPending(null)}
              onOk={() => {
                pending.run();
                setPending(null);
              }}
            />,
            document.body,
          )
        : null}
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

function spotPool(s: { pools: Record<string, { base: string }> }, sym: string): PoolId | null {
  if (sym === "ETH" && s.pools["ETH-USDC"]) return "ETH-USDC";
  const hit = Object.keys(s.pools).find((id) => s.pools[id]!.base === sym);
  return (hit as PoolId) ?? null;
}

function baseOutForQuote(pool: { baseReserve: number; quoteReserve: number; feeBps: number }, quoteIn: number) {
  const dx = quoteIn * (1 - pool.feeBps / 10_000);
  if (!(pool.quoteReserve + dx > 0)) return 0;
  return (pool.baseReserve * dx) / (pool.quoteReserve + dx);
}

function ConfirmSheet({ p, onEdit, onOk }: { p: Pending; onEdit: () => void; onOk: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 p-3 pb-[calc(3.6rem+env(safe-area-inset-bottom))] sm:items-center">
      <div className="sheet-in flex max-h-[min(88dvh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-[1.1rem] border border-brass/40 bg-panel shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">Confirm</p>
          <h3 className="mt-1 font-display text-2xl leading-tight">{p.title}</h3>
          <p className="mt-1 text-[12px] text-muted">{p.hint}</p>
        </div>
        <dl className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-[12px]">
          {p.rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-subtle">{r.k}</dt>
              <dd className="text-right tabular-nums text-fg">{r.v}</dd>
            </div>
          ))}
        </dl>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
          <button type="button" className="h-12 rounded-[var(--radius-sm)] border border-border" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className={cn(
              "h-12 rounded-[var(--radius-sm)] font-medium",
              p.tone === "down" ? "bg-down text-fg" : p.tone === "up" ? "bg-up text-bg" : "bg-brass text-bg",
            )}
            onClick={onOk}
          >
            {p.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
