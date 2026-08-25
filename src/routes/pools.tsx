import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { lpValue, tokenBal, utilEth } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/pools")({ component: PoolsPage });

function PoolsPage() {
  const s = useWolf();
  const add = useWolf((st) => st.lpAdd);
  const remove = useWolf((st) => st.lpRemove);
  const create = useWolf((st) => st.createPool);
  const issue = useWolf((st) => st.issueToken);
  const harvest = useWolf((st) => st.harvest);
  const err = useWolf((st) => st.lastError);
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
  const u = utilEth(s);

  return (
    <Shell>
      <ProductGate product="farms">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-brass">Farms · AMM · simulated APY</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Yield you can actually press.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Constant-product pools. Pick two tokens, both legs. New pair creates the pool. ETH mark is live; pool
          price is its own curve.
        </p>

        <section className="mt-6 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-medium">Add / create</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TokenPick label="Token A" value={base} tokens={tokens} onChange={setBase} />
            <TokenPick label="Token B" value={quote} tokens={tokens} onChange={setQuote} />
            <label className="text-xs">
              {base} amount
              <input
                className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
                value={baseAmt}
                onChange={(e) => setBaseAmt(e.target.value)}
              />
              <span className="mt-1 block text-muted">Wallet {fmtAmt(tokenBal(s.account, base))}</span>
            </label>
            <label className="text-xs">
              {quote} amount
              <input
                className="mt-1 h-11 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono"
                value={quoteAmt}
                onChange={(e) => setQuoteAmt(e.target.value)}
              />
              <span className="mt-1 block text-muted">Wallet {fmtAmt(tokenBal(s.account, quote))}</span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {exists ? (
              <Button onClick={() => add(pair, Number(quoteAmt) || 0)}>Add liquidity</Button>
            ) : (
              <Button onClick={() => create(base, quote, Number(baseAmt) || 0, Number(quoteAmt) || 0)}>
                Create pool
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">{exists ? `${pair} · add both legs at the pool price` : `New pair ${pair}`}</p>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-xs font-medium">Issue paper token</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="h-11 flex-1 rounded-[var(--radius-sm)] border border-border bg-elevated px-3 font-mono uppercase"
                placeholder="TICKER"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button variant="outline" onClick={() => issue(custom, 1_000_000)}>
                Mint 1M paper
              </Button>
            </div>
          </div>
        </section>

        <ul className="mt-6 grid gap-2 font-mono text-xs text-muted sm:grid-cols-3">
          <li className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">
            Vault 70%
            <div className="mt-1 text-fg">util {(0.3 + 0.7 * u).toFixed(2)}×</div>
          </li>
          <li className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">WPIT-USDC 20%</li>
          <li className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3">WPIT-ETH 10%</li>
        </ul>

        <div className="mt-6 grid gap-3">
          {ids.map((id) => {
            const p = s.pools[id]!;
            const tvl = p.quoteReserve * quotePx(s, p.quote) + p.baseReserve * quotePx(s, p.base);
            const mine = s.lp.find((x) => x.poolId === id);
            return (
              <article key={id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-sm">{id}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {p.base}/{p.quote} · fee {p.feeBps / 100}% · mid{" "}
                      {(p.quoteReserve / p.baseReserve).toPrecision(6)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-subtle">TVL</div>
                    <div className="font-mono tabular-nums">{fmtUsd(tvl)}</div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" disabled={!mine} onClick={() => mine && remove(id, mine.shares)}>
                    Remove all
                  </Button>
                  <Link to="/trade" className="text-sm text-muted hover:text-fg">
                    Trade
                  </Link>
                </div>
                <p className="mt-2 text-xs text-muted">Your LP {mine ? fmtUsd(lpValue(s, id, mine.shares)) : "$0.00"}</p>
              </article>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-subtle">WPIT farm</div>
            <div className="font-mono text-lg tabular-nums">{s.farmWpit.toFixed(2)} WPIT</div>
            <p className="mt-1 text-xs text-muted">Harvest tax 1% → insurance ({tax.toFixed(2)} WPIT)</p>
          </div>
          <Button variant="outline" disabled={s.farmWpit <= 0} onClick={harvest}>
            Harvest
          </Button>
        </div>
        {err ? <p className="mt-4 text-sm text-down">{err}</p> : null}
      </main>
      <SiteFooter />
      </ProductGate>
    </Shell>
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

function quotePx(s: { eth: number; wpit: number }, sym: string) {
  if (sym === "USDC") return 1;
  if (sym === "ETH") return s.eth;
  if (sym === "WPIT") return s.wpit;
  return 0;
}

function fmtAmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(6);
}
