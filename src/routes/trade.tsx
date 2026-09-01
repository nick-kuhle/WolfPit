import { Link, createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk/desk";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { SwapWidget } from "@/components/swap/swap-card";
import { SwapChart } from "@/components/swap/swap-chart";
import { useSwap } from "@/lib/swap/use-swap";
import { SWAP_CHAINS } from "@/lib/swap/chains";
import { SWAP_FEE_BPS, bpsToPct } from "@/lib/swap/config";
import { cn } from "@/lib/utils";
import { useMode } from "@/lib/wolfpit/use-mode";

/**
 * The trade page hosts the desks:
 *   • Simulation — the paper desk ($100k play money, full engine).
 *   • Live       — real, non-custodial on-chain swaps on Base (0x aggregator).
 *   • Testnet    — Base Sepolia; selectable once the contracts are deployed.
 *
 * The mode itself is NOT owned here. This page used to keep its own two-way
 * toggle with its own state and its own localStorage write, which meant that
 * after the app-wide selector arrived there were two switches that could
 * disagree with each other. `ModeProvider` owns it now; this page reads it.
 *
 * `?mode=` is still validated so shared links keep working — the provider
 * reads it on mount, then mirrors the choice to the URL and localStorage.
 */
export const Route = createFileRoute("/trade")({
  validateSearch: (s: Record<string, unknown>): { mode?: "sim" | "testnet" | "live" } => ({
    mode: s.mode === "live" ? "live" : s.mode === "testnet" ? "testnet" : s.mode === "sim" ? "sim" : undefined,
  }),
  component: TradePage,
});

function TradePage() {
  const { mode } = useMode();

  return (
    <Shell desk>
      <ProductGate product="desk">
        <div className="flex h-full min-h-0 flex-col">
          {/*
            The mode tabs used to live here. They are in the app shell now
            (ModeToggle), so every page has them and there is exactly one
            switch. This bar keeps the per-desk status line only.
          */}
          <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-panel px-3 py-2">
            <p className="truncate font-mono text-[10px] uppercase tracking-wider text-subtle">
              {mode === "sim" ? "Simulation desk" : mode === "testnet" ? "Base Sepolia desk" : "Live spot"}
            </p>
            <p
              className={cn(
                "truncate font-mono text-[10px] uppercase tracking-wider",
                mode === "live" ? "text-warn" : mode === "testnet" ? "text-brass" : "text-subtle",
              )}
            >
              {mode === "live"
                ? "Mainnet · real funds · non-custodial"
                : mode === "testnet"
                  ? "Base Sepolia · test tokens · no real value"
                  : "Paper · $100k play money"}
            </p>
          </div>

          {mode === "sim" ? (
            <div className="min-h-0 flex-1">
              <Desk pane="trade" />
            </div>
          ) : mode === "testnet" ? (
            <TestnetPane />
          ) : (
            <LiveSpotPane />
          )}
        </div>
      </ProductGate>
    </Shell>
  );
}

/**
 * Base Sepolia is deployed (the tab is only selectable when
 * VITE_VAULT_SEPOLIA is set) but no order actually routes on-chain yet — that
 * is Phase 4. Say so, rather than showing a paper desk under a testnet label
 * and letting someone believe their fills touched Sepolia.
 */
function TestnetPane() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-brass/40 bg-brass/5 p-5 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass">Base Sepolia</p>
        <h2 className="mt-2 text-lg font-medium">Contracts are live. Order routing is not.</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The desk contracts are deployed on Sepolia and the admin panel can mint test tokens against them. Routing
          orders to the vault from this page lands in Phase 4 — until then this tab deliberately shows nothing to
          trade, rather than a paper fill dressed up as a testnet one.
        </p>
      </div>
    </div>
  );
}

function LiveSpotPane() {
  // Lift the swap state so the chart and the widget share one selected pair.
  const swap = useSwap();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Spot · live · Base by default</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Swap at the best price, on {SWAP_CHAINS.length} chains.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted">
            Pick a chain (Base is home), search any token, and route through a DEX aggregator that scans liquidity for
            the cheapest, fastest, safest fill. Non-custodial. A flat {bpsToPct(SWAP_FEE_BPS)} trading fee — cut 50%
            when you hold WPIT — is shown before you sign and goes directly to WolfPit.{" "}
            <Link to="/info" className="text-brass hover:underline">
              See all fees →
            </Link>
          </p>
        </div>
        {/* Chart for the selected pair beside the swap widget (stacks on mobile). */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="order-2 lg:order-1">
            <SwapChart swap={swap} height={320} />
          </div>
          <div className="order-1 lg:order-2">
            <SwapWidget swap={swap} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
