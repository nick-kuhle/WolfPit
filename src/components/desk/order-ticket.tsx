import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  buyingPower,
  equity,
  expiries,
  futLiqPrice,
  imRate,
  markOf,
  maxMiniContracts,
  maxSpotQty,
  miniQty,
  mmRate,
  optionQuote,
  quoteInForBaseOut,
  strikeGrid,
  usedMargin,
} from "@/lib/wolfpit/engine";
import { MAX_LOT } from "@/lib/wolfpit/limits";
import { MARKET_LAUNCH, marketOpen } from "@/lib/wolfpit/features";
import { useWolf } from "@/lib/wolfpit/store";
import type { DeskSide, OrderKind, OptType, PoolId, Product, Tif } from "@/lib/wolfpit/types";
import { useAdmin } from "@/lib/admin/config";
import { cn, fmtPx, fmtQty, fmtUsd } from "@/lib/utils";

const KINDS: OrderKind[] = ["mkt", "lmt", "stp"];
const TIFS: Tif[] = ["day", "gtc", "ioc"];

export function OrderTicket({
  prefer,
  under: underProp,
  want,
}: {
  prefer?: "buy" | "sell" | null;
  under?: string;
  want?: "spot" | "future" | "option" | null;
}) {
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
  const [strike, setStrike] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [review, setReview] = useState(false);

  const s = useWolf();
  const send = useWolf((st) => st.sendOrder);
  const cancel = useWolf((st) => st.cancelOrder);
  const raw = (underProp || "ETH").toUpperCase();
  const under = raw === "USDC" ? "ETH" : raw;
  const spot = markOf(s, under) || (under === "ETH" ? s.eth : 1);

  useEffect(() => {
    if (prefer) setSide(prefer);
  }, [prefer]);

  useEffect(() => {
    if (want) {
      setProduct(want);
      setSheet(want !== "option");
    }
  }, [want]);

  useEffect(() => {
    const id = under === "ETH" ? "ETH-USDC" : under === "WPIT" ? "WPIT-USDC-TEST" : `${under}-USDC`;
    setPoolId(id);
    setQty("1");
    setSheet(false);
    setReview(false);
  }, [under]);

  const clock = s.clock;
  const exps = useMemo(() => expiries(clock), [clock]);
  const exp = exps[exi]!;
  const grid = useMemo(() => strikeGrid(spot), [spot]);
  const k = strike || grid[Math.floor(grid.length / 2)] || spot;
  const rawN = Number(qty);
  const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 0;
  const products: Product[] = (geo ? (["spot"] as Product[]) : (["spot", "future", "option"] as Product[])).filter(
    (p) => marketOpen(p),
  );
  const futSide = side === "buy" ? "long" : "short";
  const size = n * miniQty(under);
  const rate = imRate(s, Math.max(size, miniQty(under)), under);
  const mmR = mmRate(s, Math.max(size, miniQty(under)), under);
  const im = size * spot * rate;
  const mm = size * spot * mmR;
  const liq = futLiqPrice({
    id: "",
    side: futSide,
    sizeEth: Math.max(size, miniQty(under)),
    entry: spot,
    expiry: exp.at,
    margin: Math.max(im, 1),
    openedAt: 0,
    under,
  });
  const bp = buyingPower(s);
  const maxSpot = maxSpotQty(s, poolId, side);
  const maxMini = maxMiniContracts(s, futSide, under);
  const optDebitEach = product === "option" ? (optionQuote(s, optType, k, exp.at, under).ask || 0) * miniQty(under) : 0;
  const maxOpt = optDebitEach > 0 ? Math.floor(bp / (optDebitEach * (1 + 0.0005))) : 0;
  const maxN =
    product === "spot" ? maxSpot : product === "future" ? maxMini : Math.max(0, Math.min(maxOpt, MAX_LOT));
  const q = product === "option" ? optionQuote(s, optType, k, exp.at, under) : null;
  const used = usedMargin(s);
  const navEq = equity(s);
  const fillPx =
    kind === "lmt" && Number(limit) > 0 ? Number(limit) : product === "option" ? (q?.ask ?? 0) : spot;

  const est = (() => {
    if (product === "spot") {
      const pool = s.pools[poolId];
      if (!pool) return { label: "—", usd: 0 };
      if (side === "buy") {
        const quote = quoteInForBaseOut(pool, n);
        if (!Number.isFinite(quote)) return { label: "Too large for the pool", usd: Number.POSITIVE_INFINITY };
        return { label: `Debit ${fmtUsd(quote)} ${pool.quote}`, usd: quote };
      }
      const out = n * (pool.quoteReserve / pool.baseReserve) * (1 - pool.feeBps / 10_000);
      return { label: `Credit ~${fmtUsd(out)} ${pool.quote}`, usd: 0 };
    }
    if (product === "future") {
      const lev = rate > 0 ? 1 / rate : 0;
      return {
        label: `IM ${fmtUsd(im)} · ${(lev).toFixed(1)}× · liq ${fmtPx(liq)}`,
        usd: im + size * spot * 0.0005,
      };
    }
    const debit = (q?.ask ?? 0) * n * miniQty(under);
    return { label: `Debit ${fmtUsd(debit)}`, usd: debit };
  })();
  const usedAfter = used + (product === "future" ? im : 0);
  const cashAfter = Math.max(
    0,
    bp - (est.usd > 0 && Number.isFinite(est.usd) ? est.usd : 0) + (side === "sell" && product === "spot" ? Math.abs(est.usd) : 0),
  );

  const overSize = n > 0 && n > maxN + 1e-12;
  const overCash = est.usd > 0 && Number.isFinite(est.usd) && est.usd > bp + 1e-6;
  const blocked =
    paused ||
    n <= 0 ||
    !Number.isFinite(n) ||
    overSize ||
    overCash ||
    (product === "option" && (!!q?.blank || side === "sell"));

  function fire() {
    if (blocked || !review) return;
    const qtySend = product === "spot" ? n : Math.min(n, maxN);
    send({
      product,
      side,
      kind,
      tif,
      qty: qtySend,
      limit: limit ? Number(limit) : undefined,
      stop: stop ? Number(stop) : undefined,
      poolId,
      expiry: exp.at,
      strike: k,
      optType,
      under,
    });
    setSheet(false);
    setReview(false);
  }

  function pickLadder(type: OptType, click: "bid" | "ask", ks: number) {
    setProduct("option");
    setOptType(type);
    setStrike(ks);
    setSide(click === "ask" ? "buy" : "sell");
    setSheet(true);
    setReview(false);
  }

  const editor = sheet || product !== "option";

  return (
    <div className="relative flex min-h-full flex-col bg-panel lg:h-full lg:min-h-0">
      <div className="flex border-b border-border">
        {products.map((p) => (
          <button
            key={p}
            onClick={() => {
              setProduct(p);
              setSheet(false);
              setReview(false);
              clear();
            }}
            className={cn(
              "pressable h-11 flex-1 text-[11px] uppercase tracking-wider",
              product === p ? "border-b border-brass text-brass" : "text-muted",
            )}
          >
            {p === "spot" ? "Spot" : p === "future" ? "Mini" : "Options"}
          </button>
        ))}
      </div>
      {!MARKET_LAUNCH.futuresOpen && !MARKET_LAUNCH.optionsOpen ? (
        <div className="border-b border-border bg-panel2 px-3 py-1.5 text-[10px] leading-snug text-subtle">
          Spot routes via the DEX aggregator. Perps &amp; options unlock when the WETH/USDC pit pool is seeded.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {product === "option" && !sheet ? (
          <>
            <div className="mt-2 flex gap-1 overflow-x-auto">
              {exps.map((e, i) => (
                <button
                  key={e.at}
                  onClick={() => setExi(i)}
                  className={cn(
                    "pressable h-9 shrink-0 rounded-full border px-3 font-mono text-[11px]",
                    i === exi ? "border-brass bg-brass text-bg" : "border-border text-muted",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="mt-1 font-mono text-[10px] text-subtle">{exp.when} · tap ask to buy · tap bid to sell</p>
            <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-border">
              <div className="grid grid-cols-[1fr_1fr_auto_1fr_1fr] bg-elevated px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-subtle">
                <span>Call bid</span>
                <span>Call ask</span>
                <span className="text-center">Strike</span>
                <span className="text-right">Put bid</span>
                <span className="text-right">Put ask</span>
              </div>
              {grid.map((ks) => {
                const c = optionQuote(s, "call", ks, exp.at, under);
                const p = optionQuote(s, "put", ks, exp.at, under);
                const atm = Math.abs(ks - spot) <= (grid[1]! - grid[0]!) / 2;
                return (
                  <div
                    key={ks}
                    className={cn("grid grid-cols-[1fr_1fr_auto_1fr_1fr] items-center border-t border-border px-1 py-0.5", atm && "bg-brass/10")}
                  >
                    <LadderCell value={c.bid} tone="down" disabled={!c.bid} onClick={() => pickLadder("call", "bid", ks)} />
                    <LadderCell value={c.ask} tone="up" disabled={!c.ask} onClick={() => pickLadder("call", "ask", ks)} />
                    <div className="min-w-[4.2rem] text-center font-mono text-xs text-fg">{fmtPx(ks)}</div>
                    <LadderCell value={p.bid} tone="down" disabled={!p.bid} onClick={() => pickLadder("put", "bid", ks)} align="right" />
                    <LadderCell value={p.ask} tone="up" disabled={!p.ask} onClick={() => pickLadder("put", "ask", ks)} align="right" />
                  </div>
                );
              })}
            </div>
          </>
        ) : product === "future" ? (
          <div className="mt-2 flex gap-1 overflow-x-auto">
            {exps.map((e, i) => (
              <button
                key={e.at}
                onClick={() => setExi(i)}
                className={cn(
                  "pressable h-9 shrink-0 rounded-full border px-3 font-mono text-[11px]",
                  i === exi ? "border-brass bg-brass text-bg" : "border-border text-muted",
                )}
              >
                {e.label} · {e.when.replace(" UTC", "")}
              </button>
            ))}
          </div>
        ) : product === "spot" ? (
          <Field label="Pool">
            <select className={inp} value={poolId} onChange={(e) => setPoolId(e.target.value as PoolId)}>
              {Object.keys(s.pools).map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="mt-2 font-mono text-[11px] text-brass">
            {side.toUpperCase()} {optType.toUpperCase()} {under} {fmtPx(k)} · {exp.when}
          </p>
        )}

      {editor ? (
        <div className="mt-2 rounded-md border border-brass/35 bg-[color-mix(in_oklab,var(--color-brass)_14%,#12100a)]">
          <div className="flex items-center gap-1 px-3 py-2">
            <div className="grid h-9 w-28 grid-cols-2 overflow-hidden rounded-full border border-brass/50">
              <button
                type="button"
                className={cn("text-[11px] font-medium", side === "sell" ? "bg-down text-fg" : "text-muted")}
                onClick={() => setSide("sell")}
              >
                Sell
              </button>
              <button
                type="button"
                className={cn("text-[11px] font-medium", side === "buy" ? "bg-up text-bg" : "text-muted")}
                onClick={() => setSide("buy")}
              >
                Buy
              </button>
            </div>
            <Carousel
              value={kind}
              items={KINDS}
              label={(knd) => (knd === "mkt" ? "MARKET" : knd === "lmt" ? "LIMIT" : "STOP")}
              onChange={setKind}
            />
          </div>

          <Line label="Quantity">
            <Stepper value={qty} onChange={setQty} step={product === "spot" ? 0.1 : 1} dp={product === "spot" ? 4 : 0} />
          </Line>
          {kind === "lmt" || kind === "stp" ? (
            <Line label={kind === "lmt" ? "Limit" : "Stop"}>
              <Stepper
                value={kind === "lmt" ? limit : stop}
                onChange={kind === "lmt" ? setLimit : setStop}
                step={spot > 100 ? 0.5 : 0.01}
                dp={spot > 100 ? 2 : 4}
              />
            </Line>
          ) : null}

          <Line label="TIF">
            <Carousel value={tif} items={TIFS} label={(x) => x.toUpperCase()} onChange={setTif} />
          </Line>

          {overSize ? (
            <p className="px-3 pb-2 text-[10px] text-down">
              Size exceeds max {product === "spot" ? maxN.toPrecision(4) : Math.floor(maxN)} given cash, inventory, and pool depth.
            </p>
          ) : null}
          {overCash ? (
            <p className="px-3 pb-2 text-[10px] text-down">
              Not enough cash. Debit {fmtUsd(est.usd)} vs {fmtUsd(bp)} free.
            </p>
          ) : null}
          {product === "option" && side === "sell" ? (
            <p className="px-3 pb-2 text-[10px] text-muted">Vault does not buy. Close longs from Positions.</p>
          ) : null}
          {q?.blank ? <p className="px-3 pb-2 text-[10px] text-down">{q.blank}</p> : null}
          {err ? <p className="px-3 pb-2 text-[10px] text-down">{err}</p> : null}
        </div>
      ) : null}
      </div>

      {editor ? (
        <div className="sticky bottom-0 z-20 shrink-0 border-t border-brass/35 bg-[color-mix(in_oklab,var(--color-brass)_18%,#12100a)]">
          <div className="flex items-center justify-between px-3 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-subtle">Cost of Trade</div>
              <div className="font-display text-xl tabular-nums">{Number.isFinite(est.usd) ? fmtUsd(side === "sell" && product === "spot" ? -est.usd : est.usd) : "—"}</div>
            </div>
            <div className="text-right font-mono text-[10px] text-muted">
              {product === "future" ? (
                <>
                  IM {fmtUsd(im)} · liq {fmtPx(liq)}
                </>
              ) : (
                est.label
              )}
            </div>
          </div>
          <div className="flex gap-2 px-3 pb-2">
            {product === "option" ? (
              <Button variant="ghost" className="h-11 flex-1" onClick={() => { setSheet(false); setReview(false); }}>
                Edit
              </Button>
            ) : null}
            <Button className="h-11 flex-1 bg-brass text-bg hover:brightness-110" disabled={blocked} onClick={() => setReview(true)}>
              Review
            </Button>
          </div>
        </div>
      ) : null}

      {(s.working ?? []).length > 0 ? (
        <div className="shrink-0 border-t border-border px-3 py-1">
          {s.working.slice(0, 2).map((w) => (
            <div key={w.id} className="flex items-center justify-between py-1 text-[11px]">
              <span className="font-mono">
                {w.side} {w.qty} {w.under ?? w.product}
              </span>
              <button type="button" className="text-muted" onClick={() => cancel(w.id)}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {review && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 p-3 pb-[calc(3.6rem+env(safe-area-inset-bottom))] sm:items-center">
              <div className="sheet-in flex max-h-[min(88dvh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-[1.1rem] border border-brass/40 bg-panel shadow-2xl">
                <div className="shrink-0 border-b border-border px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">Confirm simulated trade</p>
                  <h3 className="mt-1 font-display text-2xl leading-tight">
                    {side.toUpperCase()} {fmtQty(n)}{" "}
                    {product === "option"
                      ? `${optType.toUpperCase()} ${under} ${fmtPx(k)}`
                      : product === "future"
                        ? `${under} mini`
                        : under}
                  </h3>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    {kind.toUpperCase()}
                    {kind !== "mkt" ? ` ${fmtPx(fillPx)}` : ` · mark ${fmtPx(spot)}`} · {tif.toUpperCase()}
                    {product !== "spot" ? ` · ${exp.when}` : ` · ${poolId}`}
                  </p>
                </div>
                <dl className="min-h-0 flex-1 space-y-0 overflow-auto px-4 py-2 font-mono text-[12px]">
                  <Row k="Price" v={kind === "mkt" ? `${fmtPx(spot)} mark` : fmtPx(fillPx)} />
                  <Row k="Quantity" v={product === "spot" ? `${fmtQty(n)} ${under}` : `${fmtQty(n)} contract${n === 1 ? "" : "s"}`} />
                  {product === "future" ? <Row k="Underlying" v={`${fmtQty(size)} ${under}`} /> : null}
                  <Row k={side === "sell" && product === "spot" ? "Credit" : "Debit / cost"} v={Number.isFinite(est.usd) ? fmtUsd(est.usd) : "—"} />
                  {product === "future" ? (
                    <>
                      <Row k="Initial margin" v={`${fmtUsd(im)}  (${(rate * 100).toFixed(0)}%)`} />
                      <Row k="Maint. margin" v={fmtUsd(mm)} />
                      <Row k="Liquidation" v={fmtPx(liq)} />
                      <Row k="Margin now" v={fmtUsd(used)} />
                      <Row k="Margin after" v={fmtUsd(usedAfter)} />
                      <Row k="Margin impact" v={`+${fmtUsd(im)}`} />
                    </>
                  ) : null}
                  {product === "option" ? (
                    <>
                      <Row k="Premium each" v={fmtPx(q?.ask ?? 0)} />
                      <Row k="Strike / type" v={`${fmtPx(k)} ${optType}`} />
                      <Row k="Expiry" v={exp.when} />
                    </>
                  ) : null}
                  <Row k="Cash / available now" v={fmtUsd(bp)} />
                  <Row k="Available after" v={fmtUsd(cashAfter)} />
                  <Row k="Net liq now" v={fmtUsd(navEq)} />
                  {product === "future" ? <Row k="Cover" v="Vault inventory + pool depth" /> : null}
                </dl>
                <p className="px-4 pb-2 text-[11px] text-muted">Paper funds. Nothing leaves the sim until you confirm.</p>
                <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border p-3">
                  <Button variant="outline" className="h-12" onClick={() => setReview(false)}>
                    Edit
                  </Button>
                  <Button className="h-12" variant={side === "buy" ? "up" : "down"} onClick={fire}>
                    Confirm {side}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Carousel<T extends string>({
  value,
  items,
  label,
  onChange,
}: {
  value: T;
  items: T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const i = Math.max(0, items.indexOf(value));
  return (
    <div className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full border border-brass/45 px-2">
      <button type="button" className="pressable px-1 text-brass" onClick={() => onChange(items[(i - 1 + items.length) % items.length]!)}>
        ‹
      </button>
      <span className="min-w-[4.5rem] text-center font-mono text-[11px] uppercase tracking-wider">{label(value)}</span>
      <button type="button" className="pressable px-1 text-brass" onClick={() => onChange(items[(i + 1) % items.length]!)}>
        ›
      </button>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-brass/15 px-3 py-1.5">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  );
}

function LadderCell({
  value,
  tone,
  disabled,
  onClick,
  align,
}: {
  value: number;
  tone: "up" | "down";
  disabled?: boolean;
  onClick: () => void;
  align?: "right";
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "pressable h-9 rounded-sm px-1 font-mono text-[11px] tabular-nums",
        align === "right" && "text-right",
        disabled ? "text-subtle" : tone === "up" ? "text-up hover:bg-up/15" : "text-down hover:bg-down/15",
      )}
    >
      {value ? fmtPx(value) : "—"}
    </button>
  );
}

const inp =
  "h-11 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-brass";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5">
      <dt className="text-subtle">{k}</dt>
      <dd className="text-right tabular-nums text-fg">{v}</dd>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  step,
  dp,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  dp?: number;
}) {
  const n = Number(value) || 0;
  const d = dp ?? (step < 1 ? 4 : 2);
  return (
    <div className="flex gap-1">
      <button type="button" className="pressable h-9 w-9 rounded-[var(--radius-sm)] border border-border" onClick={() => onChange(Math.max(0, n - step).toFixed(d))}>
        −
      </button>
      <input className="h-9 w-20 rounded-[var(--radius-sm)] border border-border bg-surface text-center font-mono text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="pressable h-9 w-9 rounded-[var(--radius-sm)] border border-border" onClick={() => onChange((n + step).toFixed(d))}>
        +
      </button>
    </div>
  );
}
