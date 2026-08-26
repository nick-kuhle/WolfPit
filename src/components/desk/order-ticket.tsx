import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { expiries, maxNetLongEth, maxNetShortEth, optionQuote, quoteInForBaseOut, reservationPx, spreadBps } from "@/lib/wolfpit/engine";
import { rejectFuture } from "@/lib/wolfpit/risk";
import { useWolf } from "@/lib/wolfpit/store";
import type { DeskSide, OrderKind, OptType, PoolId, Product, Tif } from "@/lib/wolfpit/types";
import { FUT_IM, MINI_ETH } from "@/lib/wolfpit/types";
import { useAdmin } from "@/lib/admin/config";
import { useDesk } from "@/lib/wolfpit/desk";
import { cn, fmtPx, fmtUsd } from "@/lib/utils";

const KINDS: { id: OrderKind; label: string }[] = [
  { id: "mkt", label: "MKT" },
  { id: "lmt", label: "LMT" },
  { id: "stp", label: "STP" },
  { id: "stl", label: "STL" },
];
const TIFS: { id: Tif; label: string }[] = [
  { id: "day", label: "DAY" },
  { id: "gtc", label: "GTC" },
  { id: "ioc", label: "IOC" },
];

export function OrderTicket({ prefer }: { prefer?: "buy" | "sell" | null }) {
  const clear = useWolf((s) => s.clearError);
  const err = useWolf((s) => s.lastError);
  const geo = useAdmin((s) => s.geoFenceUs);
  const paused = useAdmin((s) => s.listingsPaused);
  const [product, setProduct] = useState<Product>("spot");
  const [side, setSide] = useState<DeskSide>(prefer ?? "buy");
  const [kind, setKind] = useState<OrderKind>("mkt");
  const [tif, setTif] = useState<Tif>("day");
  const [qty, setQty] = useState("1");
  const [limit, setLimit] = useState("");
  const [stop, setStop] = useState("");
  const [poolId, setPoolId] = useState<PoolId>("ETH-USDC");
  const [exi, setExi] = useState(0);
  const [optType, setOptType] = useState<OptType>("call");
  const [kIdx, setKIdx] = useState(2);
  const [confirm, setConfirm] = useState(false);

  const s = useWolf();
  const send = useWolf((st) => st.sendOrder);
  const cancel = useWolf((st) => st.cancelOrder);
  const listToken = useWolf((st) => st.listToken);
  const focus = useDesk((d) => d.focus);

  useEffect(() => {
    if (prefer) setSide(prefer);
  }, [prefer]);

  useEffect(() => {
    const id =
      focus.symbol === "ETH" ? "ETH-USDC" : focus.symbol === "WPIT" ? "WPIT-USDC-TEST" : `${focus.symbol}-USDC`;
    setPoolId(id);
    listToken(focus.symbol, focus.price || s.eth);
  }, [focus.symbol, focus.price, listToken, s.eth]);

  useEffect(() => {
    if (!limit && s.ethAsk) setLimit(s.ethAsk.toFixed(2));
  }, [s.ethAsk, limit]);

  const bid = s.ethBid || s.eth;
  const ask = s.ethAsk || s.eth;
  const spr = ask - bid;
  const clock = s.clock;
  const exps = useMemo(() => expiries(clock), [clock]);
  const strikes = useMemo(() => {
    const atm = Math.round(s.eth / 100) * 100;
    return [atm - 200, atm - 100, atm, atm + 100, atm + 200];
  }, [s.eth]);
  const strike = strikes[kIdx] ?? strikes[2]!;
  const n = Number(qty) || 0;
  const products: Product[] = geo ? ["spot"] : ["spot", "future", "option"];

  const q = product === "option" ? optionQuote(s, optType, strike, exps[exi]!.at) : null;
  const futWhy =
    product === "future" ? rejectFuture(s, side === "buy" ? "long" : "short", n * MINI_ETH, exps[exi]!.at) : null;

  const est = (() => {
    if (product === "spot") {
      const pool = s.pools[poolId];
      if (!pool) return { label: "—", usd: 0 };
      if (side === "buy") {
        const quote = quoteInForBaseOut(pool, n);
        return { label: `Debit ${fmtUsd(quote)}`, usd: quote };
      }
      const out = n * (pool.quoteReserve / pool.baseReserve) * (1 - pool.feeBps / 10_000);
      return { label: `Credit ${fmtUsd(out)}`, usd: -out };
    }
    if (product === "future") {
      const im = n * MINI_ETH * s.eth * FUT_IM;
      return { label: `IM ${fmtUsd(im)} · 4×`, usd: im };
    }
    const debit = (q?.ask ?? 0) * n * MINI_ETH;
    return { label: `Debit ${fmtUsd(debit)}`, usd: debit };
  })();

  const blocked =
    paused ||
    n <= 0 ||
    (product === "future" && !!futWhy) ||
    (product === "option" && (!!q?.blank || side === "sell"));

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <QuoteBoard bid={bid} ask={ask} spr={spr} mid={s.eth} live={s.liveSource} />

      <div className="flex border-b border-border">
        {products.map((p) => (
          <button
            key={p}
            onClick={() => {
              setProduct(p);
              clear();
            }}
            className={cn(
              "h-11 flex-1 text-[11px] uppercase tracking-wider",
              product === p ? "border-b border-accent text-fg" : "text-muted",
            )}
          >
            {p === "spot" ? "Spot" : p === "future" ? "Mini" : "Option"}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant={side === "buy" ? "up" : "outline"} onClick={() => setSide("buy")}>
            Buy
          </Button>
          <Button variant={side === "sell" ? "down" : "outline"} onClick={() => setSide("sell")}>
            Sell
          </Button>
        </div>

        {product === "spot" && (
          <Field label="Pool">
            <select
              className={inp}
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
            >
              {Object.keys(s.pools).map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </Field>
        )}

        {product === "future" && (
          <Field label="Expiry">
            <div className="grid grid-cols-3 gap-1">
              {exps.map((e, i) => (
                <button
                  key={e.at}
                  onClick={() => setExi(i)}
                  className={cn("h-11 rounded-[var(--radius-sm)] border text-xs", i === exi ? "border-accent text-fg" : "border-border text-muted")}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        {product === "option" && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant={optType === "call" ? "up" : "outline"} onClick={() => setOptType("call")}>
                Call
              </Button>
              <Button variant={optType === "put" ? "down" : "outline"} onClick={() => setOptType("put")}>
                Put
              </Button>
            </div>
            <Field label="Strike">
              <div className="grid grid-cols-5 gap-1">
                {strikes.map((k, i) => (
                  <button
                    key={k}
                    onClick={() => setKIdx(i)}
                    className={cn("h-11 rounded-[var(--radius-sm)] border font-mono text-[11px]", i === kIdx ? "border-accent text-fg" : "border-border text-muted")}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Expiry">
              <select className={inp} value={exi} onChange={(e) => setExi(Number(e.target.value))}>
                {exps.map((e, i) => (
                  <option key={e.at} value={i}>
                    {e.label} {new Date(e.at).toISOString().slice(0, 10)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <Field label={product === "spot" ? "Quantity (base)" : "Contracts"}>
          <Stepper value={qty} onChange={setQty} step={product === "spot" ? 0.1 : 1} presets={product === "spot" ? [0.1, 0.5, 1, 5] : [1, 2, 5, 10]} />
        </Field>

        <Field label="Order type">
          <div className="grid grid-cols-4 gap-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={cn("h-11 rounded-[var(--radius-sm)] border text-[11px] tracking-wider", kind === k.id ? "border-accent text-fg" : "border-border text-muted")}
              >
                {k.label}
              </button>
            ))}
          </div>
        </Field>

        {(kind === "lmt" || kind === "stl") && (
          <Field label="Limit">
            <Stepper value={limit} onChange={setLimit} step={0.5} dp={2} />
          </Field>
        )}
        {(kind === "stp" || kind === "stl") && (
          <Field label="Stop">
            <Stepper value={stop} onChange={setStop} step={0.5} dp={2} />
          </Field>
        )}

        <Field label="Time in force">
          <div className="grid grid-cols-3 gap-1">
            {TIFS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTif(t.id)}
                className={cn("h-11 rounded-[var(--radius-sm)] border text-[11px] tracking-wider", tif === t.id ? "border-accent text-fg" : "border-border text-muted")}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        <dl className="mt-3 space-y-1 border-t border-border pt-3 font-mono text-[11px]">
          <Row k="Bid / Ask" v={`${fmtPx(bid)} / ${fmtPx(ask)}`} />
          <Row k="Spread" v={`${spr.toFixed(2)} (${((spr / s.eth) * 10_000).toFixed(1)} bps)`} />
          <Row k="Reservation" v={fmtPx(reservationPx(s))} />
          <Row k="House spread" v={`${spreadBps(s).toFixed(0)} bps`} />
          {product === "future" && (
            <>
              <Row k="Size" v={`${(n * MINI_ETH).toFixed(2)} ETH`} />
              <Row k="Max net" v={`${(side === "buy" ? maxNetLongEth(s) : maxNetShortEth(s)).toFixed(2)} ETH`} />
            </>
          )}
          {product === "option" && q && (
            <>
              <Row k="Ask / Δ" v={`${fmtPx(q.ask)} / ${q.delta.toFixed(2)}`} />
              <Row k="IV" v={`${(s.iv * 100).toFixed(1)}`} />
            </>
          )}
          <Row k="Buying power" v={fmtUsd(s.account.usdc)} />
          <Row k="Est." v={est.label} />
        </dl>

        {product === "option" && side === "sell" ? (
          <p className="mt-2 text-xs text-muted">Vault does not buy. Close longs from Positions.</p>
        ) : null}
        {q?.blank ? <p className="mt-2 text-xs text-down">{q.blank}</p> : null}
        {paused ? <p className="mt-2 text-xs text-brass">Listings paused.</p> : null}
        {err ? <p className="mt-2 text-xs text-down">{err}</p> : null}

        <Button
          className="mt-4 w-full"
          variant={side === "buy" ? "up" : "down"}
          disabled={blocked}
          onClick={() => setConfirm(true)}
        >
          Review {side.toUpperCase()} {product}
        </Button>

        {confirm ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
            <div className="sheet-in w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-panel p-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-brass">Confirm ticket</p>
              <h3 className="mt-2 font-display text-2xl font-medium">
                {side.toUpperCase()} {n} {product === "spot" ? poolId : product}
              </h3>
              <p className="mt-2 text-sm text-muted">{est.label} · {kind.toUpperCase()} · {tif.toUpperCase()}</p>
              <p className="mt-1 text-xs text-subtle">Paper funds. You must confirm before the order is sent.</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant={side === "buy" ? "up" : "down"}
                  onClick={() => {
                    send({
                      product,
                      side,
                      kind,
                      tif,
                      qty: n,
                      limit: limit ? Number(limit) : undefined,
                      stop: stop ? Number(stop) : undefined,
                      poolId,
                      expiry: exps[exi]?.at,
                      strike,
                      optType,
                    });
                    setConfirm(false);
                  }}
                >
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {(s.working ?? []).length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Working</h3>
            {s.working.map((w) => (
              <div key={w.id} className="mb-2 flex items-center justify-between border-b border-border pb-2 text-xs">
                <div>
                  <div className="font-medium">
                    {w.side.toUpperCase()} {w.qty} {w.product} {w.kind.toUpperCase()}
                  </div>
                  <div className="font-mono text-muted">
                    {w.limit ? `L ${fmtPx(w.limit)}` : ""} {w.stop ? `S ${fmtPx(w.stop)}` : ""} {w.tif.toUpperCase()}
                  </div>
                </div>
                <button className="h-11 px-3 text-muted hover:text-fg" onClick={() => cancel(w.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function QuoteBoard({ bid, ask, spr, mid, live }: { bid: number; ask: number; spr: number; mid: number; live: string }) {
  return (
    <div className="grid grid-cols-3 border-b border-border bg-elevated px-3 py-2">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">Bid</div>
        <div className="font-mono text-lg tabular-nums text-up">{fmtPx(bid)}</div>
      </div>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-subtle">Last · {live || "feed"}</div>
        <div className="font-mono text-lg tabular-nums">{fmtPx(mid)}</div>
        <div className="font-mono text-[10px] text-muted">{spr.toFixed(2)} wide</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-subtle">Ask</div>
        <div className="font-mono text-lg tabular-nums text-down">{fmtPx(ask)}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      {children}
    </div>
  );
}

const inp =
  "h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-sm text-fg outline-none focus:ring-2 focus:ring-ring";

function Stepper({
  value,
  onChange,
  step,
  dp = 4,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  dp?: number;
  presets?: number[];
}) {
  return (
    <div>
      <div className="flex gap-1">
        <button
          className="size-11 shrink-0 rounded-[var(--radius-sm)] border border-border text-lg text-muted"
          onClick={() => onChange(((Number(value) || 0) - step).toFixed(dp))}
        >
          −
        </button>
        <input className={inp} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
        <button
          className="size-11 shrink-0 rounded-[var(--radius-sm)] border border-border text-lg text-muted"
          onClick={() => onChange(((Number(value) || 0) + step).toFixed(dp))}
        >
          +
        </button>
      </div>
      {presets ? (
        <div className="mt-1 flex gap-1">
          {presets.map((p) => (
            <button
              key={p}
              className="h-9 flex-1 rounded-[var(--radius-sm)] border border-border font-mono text-[11px] text-muted"
              onClick={() => onChange(String(p))}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular-nums text-fg">{v}</dd>
    </div>
  );
}
