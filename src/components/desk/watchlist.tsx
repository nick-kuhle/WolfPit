import { useEffect, useMemo, useState } from "react";
import { useDesk, wpitListing, type Listing } from "@/lib/wolfpit/desk";
import { CHAINS, getChainTape, searchTokens } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Tab = "saved" | "hot" | "gainers" | "losers" | "chains";

export function Watchlist({ onPick }: { onPick?: (l: Listing) => void }) {
  const universe = useDesk((s) => s.universe);
  const chainTape = useDesk((s) => s.chainTape);
  const chainId = useDesk((s) => s.chainId);
  const setChainId = useDesk((s) => s.setChainId);
  const setChainTape = useDesk((s) => s.setChainTape);
  const focus = useDesk((s) => s.focus);
  const openCard = useDesk((s) => s.openCard);
  const saved = useDesk((s) => s.saved);
  const toggleSave = useDesk((s) => s.toggleSave);
  const [tab, setTab] = useState<Tab>("hot");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Listing[]>([]);
  const [busy, setBusy] = useState(false);
  const [chainBusy, setChainBusy] = useState(false);
  const listToken = useWolf((s) => s.listToken);
  const wpitPx = useWolf((s) => s.wpit);

  useEffect(() => {
    if (tab !== "chains") return;
    let dead = false;
    setChainBusy(true);
    void getChainTape({ data: { network: chainId } })
      .then((rows) => {
        if (!dead) setChainTape(rows);
      })
      .catch(() => {
        if (!dead) setChainTape([]);
      })
      .finally(() => {
        if (!dead) setChainBusy(false);
      });
    return () => {
      dead = true;
    };
  }, [tab, chainId, setChainTape]);

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
          setHits(
            rows.map((r) => (r.symbol === "WPIT" ? wpitListing(wpitPx, r.change24, r.volume24 || 2_400_000) : r)),
          );
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 180);
    return () => window.clearTimeout(t);
  }, [q, wpitPx]);

  const rows = useMemo(() => {
    if (q.trim()) return hits;
    if (tab === "chains") return chainTape;
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
  }, [universe, chainTape, tab, q, hits, saved]);

  function pick(l: Listing) {
    const listing = l.symbol === "WPIT" ? wpitListing(wpitPx, l.change24, l.volume24) : l;
    if (onPick) {
      onPick(listing);
      setQ("");
      setHits([]);
      return;
    }
    openCard(listing);
    listToken(listing.symbol, listing.price || 1);
    setQ("");
    setHits([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-3 py-2">
        <input
          className="h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-xs"
          placeholder="Search ticker, name, or 0x"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q.trim() ? (
          <p className="mt-1 text-[10px] uppercase tracking-wider text-subtle">
            {busy ? "Searching…" : `${hits.length} hit${hits.length === 1 ? "" : "s"}`}
          </p>
        ) : null}
      </div>
      {q.trim() ? null : (
        <div className="flex border-b border-border">
          {(["saved", "hot", "gainers", "losers", "chains"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-11 flex-1 text-[11px] uppercase tracking-wider",
                tab === t ? "border-b border-accent text-fg" : "text-muted",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {tab === "chains" && !q.trim() ? (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChainId(c.id)}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3 text-[11px]",
                chainId === c.id ? "border-brass bg-elevated text-fg" : "border-border text-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {chainBusy && tab === "chains" && !q.trim() ? <p className="p-3 text-xs text-muted">Loading {chainId}…</p> : null}
        {!busy && rows.length === 0 ? <p className="p-3 text-xs text-muted">{q.trim() ? "No matches." : "No names on this tape."}</p> : null}
        {rows.map((r) => (
          <div
            key={`${r.network ?? ""}-${r.symbol}-${r.contract ?? r.poolAddress ?? r.geckoId ?? r.name}`}
            className={cn(
              "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center border-b border-border transition-colors duration-150 hover:bg-elevated",
              focus.symbol === r.symbol && "bg-elevated",
            )}
          >
            <button
              type="button"
              className={cn("grid h-12 place-items-center text-[14px]", saved.includes(r.symbol.toUpperCase()) ? "text-brass" : "text-subtle")}
              onClick={() => toggleSave(r.symbol, r)}
              aria-label="Save"
            >
              {saved.includes(r.symbol.toUpperCase()) ? "★" : "☆"}
            </button>
            <button type="button" onClick={() => pick(r)} className="min-w-0 py-2.5 text-left">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{r.symbol}</span>
                <span className="truncate text-[10px] text-subtle">{r.chain}</span>
              </div>
              <div className="truncate text-[11px] text-muted">{r.name}</div>
            </button>
            <button type="button" onClick={() => pick(r)} className="shrink-0 px-3 py-2.5 text-right">
              <div className="font-mono text-xs tabular-nums">{r.price ? fmtPx(r.price) : "—"}</div>
              <div className={`font-mono text-[10px] tabular-nums ${r.change24 >= 0 ? "text-up" : "text-down"}`}>
                {fmtPct(r.change24)}
              </div>
              <div className="font-mono text-[10px] text-subtle">{fmtUsd(r.volume24)}</div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
