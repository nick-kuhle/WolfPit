import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLockup, ChainChip } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { equity } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useWolf();
  const ch = change(s.candles);
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-20 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </a>
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <BrandLockup />
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline">
            <ChainChip />
          </span>
          <nav className="flex items-center text-sm">
            <Link to="/trade" className="flex h-11 items-center px-3 text-muted hover:text-fg">
              Desk
            </Link>
            <Link to="/pools" className="hidden h-11 items-center px-3 text-muted hover:text-fg sm:flex">
              Pools
            </Link>
            <Link to="/stake" className="hidden h-11 items-center px-3 text-muted hover:text-fg sm:flex">
              Stake
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative min-h-[32rem] overflow-hidden border-b border-border sm:min-h-[40rem]">
        <img
          src="/brand/og-pit.jpg"
          alt=""
          className="absolute inset-0 size-full object-cover object-center opacity-50"
          width={1792}
          height={1008}
        />
        <div className="absolute inset-0 bg-bg/40" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-bg to-transparent" />
        <div className="relative mx-auto flex min-h-[32rem] max-w-5xl flex-col justify-end px-4 py-12 sm:min-h-[40rem] sm:py-16">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-brass">
            Simulation · dated markets · never naked
          </p>
          <h1 className="max-w-xl text-4xl font-medium leading-[1.08] tracking-tight sm:text-5xl">
            The pit for dated crypto futures and options.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
            Not perps. Weekly and monthly vanilla, inventory-backed, quoted off pool depth. Paper against
            WOLFPIT-USDC-TEST and WOLFPIT-ETH-TEST. Same desk later points at live contracts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/trade">
              <Button>Open the desk</Button>
            </Link>
            <Link to="/pools">
              <Button variant="outline">Add liquidity</Button>
            </Link>
          </div>
        </div>
      </section>

      <main id="main" className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border sm:grid-cols-4">
          <Stat k="ETH mark" v={fmtPx(s.eth)} sub={fmtPct(ch)} up={ch >= 0} />
          <Stat k="WPIT" v={fmtPx(s.wpit)} />
          <Stat k="Paper equity" v={fmtUsd(equity(s))} />
          <Stat k="Mini" v="0.1 ETH · 4×" />
        </dl>

        <ol className="mt-14 grid gap-4 sm:grid-cols-3">
          <Step n="01" title="Desk" to="/trade" body="Spot, mini futures, mini options. Vault hedges 1:1. If inventory is gone, the quote blanks." />
          <Step n="02" title="Pools" to="/pools" body="Buy WPIT or ETH on the desk, then add both legs. Gauges 70 / 20 / 10. ETH-USDC is unfarmed." />
          <Step n="03" title="Stake" to="/stake" body="WPIT is first-loss junior to insurance. Harvest takes a 1% tax into the fund." />
        </ol>

        <section className="mt-16 grid gap-8 border-t border-border pt-12 sm:grid-cols-3">
          <Note title="Spot" body="Constant-product pools. Fee 5–30 bps on ETH-USDC from realized vol. Test pairs: WPIT-USDC-TEST, WPIT-ETH-TEST." />
          <Note title="Mini futures" body="Expiry, variation, 4× initial margin. Size dies when util hits 40%. Circuit can halt new shorts." />
          <Note title="Mini options" body="You buy. Vault sells covered calls and cash-secured puts only. European, cash-settled. Never naked." />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function change(candles: { c: number }[]) {
  if (candles.length < 30) return 0;
  const a = candles[candles.length - 30]!.c;
  const b = candles[candles.length - 1]!.c;
  return a > 0 ? (b - a) / a : 0;
}

function Stat({ k, v, sub, up }: { k: string; v: string; sub?: string; up?: boolean }) {
  return (
    <div className="bg-surface px-4 py-4">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-1 font-mono text-lg tabular-nums">{v}</dd>
      {sub ? <dd className={`font-mono text-xs tabular-nums ${up ? "text-up" : "text-down"}`}>{sub}</dd> : null}
    </div>
  );
}

function Step({ n, title, to, body }: { n: string; title: string; to: "/trade" | "/pools" | "/stake"; body: string }) {
  return (
    <Link
      to={to}
      className="block rounded-[var(--radius-lg)] border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-elevated"
    >
      <div className="font-mono text-[11px] uppercase tracking-wider text-brass">{n}</div>
      <h2 className="mt-2 text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </Link>
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
