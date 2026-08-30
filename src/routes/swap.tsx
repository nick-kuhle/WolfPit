import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { SwapCard } from "@/components/swap/swap-card";
import { bpsToPct, SWAP_FEE_BPS } from "@/lib/swap/config";

export const Route = createFileRoute("/swap")({ component: SwapPage });

function SwapPage() {
  return (
    <Shell>
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="mb-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Spot · live on Base</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Swap at the best price on Base.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted">
            Market orders route through a DEX aggregator that scans Base liquidity for the
            cheapest, fastest, safest fill. Non-custodial. A flat {bpsToPct(SWAP_FEE_BPS)} trading
            fee — cut 50% when you hold WPIT — is shown before you sign and goes directly to WolfPit.{" "}
            <Link to="/info" className="text-brass hover:underline">
              See all fees →
            </Link>
          </p>
        </div>
        <SwapCard />
      </main>
      <SiteFooter />
    </Shell>
  );
}
