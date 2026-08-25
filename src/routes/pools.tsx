import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { lpValue, utilEth } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import type { PoolId } from "@/lib/wolfpit/types";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/pools")({ component: PoolsPage });

const IDS: PoolId[] = ["ETH-USDC", "WPIT-USDC-TEST", "WPIT-ETH-TEST"];

const GAUGE: Record<PoolId, string> = {
  "ETH-USDC": "Unfarmed · swap fees only",
  "WPIT-USDC-TEST": "Gauge 20%",
  "WPIT-ETH-TEST": "Gauge 10%",
};

function PoolsPage() {
  const s = useWolf();
  const add = useWolf((st) => st.lpAdd);
  const remove = useWolf((st) => st.lpRemove);
  const harvest = useWolf((st) => st.harvest);
  const err = useWolf((st) => st.lastError);
  const [amt, setAmt] = useState("5000");
  const u = utilEth(s);
  const tax = s.farmWpit * 0.01;
  return (
    <Shell>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-brass">Farms · test contracts</p>
        <h1 className="mt-2 text-2xl font-medium">Pools</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Add both legs. Buy the missing side on the{" "}
          <Link to="/trade" className="text-fg underline-offset-2 hover:underline">
            desk
          </Link>
          . Emissions pay quoting capital, not idle TVL. Paper only.
        </p>
        <ul className="mt-6 grid gap-2 font-mono text-xs text-muted sm:grid-cols-3">
          <li className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">
            Vault 70%
            <div className="mt-1 text-fg">util {(0.3 + 0.7 * u).toFixed(2)}×</div>
          </li>
          <li className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">WPIT-USDC 20%</li>
          <li className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">WPIT-ETH 10%</li>
        </ul>
        <div className="mt-8 grid gap-3">
          {IDS.map((id) => {
            const p = s.pools[id];
            const tvl =
              id === "WPIT-ETH-TEST"
                ? p.quoteReserve * s.eth + p.baseReserve * s.wpit
                : p.quoteReserve + p.baseReserve * (id === "ETH-USDC" ? s.eth : s.wpit);
            const mine = s.lp.find((x) => x.poolId === id);
            return (
              <article key={id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-sm">{id}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {p.base}/{p.quote} · fee {p.feeBps / 100}% · {GAUGE[id]}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-subtle">TVL</div>
                    <div className="font-mono tabular-nums">{fmtUsd(tvl)}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="flex-1">
                    <span className="text-[10px] uppercase tracking-wider text-subtle">Add quote (USDC or ETH$)</span>
                    <input
                      className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-sm"
                      value={amt}
                      onChange={(e) => setAmt(e.target.value)}
                    />
                  </label>
                  <Button onClick={() => add(id, Number(amt) || 0)}>Add liquidity</Button>
                  <Button
                    variant="outline"
                    disabled={!mine}
                    onClick={() => mine && remove(id, mine.shares)}
                  >
                    Remove all
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Your LP {mine ? fmtUsd(lpValue(s, id, mine.shares)) : "$0.00"} · both legs required
                </p>
              </article>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-subtle">WPIT farm</div>
            <div className="font-mono text-lg tabular-nums">{s.farmWpit.toFixed(2)} WPIT</div>
            <p className="mt-1 text-xs text-muted">Harvest tax 1% → insurance ({tax.toFixed(2)} WPIT)</p>
          </div>
          <Button variant="outline" disabled={s.farmWpit <= 0} onClick={harvest}>
            Harvest
          </Button>
        </div>
        {err ? <p className="mt-4 text-sm text-down">{err}</p> : null}
      </main>
    </Shell>
  );
}
