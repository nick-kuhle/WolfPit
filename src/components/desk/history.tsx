import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx } from "@/lib/utils";

export function History() {
  const fills = useWolf((s) => s.fills);
  const working = useWolf((s) => s.working ?? []);
  const cancel = useWolf((s) => s.cancelOrder);
  return (
    <div className="min-h-0 overflow-auto p-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Pending</h3>
      {working.length === 0 ? <p className="text-xs text-muted">No working orders.</p> : null}
      {working.map((w) => (
        <div key={w.id} className="mb-2 flex items-center justify-between border-b border-border pb-2 text-xs">
          <div>
            <div className="font-medium">
              {w.side.toUpperCase()} {w.qty} {w.product} {w.kind.toUpperCase()}
            </div>
            <div className="font-mono text-muted">{w.tif.toUpperCase()} · {w.poolId ?? w.optType ?? "ETH"}</div>
          </div>
          <button className="h-11 px-3 text-muted" onClick={() => cancel(w.id)}>
            Cancel
          </button>
        </div>
      ))}
      <h3 className="mb-2 mt-5 text-[10px] uppercase tracking-wider text-subtle">Fills</h3>
      {fills.length === 0 ? <p className="text-xs text-muted">No fills yet.</p> : null}
      {fills.map((f) => (
        <div key={f.id} className="flex justify-between gap-3 border-b border-border/70 py-2 font-mono text-[11px]">
          <span>
            {new Date(f.t).toISOString().slice(11, 19)} {f.symbol} {f.side}
          </span>
          <span>
            {f.size.toPrecision(4)} @ {fmtPx(f.price)}
          </span>
        </div>
      ))}
    </div>
  );
}
