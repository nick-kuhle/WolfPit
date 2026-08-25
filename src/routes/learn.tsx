import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/learn")({ component: LearnPage });

function LearnPage() {
  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Pit school</p>
        <h1 className="mt-2 font-display text-4xl font-medium tracking-tight sm:text-5xl">
          Options with an expiry. Farms with a number. Paper, so you can actually press the button.
        </h1>
        <p className="mt-4 max-w-xl text-muted">
          Crypto taught perps. The old pits taught dated futures and vanillas. WolfPit is the second one, simulated,
          on live prices.
        </p>

        <div className="mt-10 space-y-3">
          <Lesson
            q="What is paper trading?"
            a="You start with 1,000 ETH and 100,000 USDC that are not withdrawable and not real. Fills, P&L, and liquidations run on the same rules we intend to use live. Lose the book, hit Reset paper. No card. No wallet required to try."
          />
          <Lesson
            q="What is a farm, and why does it pay?"
            a="A farm is extra WPIT emitted to people who put both legs in a pool (or who stake). The headline APY is simulated emissions ÷ TVL, utilization-weighted. Harvest takes a 1% tax into the insurance fund. It is not a bank account. Emissions can be cut to zero."
          />
          <Lesson
            q="Spot vs the pit"
            a="Spot is a Uniswap-style x·y=k pool. You swap tokens. The pool price can differ from Coinbase. That’s the point of an AMM. Fees 5–30 bps on ETH-USDC from realized vol."
          />
          <Lesson
            q="Mini futures (not perps)"
            a="A mini is 0.1 ETH, with a Friday or month-end expiry. You post 25% initial margin (4×). The vault hedges 1:1 with inventory. If ETH moons against a short, variation comes from the book, then insurance, then listings pause. No infinite leverage. No funding rate."
          />
          <Lesson
            q="Calls and puts, the old way"
            a="You only buy. The vault only sells if it is covered: a call is backed by ETH, a put by USDC at strike. European, cash-settled, smile-skewed IV. If the vault cannot cover, the quote blanks. That is the product — not a naked casino."
          />
          <Lesson
            q="MKT, LMT, STP, DAY, GTC"
            a="Market fills now. Limit rests until the live print crosses. Stop becomes a market when last trades through your stop. DAY dies at UTC midnight. GTC lives until you cancel. IOC fills or dies."
          />
          <Lesson
            q="What can go wrong?"
            a="Inventory caps (40% util). Circuits on 12% hour moves. Short-gamma halt if insurance is thin. Liquidation at 12.5% maintenance. Paper still teaches the bruise without emptying a wallet."
          />
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link to="/trade">
            <Button className="w-full sm:w-auto">Try the desk free</Button>
          </Link>
          <Link to="/pools">
            <Button variant="outline" className="w-full sm:w-auto">
              See the farms
            </Button>
          </Link>
        </div>
      </main>
      <SiteFooter />
    </Shell>
  );
}

function Lesson({ q, a }: { q: string; a: string }) {
  return (
    <details className="rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3">
      <summary className="cursor-pointer text-base font-medium text-fg">{q}</summary>
      <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
    </details>
  );
}
