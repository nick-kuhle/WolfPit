import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { LiveTicker } from "@/components/ticker";
import { Button } from "@/components/ui/button";
import { PIT_OPEN, compBoard, compLive } from "@/lib/wolfpit/comp";
import { equity, farmApy } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useWolf();
  const join = useWolf((st) => st.joinComp);
  const nav = useNavigate();
  const now = Date.now();
  const live = compLive(now);
  const board = compBoard(now, { name: "You", equity: equity(s), joined: s.compJoined });
  const you = board.find((r) => r.you);
  const ends = new Date(PIT_OPEN.end).toUTCString().replace("GMT", "UTC");

  return (
    <Shell>
      <LiveTicker />

      <section className="relative overflow-hidden border-b border-brass/40 bg-brass text-bg">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <span className="fly-ticket absolute left-[8%] top-6 rounded-sm bg-ticket px-3 py-1 font-mono text-[10px] text-bg">BUY 12</span>
          <span className="fly-ticket absolute right-[12%] top-10 rounded-sm bg-bg px-3 py-1 font-mono text-[10px] text-brass" style={{ animationDelay: "0.8s" }}>
            SELL 4
          </span>
          <span className="fly-ticket absolute left-[40%] top-2 rounded-sm bg-down px-3 py-1 font-mono text-[10px] text-fg" style={{ animationDelay: "1.4s" }}>
            FILL
          </span>
          <span className="fly-ticket absolute right-[28%] bottom-6 rounded-sm bg-ticket px-3 py-1 font-mono text-[10px] text-bg" style={{ animationDelay: "1.8s" }}>
            1M WPIT
          </span>
        </div>
        <div className="relative mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:grid-cols-[minmax(0,1.2fr)_16rem] sm:py-12">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-bg px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-brass">Free entry</span>
              <span className="rounded-full bg-bg/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]">Compete for prizes</span>
              <span className="rounded-full bg-bg/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]">Paper only</span>
            </div>
            <h2 className="mt-4 font-display text-4xl font-medium leading-[0.95] sm:text-6xl">
              Pit Open.
              <span className="italic"> Winner takes 1,000,000 WPIT.</span>
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed">
              A trading competition. No deposit. Everyone starts with ${PIT_OPEN.entryUsdc.toLocaleString()} simulated
              USDC. Last fill {ends}. 2nd gets 250,000 WPIT. 3rd gets 100,000. The flying tickets are the pit shouting.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {s.compJoined ? (
                <Link to="/trade">
                  <Button className="h-12 bg-bg px-6 text-brass hover:bg-bg">You're in · trade now</Button>
                </Link>
              ) : (
                <Button
                  className="h-12 bg-bg px-6 text-brass hover:bg-bg"
                  onClick={() => {
                    join();
                    void nav({ to: "/trade" });
                  }}
                  disabled={!live}
                >
                  {live ? "Enter free · $100k paper" : "Doors closed"}
                </Button>
              )}
              <Link to="/trade">
                <Button variant="outline" className="h-12 border-bg px-6 text-bg hover:bg-bg/10">
                  Watch the board
                </Button>
              </Link>
            </div>
            {you ? <p className="mt-3 font-mono text-xs">You're #{you.place} · {fmtUsd(you.equity)}</p> : null}
          </div>
          <ol className="space-y-2">
            <li className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-80">Live board</li>
            {board.slice(0, 5).map((r) => (
              <li
                key={r.name}
                className={`flex items-center justify-between rounded-md px-3 py-2 ${r.you ? "bg-bg text-brass" : "bg-bg/15"}`}
              >
                <span className="font-mono text-xs">
                  {r.place}. {r.name}
                </span>
                <span className="font-mono text-xs">{fmtUsd(r.equity)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

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

      <section className="border-b border-border bg-elevated">
        <div className="mx-auto grid max-w-5xl gap-3 px-4 py-8 sm:grid-cols-3">
          {[
            { id: "ETH-USDC" as const, name: "ETH / USDC" },
            { id: "WPIT-USDC-TEST" as const, name: "WPIT / USDC" },
            { id: "WPIT-ETH-TEST" as const, name: "WPIT / ETH" },
          ].map((p) => (
            <Link key={p.id} to="/pools" className="rounded-[var(--radius-lg)] border border-brass/30 bg-panel p-4 hover:border-brass">
              <div className="font-mono text-[10px] uppercase tracking-wider text-brass">Farm APY</div>
              <div className="mt-1 font-display text-3xl text-up">{fmtPct(farmApy(s, p.id))}</div>
              <div className="mt-1 text-sm text-muted">{p.name} pool</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-10 sm:grid-cols-3 sm:py-14">
        <Wow
          img="/brand/card-farm.jpg"
          kicker="Farms"
          title={`Stake ${(STAKE_APR * 100).toFixed(0)}%. Farm more.`}
          body="WPIT-USDC and WPIT-ETH farms emit into LPs. Harvest. A 1% tax feeds insurance."
          to="/pools"
          cta="Open the farms"
        />
        <Wow
          img="/brand/card-paper.jpg"
          kicker="Free paper"
          title="No wallet. Press buy."
          body={`${fmtUsd(equity(s))} on the book. Live ETH at ${fmtPx(s.eth)}. The bruise is real. The money isn’t.`}
          to="/trade"
          cta="Take a seat"
        />
        <Wow
          img="/brand/card-options.jpg"
          kicker="Vanillas"
          title="Calls and puts. With an expiry."
          body="Covered, cash-settled, weekly and monthly. If you’ve only ever touched perps, this is a different sport."
          to="/learn"
          cta="How a call works"
        />
      </section>
      <SiteFooter />
    </Shell>
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
    <Link to={to} className="ticket-card group overflow-hidden rounded-[var(--radius-xl)] border border-border bg-panel">
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