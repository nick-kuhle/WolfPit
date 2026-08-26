import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLockup, ChainChip } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { LiveTicker } from "@/components/ticker";
import { Button } from "@/components/ui/button";
import { equity } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useWolf();
  return (
    <div className="min-h-dvh bg-bg pb-16 text-fg lg:pb-0">
      <header className="flex h-14 items-center justify-between px-3 sm:px-5">
        <BrandLockup />
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">
            <ChainChip />
          </span>
          <Link to="/learn" className="hidden h-11 items-center px-3 text-sm text-muted hover:text-fg sm:flex">
            Learn
          </Link>
          <Link to="/trade">
            <Button size="sm">Try free</Button>
          </Link>
        </div>
      </header>

      <LiveTicker />

      <section className="relative overflow-hidden">
        <img src="/brand/hero-pit.jpg" alt="" decoding="async" className="absolute inset-0 size-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/55 to-bg/25" />
        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-brass">Paper pit · live tape · zero deposit</p>
          <h1 className="mt-4 max-w-2xl font-display text-5xl font-medium leading-[0.95] tracking-tight sm:text-7xl">
            Trade like the pit.
            <span className="italic text-brass"> Farm like you mean it.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            1,000 ETH and $100,000 in paper. Live crypto prices. Farms that print simulated WPIT. Dated options —
            not perps — so you can finally learn a call without lighting a wallet.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/trade" className="sm:w-auto">
              <Button className="h-12 w-full px-6 text-base sm:w-auto">Start with fake money →</Button>
            </Link>
            <Link to="/pools" className="sm:w-auto">
              <Button variant="outline" className="h-12 w-full px-6 text-base sm:w-auto">
                Show me the yield
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-subtle">Simulation. You will accept Terms before the desk or farms.</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-10 sm:grid-cols-3 sm:py-14">
        <Wow
          img="/brand/card-farm.jpg"
          kicker="Farms"
          title={`Stake ${(STAKE_APR * 100).toFixed(0)}%. Farm more.`}
          body="WPIT-USDC and WPIT-ETH farms emit into LPs. Harvest. A 1% tax feeds insurance. It is supposed to feel like interest. It is still paper."
          to="/pools"
          cta="Open the farms"
        />
        <Wow
          img="/brand/card-paper.jpg"
          kicker="Free paper"
          title="No wallet. No card. Press buy."
          body={`${fmtUsd(equity(s))} on the book right now. Reset anytime. Live ETH at ${fmtPx(s.eth)}. The bruise is real. The money isn’t.`}
          to="/trade"
          cta="Take a seat"
        />
        <Wow
          img="/brand/card-options.jpg"
          kicker="Vanillas"
          title="Calls and puts. With an expiry."
          body="Covered, cash-settled, weekly and monthly. If you’ve only ever touched perps, this will feel like a different sport. That’s the idea."
          to="/learn"
          cta="How a call works"
        />
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:grid-cols-3 sm:py-16">
          <Stat n="1,000 ETH" l="Paper stack" />
          <Stat n="$100,000" l="Paper USDC" />
          <Stat n="4×" l="Mini initial margin" />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">Three rings. One floor.</h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          <Step n="01" title="Paper desk" body="Board of the world’s most traded coins. Chart any ticker or 0x. Spot, minis, vanillas." />
          <Step n="02" title="Pools & farms" body="Add both legs. Watch APY. Harvest WPIT. Create a pair like Sushi." />
          <Step n="03" title="Stake" body="Junior to insurance. 12% simulated APR. First-loss if the pit has a bad day." />
        </ol>
        <Link to="/learn" className="mt-8 inline-block text-brass">
          Pit school — five minutes →
        </Link>
      </section>

      <SiteFooter />
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-4">
          {[
            { to: "/trade" as const, label: "Desk" },
            { to: "/pools" as const, label: "Farms" },
            { to: "/stake" as const, label: "Stake" },
            { to: "/learn" as const, label: "Learn" },
          ].map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider text-muted"
            >
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Wow({
  img,
  kicker,
  title,
  body,
  to,
  cta,
}: {
  img: string;
  kicker: string;
  title: string;
  body: string;
  to: "/trade" | "/pools" | "/learn";
  cta: string;
}) {
  return (
    <Link to={to} className="group overflow-hidden rounded-[var(--radius-xl)] border border-border bg-panel">
      <img src={img} alt="" decoding="async" className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
      <div className="p-5">
        <div className="font-mono text-[11px] uppercase tracking-wider text-brass">{kicker}</div>
        <h2 className="mt-2 font-display text-2xl font-medium leading-tight">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-4 text-sm text-fg">{cta} →</div>
      </div>
    </Link>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="font-display text-4xl font-medium tracking-tight text-brass sm:text-5xl">{n}</div>
      <div className="mt-1 text-sm text-muted">{l}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <div className="font-mono text-[11px] text-brass">{n}</div>
      <h3 className="mt-2 text-lg font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}
