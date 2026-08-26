import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { farmApy, lpValue, poolTvl, tokenBal } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { cn, fmtPct, fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/pools")({ component: PoolsPage });

function PoolsPage() {
  const s = useWolf();
  const add = useWolf((st) => st.lpAdd);
  const remove = useWolf((st) => st.lpRemove);
  const create = useWolf((st) => st.createPool);
  const issue = useWolf((st) => st.issueToken);
  const harvest = useWolf((st) => st.harvest);
  const err = useWolf((st) => st.lastError);
  const [openId, setOpenId] = useState<string | null>(null);
  const [base, setBase] = useState("ETH");
  const [quote, setQuote] = useState("USDC");
  const [baseAmt, setBaseAmt] = useState("1");
  const [quoteAmt, setQuoteAmt] = useState("4000");
  const [custom, setCustom] = useState("");
  const ids = Object.keys(s.pools);
  const pair = `${base}-${quote}`;
  const exists = Boolean(s.pools[pair]);
  const tokens = useMemo(() => {
    const extra = Object.keys(s.account.tokens ?? {});
    return ["ETH", "USDC", "WPIT", ...extra];
  }, [s.account.tokens]);
  const tax = s.farmWpit * 0.01;
  const ripe = s.farmWpit > 0;

  function openFarm(id: string) {
    setOpenId(id === openId ? null : id);
    const p = s.pools[id];
    if (p) {
      setBase(p.base);
      setQuote(p.quote);
    }
  }

  return (
    <Shell>
      <ProductGate product="farms">
        <div className="pit-hero relative overflow-hidden border-b border-border">
          <img
            src="/brand/card-farm.jpg"
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
          <div className="relative mx-auto max-w-3xl px-4 py-10 sm:py-14">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">The yield pit</p>
            <h1 className="mt-2 max-w-lg font-display text-4xl font-medium tracking-tight sm:text-5xl">
              Farms that actually <span className="italic text-brass">pay you to look.</span>
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted">Tap a stall. Add both legs. APY moves with TVL, util, and vol — live.</p>
          </div>
        </div>

        <main className="mx-auto max-w-3xl px-4 py-8">
          <div
            className={cn(
              "flex items-center justify-between gap-4 rounded-[var(--radius-xl)] border px-5 py-5",
              ripe ? "ripe-glow border-brass/50 bg-elevated" : "border-border bg-surface",
            )}
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-brass">Ripe to cut</div>
              <div className="font-display text-4xl font-medium tabular-nums">{s.farmWpit.toFixed(2)}</div>
              <p className="text-xs text-muted">WPIT · 1% tax → insurance ({tax.toFixed(2)})</p>
            </div>
            <Button disabled={!ripe} className="h-12 px-6" onClick={() => harvest()}>
              Harvest
            </Button>
          </div>

          <div className="mt-8 grid gap-3">
            {ids.map((id) => {
              const p = s.pools[id]!;
              const tvl = poolTvl(s, id);
              const apy = farmApy(s, id);
              const mine = s.lp.find((x) => x.poolId === id);
              const open = openId === id;
              return (
                <article
                  key={id}
                  className={cn(
                    "overflow-hidden rounded-[var(--radius-xl)] border bg-panel transition-colors duration-200",
                    open ? "border-brass/40" : "border-border hover:border-border-strong",
                  )}
                >
                  <button className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left" onClick={() => openFarm(id)}>
                    <div className="min-w-0">
                      <div className="font-mono text-sm tracking-wide">{prettyPool(id)}</div>
                      <div className="mt-1 text-xs text-muted">
                        TVL {fmtUsd(tvl)} · fee {p.feeBps / 100}%
                        {mine ? ` · you ${fmtUsd(lpValue(s, id, mine.shares))}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="apy-live font-display text-3xl font-medium text-brass">{fmtPct(apy)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle">APY</div>
                    </div>
                  </button>
                  {open ? (
                    <div className="sheet-in border-t border-border bg-surface px-4 py-4">
                      <p className="text-xs text-muted">Existing stall. Deposit both legs at the current curve.</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Amt label={p.base} value={baseAmt} wallet={tokenBal(s.account, p.base)} onChange={setBaseAmt} />
                        <Amt label={p.quote} value={quoteAmt} wallet={tokenBal(s.account, p.quote)} onChange={setQuoteAmt} />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button onClick={() => add(id, Number(quoteAmt) || 0)}>Add liquidity</Button>
                        <Button variant="outline" disabled={!mine} onClick={() => mine && remove(id, mine.shares)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <section className="mt-10 rounded-[var(--radius-xl)] border border-border bg-surface p-5">
            <h2 className="font-display text-2xl font-medium">Open a new stall</h2>
            <p className={cn("mt-1 text-sm", exists ? "text-brass" : "text-muted")}>
              {exists ? `${prettyPool(pair)} is already on the floor — you’ll join that farm.` : `${prettyPool(pair)} doesn’t exist yet. This creates it.`}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TokenPick label="Token A" value={base} tokens={tokens} onChange={setBase} />
              <TokenPick label="Token B" value={quote} tokens={tokens} onChange={setQuote} />
              <Amt label={base} value={baseAmt} wallet={tokenBal(s.account, base)} onChange={setBaseAmt} />
              <Amt label={quote} value={quoteAmt} wallet={tokenBal(s.account, quote)} onChange={setQuoteAmt} />
            </div>
            <div className="mt-4">
              {exists ? (
                <Button
                  onClick={() => {
                    add(pair, Number(quoteAmt) || 0);
                    setOpenId(pair);
                  }}
                >
                  Add to {prettyPool(pair)}
                </Button>
              ) : (
                <Button onClick={() => create(base, quote, Number(baseAmt) || 0, Number(quoteAmt) || 0)}>
                  Create {prettyPool(pair)}
                </Button>
              )}
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              <input
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono uppercase"
                placeholder="Mint a paper ticker"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button variant="outline" onClick={() => issue(custom, 1_000_000)}>
                Mint 1M
              </Button>
            </div>
          </section>
          {err ? <p className="mt-4 text-sm text-down">{err}</p> : null}
        </main>
        <SiteFooter />
      </ProductGate>
    </Shell>
  );
}

function prettyPool(id: string) {
  return id.replace(/-TEST$/, "").replace("-", " / ");
}

function Amt({
  label,
  value,
  wallet,
  onChange,
}: {
  label: string;
  value: string;
  wallet: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-xs">
      {label}
      <input
        className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="mt-1 block text-muted">Wallet {fmtAmt(wallet)}</span>
    </label>
  );
}

function TokenPick({
  label,
  value,
  tokens,
  onChange,
}: {
  label: string;
  value: string;
  tokens: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-xs">
      {label}
      <select
        className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {tokens.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
    </label>
  );
}

function fmtAmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(6);
}