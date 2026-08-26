import { useEffect, useMemo, useState } from "react";
import { useDesk, wpitListing, type Listing } from "@/lib/wolfpit/desk";
import { searchTokens } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import { cn, fmtPct, fmtPx } from "@/lib/utils";

type TapeTab = "saved" | "hot" | "gainers" | "losers";
const COLLAPSED = 5;

export function MiniTape({ onPick }: { onPick: (l: Listing) => void }) {
  const universe = useDesk((s) => s.universe);
  const saved = useDesk((s) => s.saved);
  const toggleSave = useDesk((s) => s.toggleSave);
  const focus = useDesk((s) => s.focus);
  const wpitPx = useWolf((s) => s.wpit);
  const [tab, setTab] = useState<TapeTab>("saved");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Listing[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 1) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = window.setTimeout(() => {
      void searchTokens({ data: { q: query } })
        .then((rows) => {
          setHits(rows.map((r) => (r.symbol === "WPIT" ? wpitListing(wpitPx, r.change24, r.volume24 || 2_400_000) : r)));
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 160);
    return () => window.clearTimeout(t);
  }, [q, wpitPx]);

  const rows = useMemo(() => {
    if (q.trim()) return hits;
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
  }, [universe, saved, tab, q, hits]);

  const shown = q.trim() || open ? rows : rows.slice(0, COLLAPSED);

  return (
    <div className="shrink-0 border-b border-border bg-panel">
      <div className="px-2 pt-1.5">
        <input
          className="h-9 w-full rounded-md border border-border bg-elevated px-2.5 font-mono text-[11px]"
          placeholder="Search ticker, name, or 0x"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q.trim() ? (
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-subtle">
            {busy ? "Searching…" : `${hits.length} hit${hits.length === 1 ? "" : "s"}`}
          </p>
        ) : null}
      </div>
      {q.trim() ? null : (
        <div className="flex items-center gap-1 px-2 pt-1">
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
      )}
      <div className={cn("overflow-y-auto", q.trim() || open ? "max-h-48" : "max-h-[8.5rem]")}>
        {shown.length === 0 ? (
          <p className="px-3 py-2 font-mono text-[10px] text-muted">
            {q.trim() ? (busy ? "Looking…" : "No matches.") : tab === "saved" ? "Star a name to keep it here." : "Waiting on the tape…"}
          </p>
        ) : null}
        {shown.map((r) => {
          const on = focus.symbol === r.symbol;
          const up = r.change24 >= 0;
          const starred = saved.includes(r.symbol.toUpperCase());
          return (
            <div
              key={`${r.symbol}-${r.contract ?? r.geckoId ?? r.name}`}
              className={cn("grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center border-t border-border/60", on ? "bg-brass/10" : "hover:bg-elevated")}
            >
              <button
                type="button"
                className={cn("grid h-9 place-items-center text-[13px]", starred ? "text-brass" : "text-subtle")}
                onClick={() => toggleSave(r.symbol, r)}
                aria-label={starred ? "Remove from saved" : "Save"}
              >
                {starred ? "★" : "☆"}
              </button>
              <button type="button" onClick={() => onPick(r)} className="min-w-0 py-1.5 text-left">
                <span className="font-mono text-[12px] font-medium">{r.symbol}</span>
                <span className="ml-1.5 truncate text-[10px] text-subtle">{r.name}</span>
              </button>
              <button type="button" onClick={() => onPick(r)} className="flex items-baseline gap-2 px-3 py-1.5 font-mono text-[11px] tabular-nums">
                <span className="text-muted">{r.price ? fmtPx(r.price) : "—"}</span>
                <span className={cn("w-14 text-right", up ? "text-up" : "text-down")}>{fmtPct(r.change24)}</span>
              </button>
            </div>
          );
        })}
      </div>
      {!q.trim() && rows.length > COLLAPSED ? (
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
