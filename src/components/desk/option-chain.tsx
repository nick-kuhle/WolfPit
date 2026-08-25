import { useMemo, useState } from "react";
import { expiries, optionQuote, strikes } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx } from "@/lib/utils";

export function OptionChain() {
  const s = useWolf();
  const open = useWolf((st) => st.openOpt);
  const exps = useMemo(() => expiries(s.clock), [s.clock]);
  const [exi, setExi] = useState(0);
  const ks = strikes(s.eth);
  const ex = exps[exi] ?? exps[0]!;
  return (
    <div className="min-h-0 overflow-auto">
      <div className="flex gap-1 px-2 py-2">
        {exps.map((e, i) => (
          <button
            key={e.at}
            onClick={() => setExi(i)}
            className={`h-11 px-3 text-xs uppercase tracking-wider ${i === exi ? "border-b border-accent text-fg" : "text-muted"}`}
          >
            {e.label} {new Date(e.at).toISOString().slice(5, 10)}
          </button>
        ))}
      </div>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-subtle">
          <tr>
            <th className="px-2 py-1 text-right font-medium">Bid</th>
            <th className="px-2 py-1 text-right font-medium">Ask</th>
            <th className="px-2 py-1 text-center font-medium">Call</th>
            <th className="px-2 py-1 text-center font-medium">Strike</th>
            <th className="px-2 py-1 text-center font-medium">Put</th>
            <th className="px-2 py-1 text-right font-medium">Bid</th>
            <th className="px-2 py-1 text-right font-medium">Ask</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {ks.map((k) => {
            const c = optionQuote(s, "call", k, ex.at);
            const p = optionQuote(s, "put", k, ex.at);
            const atm = Math.abs(k - s.eth) < 60;
            return (
              <tr key={k} className={atm ? "bg-elevated" : "hover:bg-elevated"}>
                <td className="px-2 py-2 text-right text-muted">{c.blank ? "—" : fmtPx(c.bid)}</td>
                <td className="px-2 py-2 text-right">
                  <button className="h-11 min-w-14 text-up disabled:opacity-40" disabled={!!c.blank} onClick={() => open("call", k, ex.at, 1)}>
                    {c.blank ? "—" : fmtPx(c.ask)}
                  </button>
                </td>
                <td className="px-2 py-2 text-center text-subtle">{c.delta.toFixed(2)}</td>
                <td className="px-2 py-2 text-center text-fg">{k}</td>
                <td className="px-2 py-2 text-center text-subtle">{p.delta.toFixed(2)}</td>
                <td className="px-2 py-2 text-right text-muted">{p.blank ? "—" : fmtPx(p.bid)}</td>
                <td className="px-2 py-2 text-right">
                  <button className="h-11 min-w-14 text-down disabled:opacity-40" disabled={!!p.blank} onClick={() => open("put", k, ex.at, 1)}>
                    {p.blank ? "—" : fmtPx(p.ask)}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
