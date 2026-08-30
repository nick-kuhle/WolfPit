import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { RanchHero } from "@/components/yield-nav";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { ConfirmSheet, type Confirm } from "@/components/confirm-sheet";
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
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const amtN = Number(amt) || 0;
  return (
    <Shell>
      <ProductGate product="stake">
        <RanchHero
          on="pools"
          image="/brand/lockup-dark.jpg"
          kicker="The Ranch · Pools"
          title={
            <>
              Park it. <span className="italic text-brass">Earn 12%.</span>
            </>
          }
          sub="Junior to insurance. First-loss if the pit has a bad day. Simulated. Not a deposit."
        />
        <main className="mx-auto max-w-xl px-4 py-8">
          <p className="text-sm text-muted">
            Need WPIT?{" "}
            <Link to="/asset/$symbol" params={{ symbol: "WPIT" }} search={{ name: "WolfPit", chain: "Base", contract: "", network: "" }} className="text-brass hover:underline">
              Open the WPIT ticket
            </Link>
            {" · "}
            <Link to="/trade" className="text-fg underline-offset-2 hover:underline">
              trade it
            </Link>
            .
          </p>
          <div className="mt-8 rounded-[var(--radius-xl)] border border-border bg-panel p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-subtle">Wallet WPIT</dt>
                <dd className="font-mono text-lg tabular-nums">{s.account.wpit.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-subtle">Staked</dt>
                <dd className="font-mono text-lg tabular-nums">{s.stake.amount.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-subtle">Mark</dt>
                <dd className="font-mono tabular-nums">{fmtUsd(s.wpit, 4)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-subtle">Insurance / NAV</dt>
                <dd className="font-mono tabular-nums">{(insuranceRatio(s) * 100).toFixed(2)}%</dd>
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
              <Button
                className="flex-1"
                disabled={amtN <= 0}
                onClick={() =>
                  setConfirm({
                    kicker: "Confirm stake",
                    title: `Stake ${amtN.toLocaleString("en-US")} WPIT`,
                    sub: "The Ranch · junior to insurance",
                    rows: [
                      { k: "Amount", v: `${amtN.toLocaleString("en-US")} WPIT`, tone: "brass" },
                      { k: "Mark", v: fmtUsd(s.wpit, 4) },
                      { k: "Value staked", v: fmtUsd(amtN * s.wpit) },
                      { k: "Rate", v: "12% APR · paid in WPIT" },
                      { k: "Est. 30-day yield", v: `${((amtN * 0.12 * 30) / 365).toFixed(2)} WPIT`, tone: "up" },
                      { k: "Staked after", v: `${(s.stake.amount + amtN).toFixed(2)} WPIT` },
                      { k: "Wallet WPIT after", v: `${(s.account.wpit - amtN).toFixed(2)}` },
                      { k: "Risk", v: "First-loss if the pit has a bad day" },
                    ],
                    note: "Paper lockup — simulated, not a deposit. Nothing leaves the sim until you confirm.",
                    confirmLabel: "Stake",
                    confirmTone: "up",
                    run: () => lockStake(amtN),
                  })
                }
              >
                Stake
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                disabled={s.stake.amount <= 0}
                onClick={() =>
                  setConfirm({
                    kicker: "Confirm unstake",
                    title: `Unstake ${s.stake.amount.toFixed(2)} WPIT`,
                    sub: "Full unlock — instant in the sim",
                    rows: [
                      { k: "Amount", v: `${s.stake.amount.toFixed(2)} WPIT`, tone: "brass" },
                      { k: "Mark", v: fmtUsd(s.wpit, 4) },
                      { k: "Value returned", v: fmtUsd(s.stake.amount * s.wpit) },
                      { k: "Wallet WPIT after", v: `${(s.account.wpit + s.stake.amount).toFixed(2)}` },
                      { k: "Staked after", v: "0 WPIT" },
                    ],
                    note: "Paper lockup — simulated, not a deposit. Nothing leaves the sim until you confirm.",
                    confirmLabel: "Unstake all",
                    run: () => unstake(),
                  })
                }
              >
                Unstake all
              </Button>
            </div>
            {err ? <p className="mt-3 text-sm text-down">{err}</p> : null}
          </div>
        </main>
        <ConfirmSheet confirm={confirm} onClose={() => setConfirm(null)} />
        <SiteFooter />
      </ProductGate>
    </Shell>
  );
}