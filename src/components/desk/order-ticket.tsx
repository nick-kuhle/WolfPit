import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SideToggle } from "@/components/ui/toggle";
import {
  buyingPower,
  expiries,
  futLiqPrice,
  markOf,
  maxMiniContracts,
  miniQty,
  optionQuote,
  quoteInForBaseOut,
  strikeGrid,
} from "@/lib/wolfpit/engine";
import { rejectFuture } from "@/lib/wolfpit/risk";
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

export function OrderTicket({ prefer, under: underProp }: { prefer?: "buy" | "sell" | null; under?: string }) {
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
    const id = under === "ETH" ? "ETH-USDC" : under === "WPIT" ? "WPIT-USDC-TEST" : `${under}-USDC`;
    setPoolId(id);
  }, [under]);

  const clock = s.clock;
  const exps = useMemo(() => expiries(clock), [clock]);
  const exp = exps[exi]!;
  const grid = useMemo(() => strikeGrid(spot), [spot]);
  const k = strike || grid[Math.floor(grid.length / 2)] || spot;
  const n = Number(qty) || 0;
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
  const maxN = under === "ETH" ? maxMiniContracts(s, futSide) : Math.floor(bp / Math.max(miniQty(under) * spot * FUT_IM, 1e-9));
  const q = product === "option" ? optionQuote(s, optType, k, exp.at, under) : null;
  const futWhy = product === "future" && under === "ETH" ? rejectFuture(s, futSide, size, exp.at) : null;

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
    if (product === "future") return { label: `IM ${fmtUsd(im)} · ${((1 / FUT_IM)).toFixed(1)}×`, usd: im };
    const debit = (q?.ask ?? 0) * n * miniQty(under);
    return { label: `Debit ${fmtUsd(debit)}`, usd: debit };
  })();

  const blocked =
    paused ||
    n <= 0 ||
    (product === "future" && !!futWhy) ||
    (product === "option" && (!!q?.blank || side === "sell"));

  function fire() {
    send({
      product,
      side,
      kind,
      tif,
      qty: n,
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

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {product === "option" ? (
          <>
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {exps.map((e, i) => (
                <button
                  key={e.at}
                  onClick={() => setExi(i)}
                  className={cn(
                    "pressable h-10 shrink-0 rounded-full border px-3 font-mono text-[11px]",
                    i === exi ? "border-brass bg-brass text-bg" : "border-border text-muted",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <p className="mt-1 font-mono text-[10px] text-subtle">{exp.when} · click ask to buy, bid to sell</p>
            <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-border">
              <div className="grid grid-cols-[1fr_1fr_auto_1fr_1fr] bg-elevated px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-subtle">
                <span>C bid</span>
                <span>C ask</span>
                <span className="text-center">Strike</span>
                <span className="text-right">P bid</span>
                <span className="text-right">P ask</span>
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
                    <div className="min-w-[4.5rem] text-center font-mono text-xs text-fg">{fmtPx(ks)}</div>
                    <LadderCell value={p.bid} tone="down" disabled={!p.bid} onClick={() => pickLadder("put", "bid", ks)} align="right" />
                    <LadderCell value={p.ask} tone="up" disabled={!p.ask} onClick={() => pickLadder("put", "ask", ks)} align="right" />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mt-3">
              <SideToggle value={side} onChange={setSide} />
            </div>
            {product === "spot" && (
              <Field label="Pool">
                <select className={inp} value={poolId} onChange={(e) => setPoolId(e.target.value)}>
                  {Object.keys(s.pools).map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </Field>
            )}
            {product === "future" && (
              <Field label="Expiry">
                <div className="grid gap-1">
                  {exps.map((e, i) => (
                    <button
                      key={e.at}
                      onClick={() => setExi(i)}
                      className={cn(
                        "pressable flex h-11 items-center justify-between rounded-[var(--radius-sm)] border px-3",
                        i === exi ? "border-brass text-fg" : "border-border text-muted",
                      )}
                    >
                      <span className="font-mono text-xs">{e.label}</span>
                      <span className="font-mono text-[11px]">{e.when}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </>
        )}

        {sheet || product !== "option" ? (
          <div className="mt-3 rounded-[var(--radius-lg)] border border-brass/40 bg-elevated p-3">
            {product === "option" ? (
              <p className="font-mono text-[11px] text-brass">
                {side.toUpperCase()} {optType.toUpperCase()} {under} {fmtPx(k)} · {exp.when}
              </p>
            ) : null}
            <Field label={product === "spot" ? "Quantity (base)" : "Contracts"}>
              <Stepper value={qty} onChange={setQty} step={product === "spot" ? 0.1 : 1} presets={product === "spot" ? [0.1, 0.5, 1, 5] : [1, 2, 5, 10]} />
            </Field>
            <Field label="Type">
              <div className="grid grid-cols-4 gap-1">
                {KINDS.map((knd) => (
                  <button
                    key={knd.id}
                    onClick={() => setKind(knd.id)}
                    className={cn("pressable h-10 rounded-[var(--radius-sm)] border text-[11px]", kind === knd.id ? "border-brass text-fg" : "border-border text-muted")}
                  >
                    {knd.label}
                  </button>
                ))}
              </div>
            </Field>
            {(kind === "lmt" || kind === "stl") && (
              <Field label="Limit">
                <Stepper value={limit} onChange={setLimit} step={spot >= 50 ? 1 : 0.01} dp={spot >= 50 ? 2 : 4} />
              </Field>
            )}
            <dl className="mt-2 space-y-1 font-mono text-[11px]">
              {product === "future" ? (
                <>
                  <Row k="Expiry" v={exp.when} />
                  <Row k="Size" v={`${size} ${under}`} />
                  <Row k="IM / MM" v={`${fmtUsd(im)} / ${fmtUsd(mm)}`} />
                  <Row k="Liq" v={fmtPx(liq)} />
                  <Row k="Buying power" v={fmtUsd(bp)} />
                  <Row k="Max new" v={`${maxN} mini`} />
                </>
              ) : product === "option" && q ? (
                <>
                  <Row k="Ask / Δ" v={`${fmtPx(q.ask)} / ${q.delta.toFixed(2)}`} />
                  <Row k="Est." v={est.label} />
                  <Row k="Cash" v={fmtUsd(s.account.usdc)} />
                </>
              ) : (
                <Row k="Est." v={est.label} />
              )}
            </dl>
            {product === "option" && side === "sell" ? (
              <p className="mt-2 text-xs text-muted">Vault does not buy. Close longs from Positions.</p>
            ) : null}
            {q?.blank ? <p className="mt-2 text-xs text-down">{q.blank}</p> : null}
            {err ? <p className="mt-2 text-xs text-down">{err}</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {product === "option" ? (
                <Button variant="outline" onClick={() => setSheet(false)}>
                  Back
                </Button>
              ) : (
                <div />
              )}
              <Button variant={side === "buy" ? "up" : "down"} disabled={blocked} onClick={fire}>
                Confirm {side}
              </Button>
            </div>
          </div>
        ) : null}

        {(s.working ?? []).length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Working</h3>
            {s.working.map((w) => (
              <div key={w.id} className="mb-2 flex items-center justify-between border-b border-border pb-2 text-xs">
                <div className="font-medium">
                  {w.side.toUpperCase()} {w.qty} {w.under ?? w.product} {w.kind.toUpperCase()}
                </div>
                <button className="h-11 px-3 text-muted" onClick={() => cancel(w.id)}>
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