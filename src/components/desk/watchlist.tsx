import { useEffect, useMemo, useState } from "react";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { CHAINS, getChainTape, lookupToken } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Tab = "hot" | "gainers" | "losers" | "chains";

export function Watchlist({ onPick }: { onPick?: (l: Listing) => void }) {
  const universe = useDesk((s) => s.universe);
  const chainTape = useDesk((s) => s.chainTape);
  const chainId = useDesk((s) => s.chainId);
  const setChainId = useDesk((s) => s.setChainId);
  const setChainTape = useDesk((s) => s.setChainTape);
  const focus = useDesk((s) => s.focus);
  const openCard = useDesk((s) => s.openCard);
  const cardOpen = useDesk((s) => s.cardOpen);
  const [tab, setTab] = useState<Tab>("hot");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [chainBusy, setChainBusy] = useState(false);
  const listToken = useWolf((s) => s.listToken);

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

  const rows = useMemo(() => {
    if (tab === "chains") return chainTape;
    const u = universe.slice();
    if (tab === "gainers") return u.sort((a, b) => b.change24 - a.change24);
    if (tab === "losers") return u.sort((a, b) => a.change24 - b.change24);
    return u.sort((a, b) => b.volume24 - a.volume24);
  }, [universe, chainTape, tab]);

  function pick(l: Listing) {
    openCard(l);
    listToken(l.symbol, l.price || 1);
    onPick?.(l);
  }

  async function lookup() {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
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
      <form
        className="flex gap-1 border-b border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <input
          className="h-11 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-xs"
          placeholder="Ticker or 0x"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" disabled={busy} className="h-11 px-3 text-xs uppercase tracking-wider text-brass">
          Go
        </button>
      </form>
      <div className="flex border-b border-border">
        {(["hot", "gainers", "losers", "chains"] as const).map((t) => (
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
      {tab === "chains" ? (
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
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          cardOpen && "max-lg:pb-[min(72dvh,28rem)] landscape:max-lg:pb-0 landscape:max-lg:pr-[min(28rem,50vw)] lg:pr-[min(440px,42vw)]",
        )}
      >
        {chainBusy && tab === "chains" ? <p className="p-3 text-xs text-muted">Loading {chainId}…</p> : null}
        {!chainBusy && rows.length === 0 ? <p className="p-3 text-xs text-muted">No names on this tape.</p> : null}
        {rows.map((r) => (
          <button
            key={`${r.network ?? ""}-${r.symbol}-${r.contract ?? r.poolAddress ?? r.geckoId ?? ""}`}
            onClick={() => pick(r)}
            className={cn(
              "flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left",
              focus.symbol === r.symbol && cardOpen && "bg-elevated",
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
