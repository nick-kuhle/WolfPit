import { useState } from "react";
import { AssetCard } from "@/components/desk/asset-card";
import { AccountBar } from "@/components/desk/account-bar";
import { History } from "@/components/desk/history";
import { Portfolio } from "@/components/desk/portfolio";
import { Watchlist } from "@/components/desk/watchlist";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk } from "@/lib/wolfpit/desk";
import { chainLabel } from "@/lib/wolfpit/chain";
import { cn } from "@/lib/utils";

type Pane = "watch" | "port" | "hist";

export function Desk() {
  const cardOpen = useDesk((s) => s.cardOpen);
  const [pane, setPane] = useState<Pane>("watch");

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-bg">
      <AccountBar />
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-brass">The board</p>
          <p className="text-xs text-muted">Tap a name. Chart opens on a card. Board stays.</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-brass">paper · {chainLabel()}</span>
      </div>

      <div className="relative min-h-0 flex-1">
        {pane === "watch" && <Watchlist />}
        {pane === "port" && <Portfolio />}
        {pane === "hist" && <History />}
        {cardOpen && pane === "watch" ? <AssetCard /> : null}
      </div>

      <nav className="grid grid-cols-3 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] lg:grid-cols-3">
        {(["watch", "port", "hist"] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setPane(k);
              ping(k === "watch" ? "Board" : k === "port" ? "Wallet" : "History", "brass");
            }}
            className={cn(
              "flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider",
              pane === k ? "text-fg" : "text-muted",
            )}
          >
            {k === "watch" ? "Board" : k === "port" ? "Wallet" : "History"}
          </button>
        ))}
      </nav>
    </div>
  );
}
