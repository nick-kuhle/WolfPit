import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { adminLogout, adminWhoami, getTradingPolicy, setTradingPolicy } from "@/lib/admin/actions";
import { deployTestBook, useAdmin, type ContractBook } from "@/lib/admin/config";
import { chainLabel } from "@/lib/wolfpit/chain";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/admin/login") return { adminUser: null as string | null };
    const r = await adminWhoami();
    if (!r.user) throw redirect({ to: "/admin/login" });
    return { adminUser: r.user };
  },
  component: AdminGate,
});

function AdminGate() {
  const { adminUser } = Route.useRouteContext();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path === "/admin/login" || !adminUser) return <Outlet />;
  return <AdminDesk user={adminUser} />;
}

function AdminDesk({ user }: { user: string }) {
  const a = useAdmin();
  const wolf = useWolf();
  /*
   * Server-owned policy (WP-07 / #13). Read on mount and mirrored into the
   * client store so the rest of the UI keeps working without awaiting a
   * round-trip on every render — but the server re-checks on every
   * order-accepting call regardless, so the mirror is never load-bearing.
   */
  const [policy, setPolicy] = useState({
    listingsPaused: a.listingsPaused,
    geoFenceUs: a.geoFenceUs,
    detail: {
      listingsPaused: { reason: "", updatedBy: "", updatedAt: "" },
      geoFenceUs: { reason: "", updatedBy: "", updatedAt: "" },
    },
  });
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyUnavailable, setPolicyUnavailable] = useState(false);
  /** Set when the switch is NOT backed by a store shared across instances. */
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const refreshPolicy = useCallback(async () => {
    const r = await getTradingPolicy();
    if (r.ok) {
      setPolicy(r.policy);
      setPolicyUnavailable(false);
      setPolicyNotice(
        r.shared
          ? null
          : r.degraded?.code === "missing-table"
            ? "wolfpit_policy is missing — apply migrations/0004_wolfpit_policy.sql. Until then only the WOLFPIT_TRADING_PAUSED env switch binds."
            : "No shared policy store (DATABASE_URL unset). A pause set here would bind one server instance and be lost on the next request — set DATABASE_URL, or use WOLFPIT_TRADING_PAUSED=1 as the kill switch.",
      );
      // Keep the client mirror in step so non-order UI reflects reality.
      a.setPaused(r.policy.listingsPaused);
      a.setGeo(r.policy.geoFenceUs);
    } else {
      setPolicyUnavailable(true);
    }
  }, [a]);
  useEffect(() => {
    void refreshPolicy();
  }, [refreshPolicy]);
  const flip = useCallback(
    async (key: "listingsPaused" | "geoFenceUs", value: boolean) => {
      setPolicyBusy(true);
      setPolicyError(null);
      try {
        const r = await setTradingPolicy({ data: { key, value, reason: "" } });
        if (r.ok) {
          setPolicy(r.policy);
          a.setPaused(r.policy.listingsPaused);
          a.setGeo(r.policy.geoFenceUs);
        } else {
          setPolicyError(r.error);
        }
      } finally {
        setPolicyBusy(false);
      }
    },
    [a],
  );
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
          {/*
            WP-07 / #13: these are MIRRORS of server state, not the source of
            truth. The toggle writes to wolfpit_policy via setTradingPolicy and
            then re-reads, so what is shown is what every other session sees.
            Editing localStorage no longer changes anything.
          */}
          {policyUnavailable && (
            <p className="mt-3 rounded-[var(--radius-md)] border border-border bg-danger/10 p-2 text-xs">
              Policy store unavailable — orders are being refused, and these
              switches cannot be changed until it can be read.
            </p>
          )}
          {policyNotice && (
            <p className="mt-3 rounded-[var(--radius-md)] border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              {policyNotice}
            </p>
          )}
          {policyError && (
            <p className="mt-3 rounded-[var(--radius-md)] border border-border bg-danger/10 p-2 text-xs">
              {policyError}
            </p>
          )}
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={policy.listingsPaused}
              disabled={policyBusy}
              onChange={(e) => flip("listingsPaused", e.target.checked)}
            />
            Pause new futures and options
            {policy.detail.listingsPaused.updatedAt && (
              <span className="text-xs text-muted">
                · {policy.detail.listingsPaused.updatedBy || "unknown"}{" "}
                {new Date(policy.detail.listingsPaused.updatedAt).toLocaleString()}
              </span>
            )}
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={policy.geoFenceUs}
              disabled={policyBusy}
              onChange={(e) => flip("geoFenceUs", e.target.checked)}
            />
            US geo-fence (hide minis)
            {policy.detail.geoFenceUs.updatedAt && (
              <span className="text-xs text-muted">
                · {policy.detail.geoFenceUs.updatedBy || "unknown"}{" "}
                {new Date(policy.detail.geoFenceUs.updatedAt).toLocaleString()}
              </span>
            )}
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
