import { futPnl, optMark } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx, fmtUsd } from "@/lib/utils";

export function Blotter() {
  const s = useWolf();
  const closeFut = useWolf((st) => st.closeFut);
  const closeOpt = useWolf((st) => st.closeOpt);
  return (
    <div className="grid min-h-0 gap-4 overflow-auto p-3 lg:grid-cols-3">
      <section>
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Spot</h3>
        <Row k="USDC" v={fmtUsd(s.account.usdc)} />
        <Row k="ETH" v={`${s.account.eth.toFixed(4)}  (${fmtUsd(s.account.eth * s.eth)})`} />
        <Row k="WPIT" v={`${s.account.wpit.toFixed(2)}  (${fmtUsd(s.account.wpit * s.wpit)})`} />
        {Object.entries(s.account.tokens ?? {}).map(([k, v]) => (
          <Row key={k} k={k} v={v.toLocaleString()} />
        ))}
      </section>
      <section>
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Mini futures</h3>
        {s.futures.length === 0 ? <p className="text-xs text-muted">No futures. Ticket → Mini fut.</p> : null}
        {s.futures.map((p) => {
          const pnl = futPnl(p, s.eth);
          return (
            <div key={p.id} className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2 text-xs">
              <div>
                <div className="font-medium">
                  {p.side.toUpperCase()} {p.sizeEth} ETH
                </div>
                <div className="font-mono text-muted">
                  {fmtPx(p.entry)} → {fmtPx(s.eth)} · {new Date(p.expiry).toISOString().slice(5, 10)}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pnl)}</div>
                <button className="h-8 text-muted hover:text-fg" onClick={() => closeFut(p.id)}>
                  Close
                </button>
              </div>
            </div>
          );
        })}
      </section>
      <section>
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Mini options</h3>
        {s.options.length === 0 ? <p className="text-xs text-muted">No options. Ticket → Mini opt.</p> : null}
        {s.options.map((p) => {
          const m = optMark(s, p) * p.sizeEth;
          const cost = p.premium * p.sizeEth;
          const pnl = m - cost;
          return (
            <div key={p.id} className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2 text-xs">
              <div>
                <div className="font-medium">
                  LONG {p.sizeEth} {p.strike} {p.type}
                </div>
                <div className="font-mono text-muted">
                  paid {fmtPx(p.premium)} · mark {fmtPx(optMark(s, p))} · {new Date(p.expiry).toISOString().slice(5, 10)}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pnl)}</div>
                <button className="h-8 text-muted hover:text-fg" onClick={() => closeOpt(p.id)}>
                  Close
                </button>
              </div>
            </div>
          );
        })}
      </section>
      <section className="lg:col-span-3">
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Working</h3>
        {(s.working ?? []).length === 0 ? <p className="text-xs text-muted">No working orders.</p> : null}
        {(s.working ?? []).map((w) => (
          <div key={w.id} className="flex justify-between border-b border-border py-1.5 text-xs">
            <span>
              {w.side} {w.qty} {w.product} {w.kind}
            </span>
            <span className="font-mono text-muted">{w.tif}</span>
          </div>
        ))}
      </section>
      <section className="lg:col-span-3">
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Fills</h3>
        <div className="max-h-40 overflow-auto font-mono text-[11px] text-muted">
          {s.fills.slice(0, 16).map((f) => (
            <div key={f.id} className="flex justify-between gap-3 border-b border-border/60 py-1">
              <span>
                {new Date(f.t).toISOString().slice(11, 19)} {f.symbol} {f.side}
              </span>
              <span>
                {f.size.toFixed(3)} @ {fmtPx(f.price)}
              </span>
            </div>
          ))}
          {s.fills.length === 0 ? <p>No fills yet. Send from the ticket.</p> : null}
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5 text-xs">
      <span className="text-muted">{k}</span>
      <span className="font-mono tabular-nums">{v}</span>
    </div>
  );
}
