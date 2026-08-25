import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLockup, ChainChip } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { equity } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useWolf();
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <BrandLockup />
        <div className="flex items-center gap-3">
          <ChainChip />
          <nav className="flex items-center text-sm">
            <Link to="/trade" className="flex h-11 items-center px-3 text-muted hover:text-fg">
              Desk
            </Link>
            <Link to="/pools" className="flex h-11 items-center px-3 text-muted hover:text-fg">
              Pools
            </Link>
            <Link to="/stake" className="flex h-11 items-center px-3 text-muted hover:text-fg">
              Stake
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative min-h-[28rem] overflow-hidden border-b border-border sm:min-h-[36rem]">
        <img
          src="/brand/og-pit.jpg"
          alt=""
          className="absolute inset-0 size-full object-cover object-center opacity-55"
          width={1792}
          height={1008}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
        <div className="relative mx-auto flex min-h-[28rem] max-w-5xl flex-col justify-end px-4 py-12 sm:min-h-[36rem] sm:py-16">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-brass">
            Simulation · dated markets · never naked
          </p>
          <h1 className="max-w-xl text-4xl font-medium leading-[1.1] tracking-tight sm:text-5xl">
            The pit for dated crypto futures and options.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
            Not perps. Weekly and monthly vanilla, inventory-backed, quoted off pool depth. Paper trading
            against WOLFPIT-USDC-TEST and WOLFPIT-ETH-TEST. Same desk later points at live contracts.
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

      <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border sm:grid-cols-4">
          <Stat k="ETH mark" v={fmtPx(s.eth)} />
          <Stat k="WPIT" v={fmtPx(s.wpit)} />
          <Stat k="Paper equity" v={fmtUsd(equity(s))} />
          <Stat k="Mini" v="0.1 ETH · 4× IM" />
        </dl>

        <ol className="mt-14 grid gap-6 sm:grid-cols-3">
          <Step n="01" title="Desk" to="/trade" body="Spot, mini futures, mini options. Vault hedges 1:1. If inventory is gone, the quote blanks." />
          <Step n="02" title="Pools" to="/pools" body="Buy WPIT or ETH on the desk, then add both legs. Gauges 70 / 20 / 10. ETH-USDC is unfarmed." />
          <Step n="03" title="Stake" to="/stake" body="WPIT is first-loss junior to insurance. Harvest takes a 1% tax into the fund." />
        </ol>

        <section className="mt-16 grid gap-8 border-t border-border pt-12 sm:grid-cols-3">
          <Note title="Spot" body="Constant-product pools. Fee 5–30 bps on ETH-USDC from realized vol. Test pairs: WPIT-USDC-TEST, WPIT-ETH-TEST." />
          <Note title="Mini futures" body="Expiry, variation, 4× initial margin. Size dies when util hits 40%. Circuit can halt new shorts." />
          <Note title="Mini options" body="You buy. Vault sells covered calls and cash-secured puts only. European, cash-settled. Never naked." />
        </section>

        <p className="mt-16 max-w-2xl text-xs leading-relaxed text-subtle">
          Not an offer of futures or options. Not a deposit. No promised return. This software is a paper
          desk. It does not custody assets.
        </p>
      </main>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-surface px-4 py-4">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-1 font-mono text-lg tabular-nums">{v}</dd>
    </div>
  );
}

function Step({ n, title, to, body }: { n: string; title: string; to: "/trade" | "/pools" | "/stake"; body: string }) {
  return (
    <Link to={to} className="block rounded-[var(--radius-lg)] border border-border bg-surface p-5 hover:border-border-strong">
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
