import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { RanchHero } from "@/components/yield-nav";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { ConfirmSheet, type Confirm } from "@/components/confirm-sheet";
import { farmApy, farmPending, farmShare, harvestDue, lpPnl, lpValue, poolMark, poolTvl, tokenBal, tokenPx } from "@/lib/wolfpit/engine";
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
  const [pending, setPending] = useState<Confirm | null>(null);
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
        <RanchHero
          on="farms"
          image="/brand/card-farm.jpg"
          kicker="The Ranch · Farms"
          title={
            <>
              Farms that <span className="italic text-brass">pay you to look.</span>
            </>
          }
          sub="Tap a stall. Add both legs. APY moves with TVL, util, and vol."
        />

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
                  kicker: "Confirm harvest",
                  title: "Harvest WPIT",
                  sub: "Your share of farm emissions",
                  rows: [
                    { k: "Ripe", v: `${ripeAmt.toFixed(2)} WPIT`, tone: "brass" },
                    { k: "Insurance tax (1%)", v: `${tax.toFixed(2)} WPIT` },
                    { k: "You receive", v: `${(ripeAmt - tax).toFixed(2)} WPIT`, tone: "up" },
                    { k: "Wallet WPIT after", v: (s.account.wpit + ripeAmt - tax).toFixed(2) },
                    { k: "Est. value", v: fmtUsd((ripeAmt - tax) * s.wpit, 4) },
                  ],
                  note: "Paper emissions. Nothing leaves the sim until you confirm.",
                  confirmLabel: "Harvest",
                  confirmTone: "up",
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
                            onClick={() => {
                              const sh = pos.shares * pct;
                              const frac = p ? sh / p.lpSupply : 0;
                              setPending({
                                kicker: "Confirm liquidity remove",
                                title: `Remove ${(pct * 100).toFixed(0)}% · ${prettyPool(pos.poolId)}`,
                                sub: "Both legs return to your wallet at the live mark",
                                rows: [
                                  { k: "LP tokens", v: `${sh.toPrecision(4)} of ${pos.shares.toPrecision(4)}` },
                                  ...(p
                                    ? [
                                        { k: `${p.base} out (est.)`, v: `${fmtAmt(frac * p.baseReserve)} ${p.base}` },
                                        { k: `${p.quote} out (est.)`, v: `${fmtAmt(frac * p.quoteReserve)} ${p.quote}` },
                                      ]
                                    : []),
                                  { k: "Est. value", v: fmtUsd(val * pct), tone: "brass" },
                                  { k: "Position P/L", v: fmtUsd(pnl), tone: pnl >= 0 ? ("up" as const) : ("down" as const) },
                                  { k: "Your share after", v: p ? `${(((pos.shares - sh) / p.lpSupply) * 100).toFixed(2)}%` : "—" },
                                ],
                                note: "Paper pool. Nothing leaves the sim until you confirm.",
                                confirmLabel: `Remove ${(pct * 100).toFixed(0)}%`,
                                run: () => remove(pos.poolId, sh),
                              });
                            }}
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
                        Existing pool. Both legs lock to the live mark (1 {p.base} = {fmtAmt(mark)} {p.quote}). You cannot
                        set a custom print here.
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
                          disabled={needQuote <= 0 || needQuote > tokenBal(s.account, p.quote)}
                          onClick={() => {
                            const lpEst = p.quoteReserve > 0 ? (needQuote / p.quoteReserve) * p.lpSupply : 0;
                            setPending({
                              kicker: "Confirm liquidity add",
                              title: `Add to ${prettyPool(id)}`,
                              sub: `Both legs at the live ${p.base} / ${p.quote} mark`,
                              rows: [
                                { k: `Leg ${p.base}`, v: `${baseAmt || "0"} ${p.base}` },
                                { k: `Leg ${p.quote} (required)`, v: `${fmtAmt(needQuote)} ${p.quote}` },
                                { k: "Live mark", v: `${fmtAmt(mark)} ${p.quote}/${p.base}` },
                                { k: "Total deposit", v: fmtUsd(needQuote * tokenPx(s, p.quote)), tone: "brass" },
                                { k: "LP tokens (est.)", v: lpEst.toPrecision(6) },
                                { k: "Fee tier", v: `${p.feeBps / 100}%` },
                                { k: "Pool TVL after (est.)", v: fmtUsd(tvl + needQuote * tokenPx(s, p.quote)) },
                                { k: "Farm APY", v: fmtPct(apy), tone: "up" },
                                { k: `Wallet ${p.quote} after`, v: fmtAmt(tokenBal(s.account, p.quote) - needQuote) },
                              ],
                              note: "Deposits lock to the live mark — no custom print on an existing pool. Paper funds only.",
                              confirmLabel: "Add liquidity",
                              confirmTone: "up",
                              run: () => add(id, needQuote),
                            });
                          }}
                        >
                          Add liquidity
                        </Button>
                        {mine
                          ? [0.25, 0.5, 1].map((pct) => (
                              <Button
                                key={pct}
                                variant="outline"
                                onClick={() => {
                                  const sh = mine.shares * pct;
                                  const frac = sh / p.lpSupply;
                                  setPending({
                                    kicker: "Confirm liquidity remove",
                                    title: `Remove ${(pct * 100).toFixed(0)}% · ${prettyPool(id)}`,
                                    sub: "Both legs return to your wallet at the live mark",
                                    rows: [
                                      { k: "LP tokens", v: `${sh.toPrecision(4)} of ${mine.shares.toPrecision(4)}` },
                                      { k: `${p.base} out (est.)`, v: `${fmtAmt(frac * p.baseReserve)} ${p.base}` },
                                      { k: `${p.quote} out (est.)`, v: `${fmtAmt(frac * p.quoteReserve)} ${p.quote}` },
                                      { k: "Est. value", v: fmtUsd(lpValue(s, id, mine.shares) * pct), tone: "brass" },
                                      { k: "Your share after", v: `${(((mine.shares - sh) / p.lpSupply) * 100).toFixed(2)}%` },
                                    ],
                                    note: "Paper pool. Nothing leaves the sim until you confirm.",
                                    confirmLabel: `Remove ${(pct * 100).toFixed(0)}%`,
                                    run: () => remove(id, sh),
                                  });
                                }}
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
                  disabled={(Number(baseAmt) || 0) <= 0}
                  onClick={() => {
                    const mark = poolMark(s, s.pools[pairId]!);
                    const qAmt = (Number(baseAmt) || 0) * mark;
                    const pool = s.pools[pairId]!;
                    setPending({
                      kicker: "Confirm liquidity add",
                      title: `Add to ${prettyPool(pairId)}`,
                      sub: `Both legs at the live ${base} / ${quote} mark`,
                      rows: [
                        { k: `Leg ${base}`, v: `${baseAmt || "0"} ${base}` },
                        { k: `Leg ${quote} (required)`, v: `${fmtAmt(qAmt)} ${quote}` },
                        { k: "Live mark", v: `${fmtAmt(mark)} ${quote}/${base}` },
                        { k: "Total deposit", v: fmtUsd(qAmt * tokenPx(s, quote)), tone: "brass" },
                        { k: "LP tokens (est.)", v: (pool.quoteReserve > 0 ? (qAmt / pool.quoteReserve) * pool.lpSupply : 0).toPrecision(6) },
                        { k: "Fee tier", v: `${pool.feeBps / 100}%` },
                        { k: "Farm APY", v: fmtPct(farmApy(s, pairId)), tone: "up" },
                        { k: `Wallet ${quote} after`, v: fmtAmt(tokenBal(s.account, quote) - qAmt) },
                      ],
                      note: "Deposits lock to the live mark — no custom print on an existing pool. Paper funds only.",
                      confirmLabel: "Add liquidity",
                      confirmTone: "up",
                      run: () => add(pairId, qAmt),
                    });
                    setOpenId(pairId);
                  }}
                >
                  Add to {prettyPool(pairId)}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const b = Number(baseAmt) || 0;
                    const q = Number(quoteAmt) || 0;
                    setPending({
                      kicker: "Confirm new pool",
                      title: `Create ${prettyPool(pair)}`,
                      sub: "Your seed sets the opening print",
                      rows: [
                        { k: `Seed ${base}`, v: `${b} ${base}` },
                        { k: `Seed ${quote}`, v: `${q} ${quote}` },
                        { k: "Opening print", v: `1 ${base} = ${(q / Math.max(b, 1e-12)).toPrecision(6)} ${quote}`, tone: "brass" },
                        { k: "LP tokens minted", v: Math.sqrt(b * q).toPrecision(6) },
                        { k: "Pool value at open", v: fmtUsd(b * tokenPx(s, base) + q * tokenPx(s, quote), 2) },
                        { k: "Your share at open", v: "100%", tone: "up" },
                        { k: "Fee tier", v: "0.30%" },
                        {
                          k: "Farms",
                          v:
                            farmShare(s, pair) > 0
                              ? `WPIT emissions on (gauge ${(farmShare(s, pair) * 100).toFixed(0)}%)`
                              : "No WPIT emissions (only WPIT/USDC + WPIT/ETH gauges earn)",
                        },
                      ],
                      note: "First print on this pair — futures and options unlock once the pool exists. Paper funds only.",
                      confirmLabel: "Create pool",
                      confirmTone: "up",
                      run: () => create(base, quote, b, q),
                    });
                  }}
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
              <Button
                variant="outline"
                onClick={() => {
                  const sym = custom.trim().toUpperCase();
                  if (!sym) return;
                  setPending({
                    kicker: "Confirm paper mint",
                    title: `Mint 1,000,000 ${sym}`,
                    sub: "Paper ticker — no real token, no pool yet",
                    rows: [
                      { k: "Ticker", v: sym, tone: "brass" },
                      { k: "Amount", v: "1,000,000" },
                      { k: "Wallet after", v: `${fmtAmt(tokenBal(s.account, sym) + 1_000_000)} ${sym}` },
                      { k: "Value", v: "$0 — no pool yet" },
                      { k: "Next step", v: `Open a ${sym} / ETH or USDC pool to set a print` },
                    ],
                    note: "Prints paper into your wallet only. Paper funds, no real token.",
                    confirmLabel: "Mint 1M",
                    confirmTone: "up",
                    run: () => issue(custom, 1_000_000),
                  });
                }}
              >
                Mint 1M
              </Button>
            </div>
          </section>
          {err ? <p className="mt-4 text-sm text-down">{err}</p> : null}
        </main>
        <ConfirmSheet confirm={pending} onClose={() => setPending(null)} />
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