import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useWolf } from "@/lib/wolfpit/store";
import type { CashShot, OrderFill } from "@/lib/wolfpit/types";
import { cn, fmtPx, fmtQty } from "@/lib/utils";

export const Route = createFileRoute("/orders")({ component: OrdersPage });

type Asset = "USDC" | "ETH" | "WPIT";
type Fx = "USD" | "EUR" | "GBP" | "JPY" | "BTC";

const FX_PER_USD: Record<Fx, number> = { USD: 1, EUR: 0.93, GBP: 0.79, JPY: 147, BTC: 0 };
const FX_SYM: Record<Fx, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", BTC: "₿" };

function shotQty(shot: CashShot | undefined, asset: Asset) {
  if (!shot) return null;
  if (asset === "USDC") return shot.usdc;
  if (asset === "ETH") return shot.eth;
  return shot.wpit;
}

function usdOf(qty: number, asset: Asset, eth: number, wpit: number) {
  if (asset === "USDC") return qty;
  if (asset === "ETH") return qty * eth;
  return qty * wpit;
}

function fmtFx(usd: number, fx: Fx, btc: number) {
  if (fx === "BTC") {
    const b = btc > 0 ? usd / btc : 0;
    return `₿${b.toFixed(b >= 1 ? 4 : 6)}`;
  }
  const n = usd * FX_PER_USD[fx];
  const sym = FX_SYM[fx];
  if (fx === "JPY") return `${sym}${Math.round(n).toLocaleString("en-US")}`;
  return `${sym}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function OrdersPage() {
  const fills = useWolf((s) => s.fills);
  const working = useWolf((s) => s.working ?? []);
  const cancel = useWolf((s) => s.cancelOrder);
  const eth = useWolf((s) => s.eth);
  const wpit = useWolf((s) => s.wpit);
  const btc = useWolf((s) => s.btc);
  const [asset, setAsset] = useState<Asset>("USDC");
  const [fx, setFx] = useState<Fx>("USD");

  return (
    <Shell desk>
      <ProductGate product="desk">
        <main className="mx-auto max-w-5xl px-4 py-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">The pad</p>
          <h1 className="mt-1 font-display text-4xl font-medium">Fills & working</h1>
          <p className="mt-2 text-sm text-muted">Before / after is the wallet. Mark it in the unit you care about.</p>

          <h2 className="mt-8 font-display text-2xl">Working</h2>
          {working.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing resting. Hit the ticket.</p>
          ) : (
            <div className="mt-3 grid gap-2">
              {working.map((w) => (
                <div key={w.id} className="ticket-card flex items-center justify-between rounded-[var(--radius-lg)] border border-warn/50 bg-warn/10 px-4 py-3">
                  <div>
                    <div className="font-display text-lg">
                      {w.side.toUpperCase()} {w.qty} {w.product}
                    </div>
                    <div className="font-mono text-[11px] text-muted">
                      {w.kind.toUpperCase()} · {w.tif.toUpperCase()} · {w.poolId ?? w.optType ?? "ETH"}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => cancel(w.id)}>
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-2xl">History</h2>
            <div className="flex flex-wrap gap-2">
              <Toggle
                value={asset}
                onChange={setAsset}
                opts={["USDC", "ETH", "WPIT"]}
              />
              <button
                type="button"
                className="h-9 rounded-full border border-brass/50 px-3 font-mono text-[11px] text-brass"
                onClick={() => setFx(nextFx(fx))}
              >
                Est. {fx} ▾
              </button>
            </div>
          </div>

          {fills.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No prints yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-[var(--radius-lg)] border border-border">
              <div className="grid min-w-[44rem] grid-cols-[4.5rem_minmax(7rem,1.4fr)_5.5rem_5.5rem_5.5rem_6.5rem] bg-elevated px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-subtle">
                <span>Time</span>
                <span>Print</span>
                <span className="text-right">Before {asset}</span>
                <span className="text-right">After {asset}</span>
                <span className="text-right">Δ</span>
                <button type="button" className="text-right text-brass" onClick={() => setFx(nextFx(fx))}>
                  Est. {fx}
                </button>
              </div>
              {fills.map((f) => (
                <FillRow key={f.id} f={f} asset={asset} fx={fx} eth={eth} wpit={wpit} btc={btc} />
              ))}
            </div>
          )}

          <div className="mt-8">
            <Link to="/trade">
              <Button variant="outline">Back to the floor</Button>
            </Link>
          </div>
        </main>
      </ProductGate>
    </Shell>
  );
}

function FillRow({
  f,
  asset,
  fx,
  eth,
  wpit,
  btc,
}: {
  f: OrderFill;
  asset: Asset;
  fx: Fx;
  eth: number;
  wpit: number;
  btc: number;
}) {
  const b = shotQty(f.before, asset);
  const a = shotQty(f.after, asset);
  const d = a != null && b != null ? a - b : null;
  const usd = a != null ? usdOf(a, asset, eth, wpit) : null;
  return (
    <div className="grid min-w-[44rem] grid-cols-[4.5rem_minmax(7rem,1.4fr)_5.5rem_5.5rem_5.5rem_6.5rem] items-baseline border-t border-border px-3 py-2 font-mono text-[11px]">
      <span className="text-subtle">{new Date(f.t).toISOString().slice(11, 19)}</span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[13px] text-fg">
          {f.side} {f.symbol}
        </span>
        <span className="text-[10px] text-muted">
          {fmtQty(f.size)} @ {fmtPx(f.price)}
          {f.fair ? ` · ${f.fair.seed ? `seed ${f.fair.seed.slice(0, 10)}` : `commit ${f.fair.commit.slice(0, 10)}`}` : ""}
        </span>
      </span>
      <span className="text-right tabular-nums text-muted">{b == null ? "—" : fmtQty(b)}</span>
      <span className="text-right tabular-nums">{a == null ? "—" : fmtQty(a)}</span>
      <span className={cn("text-right tabular-nums", d == null ? "text-muted" : d > 0 ? "text-up" : d < 0 ? "text-down" : "text-muted")}>
        {d == null ? "—" : fmtQty(d, true)}
      </span>
      <span className="text-right tabular-nums text-brass">{usd == null ? "—" : fmtFx(usd, fx, btc)}</span>
    </div>
  );
}

function Toggle<T extends string>({ value, onChange, opts }: { value: T; onChange: (v: T) => void; opts: T[] }) {
  return (
    <div className="flex overflow-hidden rounded-full border border-border">
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn("h-9 px-3 font-mono text-[11px]", value === o ? "bg-brass text-bg" : "text-muted")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function nextFx(fx: Fx): Fx {
  const order: Fx[] = ["USD", "EUR", "GBP", "JPY", "BTC"];
  return order[(order.indexOf(fx) + 1) % order.length]!;
}
