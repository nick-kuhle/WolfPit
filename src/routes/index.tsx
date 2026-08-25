import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLockup, ChainChip } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk } from "@/lib/wolfpit/desk";
import { equity } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useWolf();
  const universe = useDesk((d) => d.universe);
  const tape = universe.slice(0, 18);
  const gainers = universe.filter((u) => u.change24 > 0).sort((a, b) => b.change24 - a.change24).slice(0, 4);
  const losers = universe.filter((u) => u.change24 < 0).sort((a, b) => a.change24 - b.change24).slice(0, 4);
  return (
    <div className="min-h-dvh bg-bg pb-16 text-fg lg:pb-0">
      <a
        href="#floor"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-20 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to floor
      </a>
      <header className="flex h-12 items-center justify-between border-b border-border px-3 sm:px-4">
        <BrandLockup />
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">
            <ChainChip />
          </span>
          <Link to="/trade" onClick={() => ping("Walking onto the floor", "brass")}>
            <Button size="sm">Floor</Button>
          </Link>
        </div>
      </header>

      <div className="flex gap-8 overflow-hidden border-b border-border bg-elevated py-2 font-mono text-[11px]">
        <div className="flex animate-none gap-8 px-4 whitespace-nowrap sm:animate-[ticker_40s_linear_infinite]">
          {(tape.length ? tape : [{ symbol: "ETH", price: s.eth, change24: 0 }]).concat(tape).map((t, i) => (
            <span key={`${t.symbol}-${i}`} className="shrink-0">
              <span className="text-brass">{t.symbol}</span>{" "}
              <span>{fmtPx(t.price || 0)}</span>{" "}
              <span className={t.change24 >= 0 ? "text-up" : "text-down"}>{fmtPct(t.change24)}</span>
            </span>
          ))}
        </div>
      </div>

      <section className="relative overflow-hidden border-b border-border">
        <img
          src="/brand/og-pit.jpg"
          alt=""
          className="absolute inset-0 size-full object-cover object-[center_42%] opacity-50"
        />
        <div className="absolute inset-0 bg-bg/45" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-bg to-transparent" />
        <div className="relative mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Open outcry · Base paper · live marks</p>
          <h1 className="mt-3 max-w-xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
            Step into the pit.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
            Three rings. One floor. Term futures and vanilla options, AMM pools, and staked WPIT — paper funds, live
            tape.
          </p>
        </div>
      </section>

      <main id="floor" className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="grid gap-3 sm:grid-cols-3">
          <Ring
            n="01"
            title="The desk"
            to="/trade"
            body="Board of the most traded names. Chart any ticker or 0x. Spot, minis, vanillas."
            cta="Open the board"
          />
          <Ring
            n="02"
            title="The pools"
            to="/pools"
            body="Sushi-style add. Constant product. WPIT farms on TEST pairs. Create a new ring."
            cta="Add liquidity"
          />
          <Ring
            n="03"
            title="The stake"
            to="/stake"
            body="WPIT first-loss junior to insurance. Harvest a 1% tax into the fund. Not a deposit."
            cta="Stake WPIT"
          />
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border sm:grid-cols-4">
          <Stat k="ETH" v={fmtPx(s.eth)} />
          <Stat k="WPIT" v={fmtPx(s.wpit)} />
          <Stat k="Paper book" v={fmtUsd(equity(s))} />
          <Stat k="Wallet" v={`${s.account.eth.toFixed(0)} ETH · ${fmtUsd(s.account.usdc)}`} />
        </dl>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Tape title="Gainers" rows={gainers} up />
          <Tape title="Losers" rows={losers} up={false} />
        </div>

        <section className="mt-10 grid gap-8 border-t border-border pt-8 sm:grid-cols-3">
          <Note title="Spot" body="Trade any listed token vs USDC. Type a contract. The pit lists a paper pool at the live mark." />
          <Note title="Minis" body="ETH term futures, 4× IM, weekly and monthly. Inventory-backed. Never naked." />
          <Note title="Vanillas" body="You buy. Vault sells covered calls and cash-secured puts. European, cash-settled." />
        </section>
      </main>
      <SiteFooter />
      <MobileDock />
    </div>
  );
}

function Ring({
  n,
  title,
  to,
  body,
  cta,
}: {
  n: string;
  title: string;
  to: "/trade" | "/pools" | "/stake";
  body: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      onClick={() => ping(cta, "brass")}
      className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface p-5"
    >
      <div className="font-mono text-[11px] uppercase tracking-wider text-brass">{n} · ring</div>
      <h2 className="mt-3 text-2xl font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-4 text-sm text-fg">{cta} →</div>
    </Link>
  );
}

function Tape({
  title,
  rows,
  up,
}: {
  title: string;
  rows: { symbol: string; price: number; change24: number }[];
  up: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h2 className={`text-[10px] uppercase tracking-wider ${up ? "text-up" : "text-down"}`}>{title}</h2>
      {rows.length === 0 ? <p className="mt-2 text-xs text-muted">Waiting on the tape…</p> : null}
      {rows.map((r) => (
        <div key={r.symbol} className="mt-2 flex justify-between font-mono text-xs">
          <span>{r.symbol}</span>
          <span>
            {fmtPx(r.price)}{" "}
            <span className={r.change24 >= 0 ? "text-up" : "text-down"}>{fmtPct(r.change24)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function MobileDock() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="grid grid-cols-5">
        {[
          { to: "/trade" as const, label: "Board" },
          { to: "/pools" as const, label: "Pools" },
          { to: "/stake" as const, label: "Stake" },
          { to: "/plan" as const, label: "Plan" },
          { to: "/admin" as const, label: "Ops" },
        ].map((n) => (
          <Link
            key={n.to}
            to={n.to}
            onClick={() => ping(n.label, "brass")}
            className="flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider text-muted"
          >
            {n.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-surface px-3 py-3 sm:px-4 sm:py-4">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-1 font-mono text-base tabular-nums sm:text-lg">{v}</dd>
    </div>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
