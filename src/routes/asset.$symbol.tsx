import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChartPane } from "@/components/desk/chart";
import { OrderTicket } from "@/components/desk/order-ticket";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useDesk, wpitListing, type Listing } from "@/lib/wolfpit/desk";
import { resampleCandles } from "@/lib/wolfpit/engine";
import { getSymbolCandles, lookupToken, type ChartInterval } from "@/lib/wolfpit/market";
import { shareAsset } from "@/lib/wolfpit/share";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/asset/$symbol")({
  component: AssetPage,
});

function AssetPage() {
  const { symbol } = Route.useParams();
  const wpitPx = useWolf((s) => s.wpit);
  const [listing, setListing] = useState<Listing>(() =>
    seed(symbol, useDesk.getState().universe, wpitPx),
  );
  const [interval, setIv] = useState<ChartInterval>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const local = seed(symbol, useDesk.getState().universe, useWolf.getState().wpit);
    setListing(local);
    useWolf.getState().listToken(local.symbol, local.price || 1);
    useDesk.getState().setFocus(local);
    if (local.symbol === "WPIT" || local.price) return;
    let dead = false;
    void lookupToken({ data: { q: symbol } })
      .then((hit) => {
        if (dead) return;
        const next = { ...local, ...hit, symbol: hit.symbol || local.symbol };
        setListing(next);
        useDesk.getState().setFocus(next);
        useWolf.getState().listToken(next.symbol, next.price || 1);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (listing.symbol === "WPIT") {
      const rows = resampleCandles(useWolf.getState().wpitCandles, 3_600_000);
      setBars(rows);
      setStatus(rows.length >= 2 ? "ok" : "empty");
      return;
    }
    let dead = false;
    setStatus("load");
    void getSymbolCandles({
      data: {
        symbol: listing.symbol,
        interval,
        binance: listing.binance,
        geckoId: listing.geckoId,
        network: listing.network,
        poolAddress: listing.poolAddress,
      },
    })
      .then((rows) => {
        if (dead) return;
        setBars(rows);
        setStatus(rows.length >= 2 ? "ok" : "empty");
      })
      .catch(() => {
        if (!dead) setStatus("empty");
      });
    return () => {
      dead = true;
    };
  }, [listing.symbol, listing.binance, listing.geckoId, listing.network, listing.poolAddress, interval]);

  const px = listing.symbol === "WPIT" ? wpitPx : listing.price;

  return (
    <Shell desk>
      <ProductGate product="desk">
        <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="min-h-0 overflow-auto px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">
                  Pit ticket · {listing.chain || "live"}
                </p>
                <h1 className="font-display text-3xl font-medium tracking-tight">{listing.symbol}</h1>
                <p className="text-sm text-muted">{listing.name}</p>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl tabular-nums">{px ? fmtPx(px) : "—"}</div>
                <div className={listing.change24 >= 0 ? "text-up" : "text-down"}>{fmtPct(listing.change24)}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to="/trade">
                <Button size="sm" variant="outline">
                  Floor
                </Button>
              </Link>
              <Link to="/orders">
                <Button size="sm" variant="outline">
                  Fills
                </Button>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => void shareAsset(listing)}>
                Share
              </Button>
            </div>

            <div className="mt-3">
              <ChartPane
                candles={bars}
                interval={interval}
                status={status}
                onInterval={setIv}
                expanded={wide}
                onToggle={() => setWide((v) => !v)}
                compact={140}
              />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat k="Volume 24h" v={fmtUsd(listing.volume24)} />
              <Stat k="Chain" v={listing.chain || "—"} />
              <Stat k="Contract" v={listing.contract ? `${listing.contract.slice(0, 6)}…` : "—"} />
              <Stat k="Venue" v="Paper pit" />
            </dl>

            <RecentFills symbol={listing.symbol} />
          </main>
          <aside className="min-h-[22rem] border-t border-border lg:h-[calc(100dvh-3rem)] lg:border-l lg:border-t-0">
            <OrderTicket under={listing.symbol} />
          </aside>
        </div>
      </ProductGate>
    </Shell>
  );
}

function seed(symbol: string, universe: Listing[], wpitPx: number): Listing {
  const sym = symbol.toUpperCase();
  if (sym === "WPIT") return wpitListing(wpitPx, 0.12);
  const hit = universe.find((u) => u.symbol === sym);
  if (hit) return hit;
  const focus = useDesk.getState().focus;
  if (focus.symbol === sym) return focus;
  return {
    symbol: sym,
    name: sym,
    price: 0,
    change24: 0,
    volume24: 0,
  };
}

function RecentFills({ symbol }: { symbol: string }) {
  const fills = useWolf((s) => s.fills.filter((f) => f.symbol.toUpperCase().includes(symbol.toUpperCase())).slice(0, 8));
  const working = useWolf((s) => (s.working ?? []).slice(0, 6));
  const cancel = useWolf((s) => s.cancelOrder);
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-xl">Tickets</h2>
        <Link to="/orders" className="text-xs text-brass">
          All fills →
        </Link>
      </div>
      {working.length === 0 && fills.length === 0 ? <p className="text-sm text-muted">No tickets yet. Shout one.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {working.map((w) => (
          <div key={w.id} className="ticket-card flex items-center justify-between rounded-[var(--radius-md)] border border-warn/40 bg-warn/10 px-3 py-2">
            <span className="font-mono text-xs">
              {w.side} {w.qty} {w.product}
            </span>
            <button className="pressable text-xs text-muted" onClick={() => cancel(w.id)}>
              Cancel
            </button>
          </div>
        ))}
        {fills.map((f) => (
          <div key={f.id} className="ticket-card rounded-[var(--radius-md)] border border-border bg-elevated px-3 py-2 font-mono text-xs">
            {f.side} {f.size.toPrecision(4)} @ {fmtPx(f.price)}
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="ticket-card rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-1 truncate font-mono text-sm">{v}</dd>
    </div>
  );
}
