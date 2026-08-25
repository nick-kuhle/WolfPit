import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandLockup } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { adminLogin, adminWhoami } from "@/lib/admin/actions";

export const Route = createFileRoute("/admin/login")({ component: AdminLogin });

function AdminLogin() {
  const nav = useNavigate();
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("admin");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void adminWhoami().then((r) => {
      if (r.user) nav({ to: "/admin" });
    });
  }, [nav]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 items-center border-b border-border px-4">
        <BrandLockup />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brass">Pit ops</p>
        <h1 className="mt-2 text-2xl font-medium">Sign in</h1>
        <p className="mt-2 text-sm text-muted">Development default is admin / admin. Override with ADMIN_USER and ADMIN_PASS on the server.</p>
        <form
          className="mt-8 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            void adminLogin({ data: { user, pass } })
              .then((r) => {
                if (!r.ok) setErr(r.error);
                else nav({ to: "/admin" });
              })
              .finally(() => setBusy(false));
          }}
        >
          <label className="block text-[10px] uppercase tracking-wider text-subtle">
            Id
            <input
              className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
              value={user}
              autoComplete="username"
              onChange={(e) => setUser(e.target.value)}
            />
          </label>
          <label className="block text-[10px] uppercase tracking-wider text-subtle">
            Password
            <input
              type="password"
              className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
              value={pass}
              autoComplete="current-password"
              onChange={(e) => setPass(e.target.value)}
            />
          </label>
          {err ? <p className="text-sm text-down">{err}</p> : null}
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Enter"}
          </Button>
        </form>
      </main>
    </div>
  );
}
