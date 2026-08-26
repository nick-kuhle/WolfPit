import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/orders")({ component: OrdersPage });

function OrdersPage() {
  const fills = useWolf((s) => s.fills);
  const working = useWolf((s) => s.working ?? []);
  const cancel = useWolf((s) => s.cancelOrder);
  return (
    <Shell desk>
      <ProductGate product="desk">
        <main className="mx-auto max-w-3xl px-4 py-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">The pad</p>
          <h1 className="mt-1 font-display text-4xl font-medium">Fills & working</h1>
          <p className="mt-2 text-sm text-muted">Pending shouts and the tape of what already printed.</p>

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

          <h2 className="mt-8 font-display text-2xl">History</h2>
          {fills.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No prints yet.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {fills.map((f) => (
                <div key={f.id} className="ticket-card rounded-[var(--radius-lg)] border border-border bg-elevated p-3">
                  <div className="flex justify-between text-[10px] uppercase tracking-wider text-subtle">
                    <span>{new Date(f.t).toISOString().slice(11, 19)}</span>
                    <span>{f.product}</span>
                  </div>
                  <div className="mt-1 font-display text-xl">
                    {f.side} {f.symbol}
                  </div>
                  <div className="font-mono text-xs text-muted">
                    {f.size.toPrecision(4)} @ {fmtPx(f.price)} · fee {fmtUsd(f.fee)}
                  </div>
                </div>
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
