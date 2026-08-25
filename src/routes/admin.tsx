import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { adminLogout, adminWhoami } from "@/lib/admin/actions";
import { deployTestBook, useAdmin, type ContractBook } from "@/lib/admin/config";
import { chainLabel } from "@/lib/wolfpit/chain";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/admin")({ component: AdminPage });

function AdminPage() {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const nav = useNavigate();
  useEffect(() => {
    void adminWhoami().then((r) => {
      if (!r.user) nav({ to: "/admin/login" });
      else setUser(r.user);
    });
  }, [nav]);
  if (!user) {
    return (
      <Shell>
        <p className="p-8 text-sm text-muted">Checking pit ops session…</p>
      </Shell>
    );
  }
  return <AdminDesk user={user} />;
}

function AdminDesk({ user }: { user: string }) {
  const a = useAdmin();
  const wolf = useWolf();
  const [eth, setEth] = useState(String(wolf.vault.eth));
  const [usdc, setUsdc] = useState(String(wolf.vault.usdc));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function deploy() {
    setBusy(true);
    setMsg(null);
    try {
      const book = await deployTestBook();
      a.setBook(book);
      setMsg("TEST stack recorded. Paper desk still uses the sim engine until VITE_CHAIN flips.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brass">Pit ops · {user}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-medium">Control panel</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void adminLogout().then(() => (window.location.href = "/admin/login"));
            }}
          >
            Sign out
          </Button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Deploy TEST addresses, pause listings, seed vault cover. This is not a hot-wallet deployer. Live
          broadcasts stay on Foundry + a connected signer in Q1.
        </p>

        <section className="mt-8 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-medium">Listings</h2>
          <p className="mt-1 text-xs text-muted">Chain {chainLabel()} · paper engine</p>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={a.listingsPaused} onChange={(e) => a.setPaused(e.target.checked)} />
            Pause new futures and options
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={a.geoFenceUs} onChange={(e) => a.setGeo(e.target.checked)} />
            US geo-fence (hide minis)
          </label>
        </section>

        <section className="mt-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-medium">Vault cover</h2>
          <p className="mt-1 text-xs text-muted">
            Free ETH {wolf.vault.eth.toFixed(2)} · USDC {fmtUsd(wolf.vault.usdc)}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              ETH
              <input
                className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
                value={eth}
                onChange={(e) => setEth(e.target.value)}
              />
            </label>
            <label className="text-xs">
              USDC
              <input
                className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
                value={usdc}
                onChange={(e) => setUsdc(e.target.value)}
              />
            </label>
          </div>
          <Button className="mt-4" onClick={() => wolf.seedVault(Number(eth) || 0, Number(usdc) || 0)}>
            Seed vault
          </Button>
        </section>

        <section className="mt-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">TEST contracts</h2>
            <Button disabled={busy} onClick={() => void deploy()}>
              {busy ? "Deploying…" : "Deploy TEST stack"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Writes deterministic TEST addresses into this browser. Forge:{" "}
            <code className="text-fg">forge test --root contracts</code>
          </p>
          {a.deployedAt ? (
            <p className="mt-2 font-mono text-[11px] text-brass">
              Recorded {new Date(a.deployedAt).toISOString()}
            </p>
          ) : null}
          <div className="mt-4 grid gap-3">
            {(Object.keys(a.contracts) as (keyof ContractBook)[]).map((k) => (
              <label key={k} className="block text-[11px] uppercase tracking-wider text-subtle">
                {k}
                <input
                  className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-xs lowercase"
                  value={a.contracts[k]}
                  onChange={(e) => a.setContract(k, e.target.value)}
                  placeholder="0x…"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => a.clearBook()}>
              Clear addresses
            </Button>
            <Link to="/trade">
              <Button variant="ghost">Open desk</Button>
            </Link>
          </div>
          {msg ? <p className="mt-3 text-sm text-muted">{msg}</p> : null}
        </section>

        <section className="mt-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-medium">Notes</h2>
          <textarea
            className="mt-3 min-h-28 w-full rounded-[var(--radius-sm)] border border-border bg-elevated p-3 text-sm"
            value={a.notes}
            onChange={(e) => a.setNotes(e.target.value)}
            placeholder="Keeper RPC, audit status, pause reason…"
          />
        </section>
      </main>
    </Shell>
  );
}
