import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { expiries, maxNetLongEth, maxNetShortEth, optionQuote, spreadBps } from "@/lib/wolfpit/engine";
import { rejectFuture } from "@/lib/wolfpit/risk";
import { useWolf } from "@/lib/wolfpit/store";
import type { FutSide, OptType, PoolId } from "@/lib/wolfpit/types";
import { MINI_ETH, FUT_IM } from "@/lib/wolfpit/types";
import { useAdmin } from "@/lib/admin/config";
import { fmtPx, fmtUsd } from "@/lib/utils";

export function OrderTicket({ prefer: _prefer }: { prefer?: "buy" | "sell" | null }) {
  const [tab, setTab] = useState<"spot" | "future" | "option">("spot");
  const err = useWolf((s) => s.lastError);
  const clear = useWolf((s) => s.clearError);
  const geo = useAdmin((s) => s.geoFenceUs);
  const paused = useAdmin((s) => s.listingsPaused);
  const tabs = geo ? (["spot"] as const) : (["spot", "future", "option"] as const);
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              clear();
            }}
            className={`h-11 flex-1 text-xs uppercase tracking-wider ${tab === t ? "text-fg border-b border-accent" : "text-muted"}`}
          >
            {t === "spot" ? "Spot" : t === "future" ? "Mini fut" : "Mini opt"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "spot" && <SpotForm />}
        {!geo && tab === "future" && <FutForm />}
        {!geo && tab === "option" && <OptForm />}
        {paused ? <p className="mt-3 text-xs text-brass">Listings paused by pit ops.</p> : null}
        {err ? <p className="mt-3 text-xs text-down">{err}</p> : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      {children}
    </label>
  );
}

const inputCls =
  "h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-sm text-fg outline-none focus:ring-2 focus:ring-ring";

function SpotForm() {
  const [pool, setPool] = useState<PoolId>("ETH-USDC");
  const [usd, setUsd] = useState("2500");
  const [base, setBase] = useState("0.5");
  const buy = useWolf((s) => s.buySpot);
  const sell = useWolf((s) => s.sellSpot);
  const pools = useWolf((s) => s.pools);
  const p = pools[pool];
  const px = p && p.baseReserve > 0 ? p.quoteReserve / p.baseReserve : 0;
  const ids = Object.keys(pools);
  if (!p) return <p className="text-xs text-muted">No pool.</p>;
  return (
    <div>
      <Field label="Pool">
        <select className={inputCls} value={pool} onChange={(e) => setPool(e.target.value as PoolId)}>
          {ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </Field>
      <p className="mb-3 font-mono text-xs text-muted">
        Mid {fmtPx(px)} · fee {p.feeBps / 100}% · test contract
      </p>
      <Field label={pool === "WPIT-ETH-TEST" ? "Buy with USD notional" : "Buy USDC notional"}>
        <input className={inputCls} value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal" />
      </Field>
      <Button className="mb-4 w-full" variant="up" onClick={() => buy(pool, Number(usd) || 0)}>
        Buy
      </Button>
      <Field label={pool === "ETH-USDC" ? "Sell ETH qty" : "Sell WPIT qty"}>
        <input className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" />
      </Field>
      <Button className="w-full" variant="down" onClick={() => sell(pool, Number(base) || 0)}>
        Sell
      </Button>
    </div>
  );
}

function FutForm() {
  const clock = useWolf((s) => s.clock);
  const eth = useWolf((s) => s.eth);
  const s = useWolf();
  const [side, setSide] = useState<FutSide>("long");
  const [n, setN] = useState("1");
  const [exi, setExi] = useState(0);
  const open = useWolf((s) => s.openFut);
  const exps = useMemo(() => expiries(clock), [clock]);
  const contracts = Number(n) || 0;
  const size = contracts * MINI_ETH;
  const cap = side === "long" ? maxNetLongEth(s) : maxNetShortEth(s);
  const margin = size * eth * FUT_IM;
  const why = rejectFuture(s, side, size, exps[exi]!.at);
  return (
    <div>
      <p className="mb-3 text-xs leading-snug text-muted">
        Mini = {MINI_ETH} ETH. Vault hedges 1:1. Max net {side} {cap.toFixed(2)} ETH. Spread {spreadBps(s).toFixed(0)} bps.
      </p>
      {why ? <p className="mb-3 text-xs text-down">{why}</p> : null}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant={side === "long" ? "up" : "outline"} onClick={() => setSide("long")}>
          Long
        </Button>
        <Button variant={side === "short" ? "down" : "outline"} onClick={() => setSide("short")}>
          Short
        </Button>
      </div>
      <Field label="Contracts (minis)">
        <input className={inputCls} value={n} onChange={(e) => setN(e.target.value)} inputMode="decimal" />
      </Field>
      <Field label="Expiry">
        <select className={inputCls} value={exi} onChange={(e) => setExi(Number(e.target.value))}>
          {exps.map((e, i) => (
            <option key={e.at} value={i}>
              {e.label} · {new Date(e.at).toISOString().slice(0, 10)}
            </option>
          ))}
        </select>
      </Field>
      <p className="mb-3 font-mono text-xs text-muted">
        Size {size.toFixed(2)} ETH · IM {fmtUsd(margin)} (4×)
      </p>
      <Button
        className="w-full"
        variant={side === "long" ? "up" : "down"}
        disabled={!!why || contracts <= 0}
        onClick={() => open(side, contracts, exps[exi]!.at)}
      >
        {why ? "No quote" : `Send ${side}`}
      </Button>
    </div>
  );
}

function OptForm() {
  const clock = useWolf((s) => s.clock);
  const eth = useWolf((s) => s.eth);
  const s = useWolf();
  const [type, setType] = useState<OptType>("call");
  const [n, setN] = useState("1");
  const [exi, setExi] = useState(0);
  const [k, setK] = useState(0);
  const open = useWolf((s) => s.openOpt);
  const exps = useMemo(() => expiries(clock), [clock]);
  const ks = [Math.round(eth / 100) * 100 - 200, Math.round(eth / 100) * 100 - 100, Math.round(eth / 100) * 100, Math.round(eth / 100) * 100 + 100, Math.round(eth / 100) * 100 + 200];
  const strike = ks[k] ?? ks[2]!;
  const q = optionQuote(s, type, strike, exps[exi]!.at);
  const premium = q.ask * (Number(n) || 0) * MINI_ETH;
  return (
    <div>
      <p className="mb-3 text-xs leading-snug text-muted">
        You buy. Vault sells only if covered (calls) or cash-secured (puts). European, cash-settled.
      </p>
      {q.blank ? <p className="mb-3 text-xs text-down">{q.blank}</p> : null}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant={type === "call" ? "up" : "outline"} onClick={() => setType("call")}>
          Call
        </Button>
        <Button variant={type === "put" ? "down" : "outline"} onClick={() => setType("put")}>
          Put
        </Button>
      </div>
      <Field label="Strike">
        <select className={inputCls} value={k} onChange={(e) => setK(Number(e.target.value))}>
          {ks.map((x, i) => (
            <option key={x} value={i}>
              {x}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Expiry">
        <select className={inputCls} value={exi} onChange={(e) => setExi(Number(e.target.value))}>
          {exps.map((e, i) => (
            <option key={e.at} value={i}>
              {e.label} · {new Date(e.at).toISOString().slice(0, 10)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contracts">
        <input className={inputCls} value={n} onChange={(e) => setN(e.target.value)} inputMode="decimal" />
      </Field>
      <p className="mb-3 font-mono text-xs text-muted">
        Ask {fmtPx(q.ask)} · Δ {q.delta.toFixed(2)} · debit {fmtUsd(premium)}
      </p>
      <Button
        className="w-full"
        variant={type === "call" ? "up" : "down"}
        disabled={!!q.blank || !(Number(n) > 0)}
        onClick={() => open(type, strike, exps[exi]!.at, Number(n) || 0)}
      >
        {q.blank ? "No quote" : `Buy ${type}`}
      </Button>
    </div>
  );
}
