import { useMemo, useState } from "react";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { cn, fmtPct, fmtPx } from "@/lib/utils";

type TapeTab = "saved" | "hot" | "gainers" | "losers";
const COLLAPSED = 3;

export function MiniTape({ onPick }: { onPick: (l: Listing) => void }) {
  const universe = useDesk((s) => s.universe);
  const saved = useDesk((s) => s.saved);
  const focus = useDesk((s) => s.focus);
  const [tab, setTab] = useState<TapeTab>("hot");
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const u = universe.slice();
    if (tab === "saved") {
      const rank = new Map(saved.map((s, i) => [s, i]));
      return u
        .filter((r) => saved.includes(r.symbol.toUpperCase()))
        .sort((a, b) => (rank.get(a.symbol.toUpperCase()) ?? 99) - (rank.get(b.symbol.toUpperCase()) ?? 99));
    }
    if (tab === "gainers") return u.sort((a, b) => b.change24 - a.change24);
    if (tab === "losers") return u.sort((a, b) => a.change24 - b.change24);
    return u.sort((a, b) => (a.symbol === "WPIT" ? -1 : b.symbol === "WPIT" ? 1 : b.volume24 - a.volume24));
  }, [universe, saved, tab]);

  const shown = open ? rows : rows.slice(0, COLLAPSED);

  return (
    <div className="shrink-0 border-b border-border bg-panel">
      <div className="flex items-center gap-1 px-2 pt-1.5">
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
        <button
          type="button"
          className="pressable ml-auto grid size-8 place-items-center text-brass"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse watchlist" : "Expand watchlist"}
        >
          <span className="font-mono text-base leading-none">{open ? "▴" : "▾"}</span>
        </button>
      </div>
      <div className={cn("overflow-y-auto", open ? "max-h-40" : "max-h-[6.75rem]")}>
        {shown.length === 0 ? (
          <p className="px-3 py-2 font-mono text-[10px] text-muted">
            {tab === "saved" ? "Star names on the tape to keep them here." : "Waiting on the tape…"}
          </p>
        ) : null}
        {shown.map((r) => {
          const on = focus.symbol === r.symbol;
          const up = r.change24 >= 0;
          return (
            <button
              key={`${r.symbol}-${r.contract ?? r.geckoId ?? r.name}`}
              type="button"
              onClick={() => onPick(r)}
              className={cn(
                "flex w-full items-center justify-between border-t border-border/60 px-3 py-1.5 text-left",
                on ? "bg-brass/10" : "hover:bg-elevated",
              )}
            >
              <span className="font-mono text-[12px] font-medium">{r.symbol}</span>
              <span className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
                <span className="text-muted">{r.price ? fmtPx(r.price) : "—"}</span>
                <span className={cn("w-14 text-right", up ? "text-up" : "text-down")}>{fmtPct(r.change24)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {rows.length > COLLAPSED ? (
        <button
          type="button"
          className="flex h-8 w-full items-center justify-center gap-1 border-t border-border font-mono text-[10px] uppercase tracking-wider text-brass"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? `▴  fold  ·  ${COLLAPSED} names` : `▾  ${rows.length - COLLAPSED} more`}
        </button>
      ) : null}
    </div>
  );
}
