import { useMemo, useState } from "react";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { cn, fmtPct, fmtPx } from "@/lib/utils";

type TapeTab = "saved" | "hot" | "gainers" | "losers";

export function MiniTape({ onPick }: { onPick: (l: Listing) => void }) {
  const universe = useDesk((s) => s.universe);
  const saved = useDesk((s) => s.saved);
  const focus = useDesk((s) => s.focus);
  const [tab, setTab] = useState<TapeTab>("hot");

  const rows = useMemo(() => {
    const u = universe.slice();
    if (tab === "saved") {
      const rank = new Map(saved.map((s, i) => [s, i]));
      return u
        .filter((r) => saved.includes(r.symbol.toUpperCase()))
        .sort((a, b) => (rank.get(a.symbol.toUpperCase()) ?? 99) - (rank.get(b.symbol.toUpperCase()) ?? 99));
    }
    if (tab === "gainers") return u.sort((a, b) => b.change24 - a.change24).slice(0, 24);
    if (tab === "losers") return u.sort((a, b) => a.change24 - b.change24).slice(0, 24);
    return u.sort((a, b) => (a.symbol === "WPIT" ? -1 : b.symbol === "WPIT" ? 1 : b.volume24 - a.volume24)).slice(0, 24);
  }, [universe, saved, tab]);

  return (
    <div className="shrink-0 border-b border-border bg-panel">
      <div className="flex gap-1 px-2 pt-1.5">
        {(["saved", "hot", "gainers", "losers"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "h-7 rounded-full px-2.5 font-mono text-[10px] uppercase tracking-wider",
              tab === t ? "bg-brass text-bg" : "text-muted",
            )}
          >
            {t === "gainers" ? "win" : t === "losers" ? "lose" : t}
          </button>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {rows.length === 0 ? (
          <p className="px-1 py-1 font-mono text-[10px] text-muted">
            {tab === "saved" ? "Star names on the tape to keep them here." : "Waiting on the tape…"}
          </p>
        ) : null}
        {rows.map((r) => {
          const on = focus.symbol === r.symbol;
          const up = r.change24 >= 0;
          return (
            <button
              key={`${r.symbol}-${r.contract ?? r.geckoId ?? r.name}`}
              type="button"
              onClick={() => onPick(r)}
              className={cn(
                "shrink-0 rounded-md border px-2 py-1 text-left",
                on ? "border-brass bg-brass/10" : "border-border bg-elevated",
              )}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[11px] font-medium">{r.symbol}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">{r.price ? fmtPx(r.price) : "—"}</span>
                <span className={cn("font-mono text-[10px] tabular-nums", up ? "text-up" : "text-down")}>{fmtPct(r.change24)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
