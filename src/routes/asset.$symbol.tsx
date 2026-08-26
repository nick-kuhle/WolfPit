import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PitChart } from "@/components/desk/chart";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { useDesk, wpitListing, type Listing } from "@/lib/wolfpit/desk";
import { resampleCandles } from "@/lib/wolfpit/engine";
import { getSymbolCandles, lookupToken, type ChartInterval } from "@/lib/wolfpit/market";
import { shareAsset } from "@/lib/wolfpit/share";
import { useWolf } from "@/lib/wolfpit/store";
import type { Candle } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/asset/$symbol")({
  validateSearch: (s: Record<string, unknown>) => ({
    name: typeof s.name === "string" ? s.name : "",
    chain: typeof s.chain === "string" ? s.chain : "",
    contract: typeof s.contract === "string" ? s.contract : "",
    network: typeof s.network === "string" ? s.network : "",
  }),
  component: AssetPage,
});

function AssetPage() {
  const { symbol } = Route.useParams();
  const q = Route.useSearch();
  const universe = useDesk((s) => s.universe);
  const openCard = useDesk((s) => s.openCard);
  const wpitPx = useWolf((s) => s.wpit);
  const wpitBars = useWolf((s) => s.wpitCandles);
  const listToken = useWolf((s) => s.listToken);
  const [listing, setListing] = useState<Listing>(() => seed(symbol, q, universe, wpitPx));
  const [interval, setIv] = useState<ChartInterval>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");

  useEffect(() => {
    const local = seed(symbol, q, universe, wpitPx);
    setListing(local);
    listToken(local.symbol, local.price || 1);
    if (local.symbol === "WPIT" || local.price) return;
    let dead = false;
    void lookupToken({ data: { q: q.contract || symbol } })
      .then((hit) => {
        if (!dead) setListing({ ...local, ...hit, symbol: hit.symbol || local.symbol });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [symbol, q.contract, q.chain, universe, wpitPx, listToken]);

  useEffect(() => {
    if (listing.symbol === "WPIT") {
      const rows = resampleCandles(wpitBars, 3_600_000);
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
        network: listing.network || q.network || undefined,
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
  }, [listing, interval, wpitBars, q.network]);

  const px = listing.symbol === "WPIT" ? wpitPx : listing.price;

  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">
          Pit ticket · {listing.chain || "live"}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl font-medium tracking-tight">{listing.symbol}</h1>
            <p className="text-muted">{listing.name || q.name}</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-3xl tabular-nums">{px ? fmtPx(px) : "—"}</div>
            <div className={listing.change24 >= 0 ? "text-up" : "text-down"}>{fmtPct(listing.change24)}</div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="Volume 24h" v={fmtUsd(listing.volume24)} />
          <Stat k="Chain" v={listing.chain || "—"} />
          <Stat k="Contract" v={listing.contract ? `${listing.contract.slice(0, 6)}…${listing.contract.slice(-4)}` : "—"} />
          <Stat k="Venue" v="WolfPit paper" />
        </dl>

        <div className="mt-6 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-chart">
          <div className="flex gap-1 border-b border-border px-2">
            {(["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setIv(k)}
                className={`h-10 px-2.5 font-mono text-xs ${interval === k ? "text-fg" : "text-muted"}`}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="h-64">
            {status === "ok" ? <PitChart candles={bars} height={256} interval={interval} /> : (
              <p className="p-4 text-sm text-muted">{status === "load" ? "Loading candles…" : "No candles for this timeframe."}</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            to="/trade"
            onClick={() => openCard(listing)}
            className="sm:flex-1"
          >
            <Button className="h-12 w-full">Trade {listing.symbol} on the desk</Button>
          </Link>
          <Button variant="outline" className="h-12 sm:w-40" onClick={() => void shareAsset(listing)}>
            Share
          </Button>
        </div>
        {listing.contract ? (
          <p className="mt-4 break-all font-mono text-[11px] text-subtle">{listing.contract}</p>
        ) : null}
      </main>
      <SiteFooter />
    </Shell>
  );
}

function seed(
  symbol: string,
  q: { name: string; chain: string; contract: string; network: string },
  universe: Listing[],
  wpitPx: number,
): Listing {
  const sym = symbol.toUpperCase();
  if (sym === "WPIT") return wpitListing(wpitPx, 0.12);
  const hit = universe.find((u) => u.symbol === sym);
  if (hit) return hit;
  return {
    symbol: sym,
    name: q.name || sym,
    price: 0,
    change24: 0,
    volume24: 0,
    chain: q.chain,
    contract: q.contract || undefined,
    network: q.network || undefined,
  };
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-1 truncate font-mono text-sm">{v}</dd>
    </div>
  );
}
