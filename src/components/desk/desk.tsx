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
  const closeCard = useDesk((s) => s.closeCard);
  const expanded = useDesk((s) => s.expanded);
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
        {cardOpen && pane === "watch" ? (
          <>
            {expanded ? null : (
              <button
                type="button"
                aria-label="Close card"
                className="absolute inset-0 z-20 bg-bg/50"
                onClick={closeCard}
              />
            )}
            <AssetCard />
          </>
        ) : null}
      </div>
    </div>
  );
}