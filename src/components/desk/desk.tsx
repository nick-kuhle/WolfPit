import { useState } from "react";
import { AssetCard } from "@/components/desk/asset-card";
import { AccountBar } from "@/components/desk/account-bar";
import { History } from "@/components/desk/history";
import { Portfolio } from "@/components/desk/portfolio";
import { Watchlist } from "@/components/desk/watchlist";
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
      <div className="flex items-center gap-3 border-b border-border px-3">
        {(["watch", "port", "hist"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setPane(k)}
            className={cn(
              "h-11 text-xs uppercase tracking-wider",
              pane === k ? "text-fg" : "text-muted",
            )}
          >
            {k === "watch" ? "Board" : k === "port" ? "Wallet" : "History"}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-brass">paper · {chainLabel()}</span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {pane === "watch" && <Watchlist />}
        {pane === "port" && <Portfolio />}
        {pane === "hist" && <History />}
        {cardOpen && pane === "watch" ? <AssetCard /> : null}
      </div>
    </div>
  );
}
