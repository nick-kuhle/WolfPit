import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import {
  SWAP_FEE_BPS,
  SWAP_FEE_BPS_DISCOUNTED,
  SWAP_SLIPPAGE_BPS,
  WPIT_LIVE,
  bpsToPct,
} from "@/lib/swap/config";

export const Route = createFileRoute("/info")({ component: InfoPage });

function InfoPage() {
  return (
    <Shell>
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Protocol · fees & info</p>
        <h1 className="mt-2 font-display text-4xl font-medium tracking-tight sm:text-5xl">
          Everything the pit charges, in one place.
        </h1>
        <p className="mt-4 max-w-2xl text-muted">
          WolfPit is a non-custodial trading venue on Base. At launch, spot trading is live and
          routes through a DEX aggregator for best execution. Betting, futures, and options are built
          and audited but stay switched off until they are turned on. Every fee below is shown to you
          before you sign a transaction — no hidden spread beyond what you approve.
        </p>

        {/* FEES */}
        <Section title="Trading fees">
          <FeeTable />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            The trading fee is collected <strong className="text-fg">on-chain in the same
            transaction</strong> as your swap and sent directly to WolfPit. It is separate from
            network gas (paid to Base validators) and from the DEX liquidity provider fee that is
            already baked into the aggregator's quoted price. Your quote always shows the exact fee,
            the minimum you will receive after slippage, and the route taken.
          </p>
        </Section>

        {/* WPIT DISCOUNT */}
        <Section title="The WPIT discount">
          <p className="text-sm leading-relaxed text-muted">
            Hold WPIT in your wallet and your trading fee is automatically cut by{" "}
            <strong className="text-fg">50%</strong> — from {bpsToPct(SWAP_FEE_BPS)} to{" "}
            {bpsToPct(SWAP_FEE_BPS_DISCOUNTED)}. You do not stake, lock, or spend the WPIT; simply
            holding a balance qualifies the connected wallet, checked at quote time.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {WPIT_LIVE ? (
              <>The discount is <strong className="text-up">active</strong>. Any WPIT balance qualifies.</>
            ) : (
              <>
                WPIT lists <strong className="text-fg">after the protocol launches</strong>. Until
                then the token does not exist on-chain, so every wallet pays the standard{" "}
                {bpsToPct(SWAP_FEE_BPS)}. The discount turns on automatically the moment WPIT is
                live — no app update required.
              </>
            )}
          </p>
        </Section>

        {/* HOW ROUTING WORKS */}
        <Section title="How your order is routed">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>You enter a market order (amount in, token out).</li>
            <li>
              WolfPit queries a DEX aggregator that scans Base liquidity venues (Uniswap, Aerodrome,
              and others) plus professional market-maker quotes.
            </li>
            <li>
              It returns the route that gives you the most output after gas and price impact — the
              cheapest, fastest, safest fill available at that moment.
            </li>
            <li>
              You see the expected output, the guaranteed minimum after {bpsToPct(SWAP_SLIPPAGE_BPS)}{" "}
              default slippage, the WolfPit fee, and the venues used — then you sign. Funds move
              directly from your wallet; WolfPit never takes custody.
            </li>
          </ol>
        </Section>

        {/* WHAT'S LIVE */}
        <Section title="What's live, and what's next">
          <div className="overflow-hidden rounded-xl border border-border">
            <StatusRow product="Spot swaps" status="live" note="Aggregator-routed on Base. ETH · WETH · USDC." />
            <StatusRow
              product="Betting (The Ranch)"
              status="soon"
              note="Built. Turns on after launch."
            />
            <StatusRow
              product="Mini futures"
              status="gated"
              note="Contracts deployed. Unlock when the WETH/USDC pit pool has liquidity."
            />
            <StatusRow
              product="Options"
              status="gated"
              note="Contracts deployed. Unlock alongside futures once liquidity is seeded."
            />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            All contracts are deployed at launch. Futures and options are launch-gated, not missing —
            they open only once a new pool has liquidity added. See the{" "}
            <Link to="/plan" className="text-brass hover:underline">
              roadmap
            </Link>{" "}
            for sequencing.
          </p>
        </Section>

        {/* NON-CUSTODIAL / RISK */}
        <Section title="Custody, safety & risk">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              <strong className="text-fg">Non-custodial.</strong> Your keys, your funds. Swaps
              execute from your own wallet; WolfPit never holds your assets.
            </li>
            <li>
              <strong className="text-fg">Approvals.</strong> Selling an ERC-20 (e.g. USDC) needs a
              one-time token approval before the first swap. Native ETH needs none.
            </li>
            <li>
              <strong className="text-fg">Slippage protection.</strong> Every swap enforces a minimum
              received; if the market moves past it, the transaction reverts and you keep your funds
              (minus gas).
            </li>
            <li>
              <strong className="text-fg">Not investment advice.</strong> Trading is risky. See the{" "}
              <Link to="/terms" className="text-brass hover:underline">
                Terms of Use
              </Link>
              .
            </li>
          </ul>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/swap"
            className="pressable inline-flex h-11 items-center rounded-[var(--radius-sm)] bg-brass px-5 text-sm font-medium text-bg"
          >
            Go to spot
          </Link>
          <Link
            to="/learn"
            className="pressable inline-flex h-11 items-center rounded-[var(--radius-sm)] border border-border px-5 text-sm text-fg"
          >
            Pit school
          </Link>
        </div>
      </main>
      <SiteFooter />
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function FeeTable() {
  const rows: { label: string; standard: string; wpit: string }[] = [
    {
      label: "Spot market swap",
      standard: bpsToPct(SWAP_FEE_BPS),
      wpit: bpsToPct(SWAP_FEE_BPS_DISCOUNTED),
    },
    { label: "Network gas", standard: "Paid to Base", wpit: "Paid to Base" },
    { label: "DEX liquidity fee", standard: "In quoted price", wpit: "In quoted price" },
    { label: "Deposits / withdrawals", standard: "None", wpit: "None" },
    { label: "Betting", standard: "Not yet live", wpit: "Not yet live" },
    { label: "Futures / options", standard: "Gated (no liquidity)", wpit: "Gated (no liquidity)" },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-elevated px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-subtle">
        <span>Item</span>
        <span className="text-right">Standard</span>
        <span className="text-right">With WPIT</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`grid grid-cols-[1.4fr_1fr_1fr] items-center px-4 py-2.5 text-sm ${
            i % 2 ? "bg-surface/40" : ""
          }`}
        >
          <span className="text-fg">{r.label}</span>
          <span className="text-right font-mono tabular-nums text-muted">{r.standard}</span>
          <span className="text-right font-mono tabular-nums text-up">{r.wpit}</span>
        </div>
      ))}
    </div>
  );
}

function StatusRow({
  product,
  status,
  note,
}: {
  product: string;
  status: "live" | "soon" | "gated";
  note: string;
}) {
  const badge =
    status === "live"
      ? { text: "Live", cls: "border-up text-up" }
      : status === "soon"
        ? { text: "Coming soon", cls: "border-brass text-brass" }
        : { text: "Gated", cls: "border-border text-muted" };
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span
        className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${badge.cls} border`}
      >
        {badge.text}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{product}</div>
        <div className="text-[12px] text-muted">{note}</div>
      </div>
    </div>
  );
}
