import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { YieldNav } from "@/components/yield-nav";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { farmApy, farmPending, harvestDue, lpPnl, lpValue, poolMark, poolTvl, tokenBal } from "@/lib/wolfpit/engine";
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
  const [pending, setPending] = useState<null | { title: string; body: string; run: () => void }>(null);
  const ids = Object.keys(s.pools);
  const pair = `${base}-${quote}`;
  const pairId = s.pools[pair] ? pair : s.pools[`${pair}-TEST`] ? `${pair}-TEST` : pair;
  const exists = Boolean(s.pools[pairId]);
  const tokens = useMemo(() => {
    const extra = Object.keys(s.account.tokens ?? {});
    return ["ETH", "USDC", "WPIT", ...extra];
  }, [s.account.tokens]);
  const tax = harvestDue(s) * 0.01;
  const ripeAmt = harvestDue(s);
  const ripe = ripeAmt > 0;

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
        <div className="relative overflow-hidden border-b border-brass/40 bg-brass text-bg">
          <div className="mx-auto max-w-3xl px-4 py-5 sm:py-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-bg/70">The yield pit</p>
            <h1 className="mt-1 font-display text-3xl font-medium tracking-tight sm:text-5xl">
              Farms that <span className="italic">pay you to look.</span>
            </h1>
            <p className="mt-2 max-w-md text-sm text-bg/80">Tap a stall. Add both legs. APY moves with TVL, util, and vol.</p>
            <YieldNav on="farms" />
          </div>
        </div>

        <main className="mx-auto max-w-3xl px-4 py-5 sm:py-8">
          <div
            className={cn(
              "flex items-center justify-between gap-4 rounded-[var(--radius-xl)] border px-5 py-5",
              ripe ? "ripe-glow border-brass/50 bg-elevated" : "border-border bg-surface",
            )}
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-brass">Ripe to cut</div>
              <div className="font-display text-4xl font-medium tabular-nums">{ripeAmt.toFixed(2)}</div>
              <p className="text-xs text-muted">WPIT · your LP share · 1% tax → insurance ({tax.toFixed(2)})</p>
            </div>
            <Button
              disabled={!ripe}
              className="h-12 px-6"
              onClick={() =>
                setPending({
                  title: "Harvest WPIT",
                  body: `Collect ${ripeAmt.toFixed(2)} WPIT (your share of emissions). 1% tax to insurance.`,
                  run: () => harvest(),
                })
              }
            >
              Harvest
            </Button>
          </div>

          {s.lp.length > 0 ? (
            <section className="mt-8">
              <h2 className="font-display text-2xl">Your liquidity</h2>
              <p className="mt-1 text-sm text-muted">
                Harvested {(s.harvestedWpit ?? 0).toFixed(2)} WPIT · ripe {ripeAmt.toFixed(2)} WPIT
              </p>
              <div className="mt-3 grid gap-3">
                {s.lp.map((pos) => {
                  const p = s.pools[pos.poolId];
                  const val = lpValue(s, pos.poolId, pos.shares);
                  const pnl = lpPnl(s, pos);
                  const pending = farmPending(s, pos.poolId);
                  return (
                    <article key={pos.poolId} className="rounded-[var(--radius-xl)] border border-brass/40 bg-elevated p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm">{prettyPool(pos.poolId)}</div>
                          <div className="mt-1 font-mono text-[11px] text-muted">
                            {pos.shares.toPrecision(5)} LP tokens · {fmtUsd(val)} in the pool
                          </div>
                          <div className="font-mono text-[11px] text-muted">
                            {p ? `TVL ${fmtUsd(poolTvl(s, pos.poolId))} · ${fmtPct(farmApy(s, pos.poolId))} APY` : ""}
                          </div>
                          <div className="mt-1 font-mono text-[11px]">
                            Ripe {pending.toFixed(2)} WPIT
                            {pos.costUsdc ? ` · cost ${fmtUsd(pos.costUsdc)}` : ""}
                            <span className={pnl >= 0 ? " text-up" : " text-down"}> · P/L {fmtUsd(pnl)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[0.25, 0.5, 1].map((pct) => (
                          <Button
                            key={pct}
                            size="sm"
                            variant={pct === 1 ? "outline" : "ghost"}
                            onClick={() =>
                              setPending({
                                title: `Remove ${(pct * 100).toFixed(0)}% from ${prettyPool(pos.poolId)}`,
                                body: `Pull ${(pos.shares * pct).toPrecision(4)} LP tokens (${fmtUsd(val * pct)}). Legs return to your wallet.`,
                                run: () => remove(pos.poolId, pos.shares * pct),
                              })
                            }
                          >
                            Remove {(pct * 100).toFixed(0)}%
                          </Button>
                        ))}
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(pos.poolId)}>
                          Add more
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="mt-8 grid gap-3">
            {ids.map((id) => {
              const p = s.pools[id]!;
              const tvl = poolTvl(s, id);
              const apy = farmApy(s, id);
              const mark = poolMark(s, p);
              const needQuote = (Number(baseAmt) || 0) * mark;
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
                      <div className="apy-live font-display text-4xl font-medium leading-none text-brass">{fmtPct(apy)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-subtle">APY</div>
                    </div>
                  </button>
                  {open ? (
                    <div className="sheet-in border-t border-border bg-surface px-4 py-4">
                      <p className="text-xs text-muted">
                        Existing pool. Both legs lock to the live mark ({p.base} {fmtUsd(mark, 4)}). You cannot set a
                        custom print here.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Amt label={p.base} value={baseAmt} wallet={tokenBal(s.account, p.base)} onChange={setBaseAmt} />
                        <label className="text-xs">
                          {p.quote} (required)
                          <input
                            readOnly
                            className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-muted"
                            value={needQuote ? needQuote.toPrecision(6) : ""}
                          />
                          <span className="mt-1 block text-muted">Wallet {fmtAmt(tokenBal(s.account, p.quote))}</span>
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            setPending({
                              title: `Add to ${prettyPool(id)}`,
                              body: `Deposit ${baseAmt} ${p.base} and ${needQuote.toPrecision(6)} ${p.quote} at the live mark.`,
                              run: () => add(id, needQuote),
                            })
                          }
                        >
                          Add liquidity
                        </Button>
                        {mine
                          ? [0.25, 0.5, 1].map((pct) => (
                              <Button
                                key={pct}
                                variant="outline"
                                onClick={() =>
                                  setPending({
                                    title: `Remove ${(pct * 100).toFixed(0)}%`,
                                    body: `Pull ${(mine.shares * pct).toPrecision(4)} LP from ${prettyPool(id)} (${fmtUsd(lpValue(s, id, mine.shares) * pct)}).`,
                                    run: () => remove(id, mine.shares * pct),
                                  })
                                }
                              >
                                Remove {(pct * 100).toFixed(0)}%
                              </Button>
                            ))
                          : null}
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
              {exists
                ? `${prettyPool(pairId)} already trades. Deposits lock to the live mark — you will not set a new print.`
                : `${prettyPool(pair)} is new. Both legs set the opening print (e.g. WPIT / ETH).`}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TokenPick label="Token A" value={base} tokens={tokens} onChange={setBase} />
              <TokenPick label="Token B" value={quote} tokens={tokens} onChange={setQuote} />
              <Amt label={base} value={baseAmt} wallet={tokenBal(s.account, base)} onChange={setBaseAmt} />
              {exists ? (
                <label className="text-xs">
                  {quote} (required)
                  <input
                    readOnly
                    className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono text-muted"
                    value={(((Number(baseAmt) || 0) * poolMark(s, s.pools[pairId]!)) || 0).toPrecision(6)}
                  />
                </label>
              ) : (
                <Amt label={quote} value={quoteAmt} wallet={tokenBal(s.account, quote)} onChange={setQuoteAmt} />
              )}
            </div>
            {!exists && Number(baseAmt) > 0 && Number(quoteAmt) > 0 ? (
              <p className="mt-2 text-xs text-brass">
                Opening print: 1 {base} = {(Number(quoteAmt) / Number(baseAmt)).toPrecision(6)} {quote}
              </p>
            ) : null}
            <div className="mt-4">
              {exists ? (
                <Button
                  onClick={() => {
                    const mark = poolMark(s, s.pools[pairId]!);
                    const qAmt = (Number(baseAmt) || 0) * mark;
                    setPending({
                      title: `Add to ${prettyPool(pairId)}`,
                      body: `Deposit ${baseAmt} ${base} and ${qAmt.toPrecision(6)} ${quote} at the live mark.`,
                      run: () => add(pairId, qAmt),
                    });
                    setOpenId(pairId);
                  }}
                >
                  Add to {prettyPool(pairId)}
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    setPending({
                      title: `Create ${prettyPool(pair)}`,
                      body: `Seed ${baseAmt} ${base} and ${quoteAmt} ${quote}. Implied 1 ${base} = ${(Number(quoteAmt) / Math.max(Number(baseAmt), 1e-12)).toPrecision(6)} ${quote}.`,
                      run: () => create(base, quote, Number(baseAmt) || 0, Number(quoteAmt) || 0),
                    })
                  }
                >
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
        {pending ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
            <div className="sheet-in w-full max-w-sm rounded-[var(--radius-xl)] border border-border bg-panel p-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-brass">Confirm</p>
              <h3 className="mt-2 font-display text-2xl font-medium">{pending.title}</h3>
              <p className="mt-2 text-sm text-muted">{pending.body}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setPending(null)}>
                  Back
                </Button>
                <Button
                  onClick={() => {
                    pending.run();
                    setPending(null);
                  }}
                >
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        ) : null}
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