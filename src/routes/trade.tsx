import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Desk } from "@/components/desk/desk";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { SwapCard } from "@/components/swap/swap-card";
import { SWAP_CHAINS } from "@/lib/swap/chains";
import { SWAP_FEE_BPS, bpsToPct } from "@/lib/swap/config";
import { cn } from "@/lib/utils";

/**
 * The trade page hosts BOTH desks behind one toggle:
 *   • Simulation — the paper desk ($100k play money, full engine).
 *   • Live       — real, non-custodial on-chain swaps on Base (0x aggregator).
 *
 * The mode lives in the URL (?mode=sim|live, shareable + back-button works) and
 * the last choice is remembered in localStorage. URL wins over storage;
 * first-paint default is Simulation (paper) — real funds are always opt-in.
 */
export const Route = createFileRoute("/trade")({
  validateSearch: (s: Record<string, unknown>): { mode?: "sim" | "live" } => ({
    mode: s.mode === "live" ? "live" : s.mode === "sim" ? "sim" : undefined,
  }),
  component: TradePage,
});

type Mode = "sim" | "live";
const MODE_KEY = "wolfpit.trade-mode";

function TradePage() {
  const urlMode = Route.useSearch().mode;
  // Initial render derives from the URL (server + client agree → no hydration
  // mismatch, and shared ?mode=live links render live immediately).
  const [mode, setMode] = useState<Mode>(urlMode === "live" ? "live" : "sim");
  const nav = useNavigate();

  // No URL param? Restore the saved preference after hydration.
  useEffect(() => {
    if (urlMode) return;
    try {
      if (window.localStorage.getItem(MODE_KEY) === "live") setMode("live");
    } catch {
      /* storage unavailable — stay on paper */
    }
  }, [urlMode]);

  function choose(next: Mode) {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* storage unavailable — URL still carries the mode */
    }
    void nav({ to: "/trade", search: { mode: next }, replace: true });
  }

  return (
    <Shell desk>
      <ProductGate product="desk">
        <div className="flex h-full min-h-0 flex-col">
          <div className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-panel px-3 py-2">
            <div
              role="tablist"
              aria-label="Trading mode"
              className="flex items-center gap-1 rounded-full border border-brass/45 bg-elevated p-0.5 font-mono text-[10px] uppercase tracking-wider"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "sim"}
                onClick={() => choose("sim")}
                className={cn(
                  "pressable rounded-full px-3 py-1.5 transition-colors",
                  mode === "sim" ? "bg-brass text-bg" : "text-muted hover:text-fg",
                )}
              >
                Simulation
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "live"}
                onClick={() => choose("live")}
                className={cn(
                  "pressable rounded-full px-3 py-1.5 transition-colors",
                  mode === "live" ? "bg-brass text-bg" : "text-muted hover:text-fg",
                )}
              >
                Live · Base
              </button>
            </div>
            <p
              className={cn(
                "truncate font-mono text-[10px] uppercase tracking-wider",
                mode === "live" ? "text-warn" : "text-subtle",
              )}
            >
              {mode === "live" ? "Mainnet · real funds · non-custodial" : "Paper · $100k play money"}
            </p>
          </div>

          {mode === "sim" ? (
            <div className="min-h-0 flex-1">
              <Desk pane="trade" />
            </div>
          ) : (
            <LiveSpotPane />
          )}
        </div>
      </ProductGate>
    </Shell>
  );
}

function LiveSpotPane() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
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
        <SwapCard />
      </main>
      <SiteFooter />
    </div>
  );
}
