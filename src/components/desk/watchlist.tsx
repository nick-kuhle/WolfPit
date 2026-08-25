import { useMemo, useState } from "react";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { lookupToken } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Tab = "hot" | "gainers" | "losers" | "chains";

export function Watchlist({ onPick }: { onPick?: (l: Listing) => void }) {
  const universe = useDesk((s) => s.universe);
  const focus = useDesk((s) => s.focus);
  const setFocus = useDesk((s) => s.setFocus);
  const [tab, setTab] = useState<Tab>("hot");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const listToken = useWolf((s) => s.listToken);

  const rows = useMemo(() => {
    const u = universe.slice();
    if (tab === "gainers") return u.sort((a, b) => b.change24 - a.change24);
    if (tab === "losers") return u.sort((a, b) => a.change24 - b.change24);
    if (tab === "chains") {
      const seen = new Set<string>();
      return u.filter((r) => {
        const c = r.chain ?? r.symbol;
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      });
    }
    return u.sort((a, b) => b.volume24 - a.volume24);
  }, [universe, tab]);

  function pick(l: Listing) {
    setFocus(l);
    listToken(l.symbol, l.price || 1);
    ping(`${l.symbol} on the board`, "brass");
    onPick?.(l);
  }

  async function lookup() {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    ping(`Looking up ${query}`, "brass");
    try {
      const l = await lookupToken({ data: { q: query } });
      pick(l);
      setQ("");
    } catch {
      ping("Token not found", "down");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-subtle">The board · live</div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <input
            className="h-11 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-xs"
            placeholder="Ticker or 0x contract"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="h-11 px-3 text-xs uppercase tracking-wider text-brass"
          >
            Go
          </button>
        </form>
      </div>
      <div className="flex border-b border-border">
        {(["hot", "gainers", "losers", "chains"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              ping(`${t} tape`, "brass");
            }}
            className={cn(
              "h-11 flex-1 text-[10px] uppercase tracking-wider",
              tab === t ? "border-b border-accent text-fg" : "text-muted",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-muted">Loading the tape…</p>
        ) : null}
        {rows.map((r) => (
          <button
            key={`${r.symbol}-${r.contract ?? r.geckoId ?? ""}`}
            onClick={() => pick(r)}
            className={cn(
              "flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left",
              focus.symbol === r.symbol && "bg-elevated",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{r.symbol}</span>
                <span className="truncate text-[10px] text-subtle">{r.chain}</span>
              </div>
              <div className="truncate text-[11px] text-muted">{r.name}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-xs tabular-nums">{r.price ? fmtPx(r.price) : "—"}</div>
              <div className={`font-mono text-[10px] tabular-nums ${r.change24 >= 0 ? "text-up" : "text-down"}`}>
                {fmtPct(r.change24)}
              </div>
              <div className="font-mono text-[10px] text-subtle">{fmtUsd(r.volume24)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
