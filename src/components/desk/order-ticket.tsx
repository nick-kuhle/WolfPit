import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SideToggle } from "@/components/ui/toggle";
import {
  buyingPower,
  expiries,
  futLiqPrice,
  markOf,
  maxMiniContracts,
  maxSpotQty,
  miniQty,
  optionQuote,
  quoteInForBaseOut,
  strikeGrid,
} from "@/lib/wolfpit/engine";
import { MAX_LOT } from "@/lib/wolfpit/limits";
import { useWolf } from "@/lib/wolfpit/store";
import type { DeskSide, OrderKind, OptType, PoolId, Product, Tif } from "@/lib/wolfpit/types";
import { FUT_IM, FUT_MM } from "@/lib/wolfpit/types";
import { useAdmin } from "@/lib/admin/config";
import { cn, fmtPx, fmtUsd } from "@/lib/utils";

const KINDS: { id: OrderKind; label: string }[] = [
  { id: "mkt", label: "MKT" },
  { id: "lmt", label: "LMT" },
  { id: "stp", label: "STP" },
];

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
  const [product, setProduct] = useState<Product>("option");
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
  }, [under]);

  const clock = s.clock;
  const exps = useMemo(() => expiries(clock), [clock]);
  const exp = exps[exi]!;
  const grid = useMemo(() => strikeGrid(spot), [spot]);
  const k = strike || grid[Math.floor(grid.length / 2)] || spot;
  const rawN = Number(qty);
  const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 0;
  const products: Product[] = geo ? ["spot"] : ["spot", "future", "option"];
  const futSide = side === "buy" ? "long" : "short";
  const size = n * miniQty(under);
  const im = size * spot * FUT_IM;
  const mm = size * spot * FUT_MM;
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
  const futWhy = product === "future" ? (n > 0 ? null : "Size must be positive.") : null;

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
      return { label: `IM ${fmtUsd(im)} · debit ${fmtUsd(im + size * spot * 0.0005)} · ${(1 / FUT_IM).toFixed(1)}×`, usd: im + size * spot * 0.0005 };
    }
    const debit = (q?.ask ?? 0) * n * miniQty(under);
    return { label: `Debit ${fmtUsd(debit)}`, usd: debit };
  })();

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
    if (blocked) return;
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
  }

  function pickLadder(type: OptType, click: "bid" | "ask", ks: number) {
    setProduct("option");
    setOptType(type);
    setStrike(ks);
    setSide(click === "ask" ? "buy" : "sell");
    setSheet(true);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex border-b border-border">
        {products.map((p) => (
          <button
            key={p}
            onClick={() => {
              setProduct(p);
              setSheet(false);
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
        ) : product !== "option" ? (
          <>
            <div className="mt-2">
              <SideToggle value={side} onChange={setSide} />
            </div>
            {product === "future" ? (
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
            ) : (
              <Field label="Pool">
                <select className={inp} value={poolId} onChange={(e) => setPoolId(e.target.value as PoolId)}>
                  {Object.keys(s.pools).map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </Field>
            )}
          </>
        ) : (
          <p className="mt-2 font-mono text-[11px] text-brass">
            {side.toUpperCase()} {optType.toUpperCase()} {under} {fmtPx(k)} · {exp.when}
          </p>
        )}
      </div>

      {sheet || product !== "option" ? (
        <div className="shrink-0 border-t border-brass/30 bg-elevated px-3 py-2">
          {product === "option" ? (
            <p className="mb-1 font-mono text-[11px] text-brass">
              {side.toUpperCase()} {optType.toUpperCase()} {fmtPx(k)} · {exp.label}
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-subtle">{product === "spot" ? "Qty" : "Contracts"}</div>
              <Stepper
                value={qty}
                onChange={setQty}
                step={product === "spot" ? 0.1 : 1}
                presets={product === "spot" ? [0.1, 0.5, 1, Math.max(0.1, Math.min(5, maxN))] : [1, 2, 5, 10].filter((p) => p <= Math.max(1, maxN))}
                dp={product === "spot" ? 4 : 0}
              />
            </div>
            <Button className="h-11 px-5" variant={side === "buy" ? "up" : "down"} disabled={blocked} onClick={fire}>
              {side === "buy" ? "Buy" : "Sell"}
            </Button>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted">
            {est.label}
            {product === "future" ? ` · liq ${fmtPx(liq)} · MM ${fmtUsd(mm)}` : ""}
            {` · max ${product === "spot" ? maxN.toPrecision(4) : Math.floor(maxN)} · cash ${fmtUsd(bp)}`}
          </p>
          {overSize ? <p className="text-[10px] text-down">Size exceeds max {product === "spot" ? maxN.toPrecision(4) : Math.floor(maxN)} given cash, inventory, and pool depth.</p> : null}
          {overCash ? <p className="text-[10px] text-down">Not enough cash for this size. Debit {fmtUsd(est.usd)} vs {fmtUsd(bp)} free.</p> : null}
          {product === "option" && side === "sell" ? <p className="text-[10px] text-muted">Vault does not buy. Close longs from Positions.</p> : null}
          {q?.blank ? <p className="text-[10px] text-down">{q.blank}</p> : null}
          {err ? <p className="text-[10px] text-down">{err}</p> : null}
          {product === "option" ? (
            <button type="button" className="mt-1 text-[11px] text-brass" onClick={() => setSheet(false)}>
              Back to chain
            </button>
          ) : null}
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
    <div className="flex justify-between gap-3">
      <dt className="text-subtle">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  step,
  presets,
  dp,
}: {
  value: string;
  onChange: (v: string) => void;
  step: number;
  presets?: number[];
  dp?: number;
}) {
  const n = Number(value) || 0;
  const d = dp ?? (step < 1 ? 4 : 2);
  return (
    <div>
      <div className="flex gap-1">
        <button className="pressable h-11 w-11 rounded-[var(--radius-sm)] border border-border" onClick={() => onChange(Math.max(0, n - step).toFixed(d))}>
          −
        </button>
        <input className={inp} value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="pressable h-11 w-11 rounded-[var(--radius-sm)] border border-border" onClick={() => onChange((n + step).toFixed(d))}>
          +
        </button>
      </div>
      {presets ? (
        <div className="mt-1 flex gap-1">
          {presets.map((p) => (
            <button key={p} className="pressable h-8 rounded-full border border-border px-2 font-mono text-[11px] text-muted" onClick={() => onChange(String(p))}>
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}