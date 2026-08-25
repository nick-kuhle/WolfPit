import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { insuranceRatio } from "@/lib/wolfpit/risk";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/stake")({ component: StakePage });

function StakePage() {
  const s = useWolf();
  const lockStake = useWolf((st) => st.lockStake);
  const unstake = useWolf((st) => st.unstake);
  const err = useWolf((st) => st.lastError);
  const [amt, setAmt] = useState("1000");
  return (
    <Shell>
      <main className="mx-auto max-w-xl px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-brass">$WPIT · insurance junior</p>
        <h1 className="mt-2 text-2xl font-medium">Stake</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Staked WPIT is first-loss junior: insurance USDC → staked WPIT haircut → pause listings → LP NAV.
          Simulated emission is a placeholder funded by emissions, not by selling naked vol. Not a deposit.
        </p>
        <p className="mt-2 text-sm text-muted">
          Need WPIT?{" "}
          <Link to="/trade" className="text-fg underline-offset-2 hover:underline">
            Buy it on the desk
          </Link>
          .
        </p>
        <div className="mt-8 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-subtle">Wallet WPIT</dt>
              <dd className="font-mono tabular-nums">{s.account.wpit.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-subtle">Staked</dt>
              <dd className="font-mono tabular-nums">{s.stake.amount.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-subtle">Mark</dt>
              <dd className="font-mono tabular-nums">{fmtUsd(s.wpit, 4)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-subtle">Insurance / NAV</dt>
              <dd className="font-mono tabular-nums">{(insuranceRatio(s) * 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-subtle">Insurance USDC</dt>
              <dd className="font-mono tabular-nums">{fmtUsd(s.insuranceUsdc)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-subtle">Sim emission</dt>
              <dd className="font-mono tabular-nums">12%</dd>
            </div>
          </dl>
          <label className="mt-6 block">
            <span className="text-[10px] uppercase tracking-wider text-subtle">Amount</span>
            <input
              className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" onClick={() => lockStake(Number(amt) || 0)}>
              Stake
            </Button>
            <Button className="flex-1" variant="outline" disabled={s.stake.amount <= 0} onClick={unstake}>
              Unstake all
            </Button>
          </div>
          {err ? <p className="mt-3 text-sm text-down">{err}</p> : null}
        </div>
      </main>
      <SiteFooter />
    </Shell>
  );
}
