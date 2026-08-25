import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Shell } from "@/components/shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/plan")({ component: PlanPage });

const TABS = ["Briefing", "Week 1", "Q1", "Notes", "Team", "Roadmap", "Quant", "Business", "Protocol", "Legal"] as const;
type Tab = (typeof TABS)[number];

function PlanPage() {
  const [tab, setTab] = useState<Tab>("Briefing");
  return (
    <Shell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-subtle">Internal · Nick, CEO</p>
        <h1 className="mt-2 text-2xl font-medium">WolfPit operating plan</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Simulation desk is live. Week 1 work order is under Plan → Week 1. Build log under Notes.
        </p>
        <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-11 px-3 text-sm",
                tab === t ? "border-b border-accent text-fg" : "text-muted",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <article className="prose-wp mt-8 space-y-4 text-sm leading-relaxed text-muted">
          {tab === "Briefing" && <Briefing />}
          {tab === "Week 1" && <Week1 />}
          {tab === "Q1" && <Q1 />}
          {tab === "Notes" && <Notes />}
          {tab === "Team" && <Team />}
          {tab === "Roadmap" && <Roadmap />}
          {tab === "Quant" && <Quant />}
          {tab === "Business" && <Business />}
          {tab === "Protocol" && <Protocol />}
          {tab === "Legal" && <Legal />}
        </article>
      </main>
    </Shell>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="pt-2 text-base font-medium text-fg">{children}</h2>;
}

function Briefing() {
  return (
    <>
      <p className="text-fg">
        Nick — WolfPit is a term-market derivatives pit on crypto: mini futures and mini options with expiry,
        inventory-backed market making, and Uniswap-style pools. This app is the paper desk. It is not a
        mainnet money vault.
      </p>
      <H>What is live now</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Thinkorswim-style desk: chart, ticket, chain, blotter, vault inventory.</li>
        <li>Spot on ETH-USDC, WOLFPIT-USDC-TEST, WOLFPIT-ETH-TEST.</li>
        <li>Mini futures (0.1 ETH, 4× IM, Friday/month expiry). Hedge 1:1. Size = free inventory × 40%.</li>
        <li>Mini options: you buy; vault sells covered calls / cash-secured puts only. European cash settle.</li>
        <li>LP + WPIT farm + staking at 12% simulated APR.</li>
        <li>Paper account $100,000 USDC. Clock 1× / 10× / 60× to watch expiry.</li>
      </ul>
      <H>What we will not do this week</H>
      <p>
        We will not deploy a funded vault on Ethereum L1. Gas is hedge error. v1 home is Base. The desk
        already talks to named test pools; swapping the adapter is a later PR, not a product rewrite.
      </p>
      <H>Your next 10 moves</H>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Form the entity (Delaware C-corp or equivalent) and a Cayman/BVI protocol foundation split.</li>
        <li>Retain derivatives counsel (CFTC + securities). Do not tweet “yield” until they bless copy.</li>
        <li>Open a GitHub org. This workspace’s docs/ is the first commit.</li>
        <li>Hire CTO and Head of Quant before anyone else. Spec is in Team.</li>
        <li>Raise a small seed against this sim + the business plan — not against TVL promises.</li>
        <li>Stand up Foundry repo, testnet deploy, then (optional) unfunded TEST ERC-20s on a cheap L2.</li>
        <li>Quant: calibrate IV, inventory bands, liquidation keepers on this desk’s tick log.</li>
        <li>Frontend: keep this layout; replace the zustand engine with a chain adapter behind one interface.</li>
        <li>Audit, bug bounty, then a single ETH-USDC vault with tiny caps.</li>
        <li>Only then flip the desk from SIM to LIVE. Same screens.</li>
      </ol>
    </>
  );
}

function Week1() {
  return (
    <>
      <p className="text-fg">25–31 Aug 2026. Full tickets: docs/WEEK1.md. Log: docs/BUILD-NOTES.md.</p>
      <H>Done when</H>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Every RISK.md v1 limit is in engine.ts (or Q-signed wontfix).</li>
        <li>Five drills recorded and green.</li>
        <li>Foundry vault skeleton: α=0.40, covered call, cash-secured put. forge test green.</li>
        <li>Desk blanks a dead side and prints the reject string.</li>
        <li>Friday demo: +40% still covered, −20% liquidates, LP is not a piggy bank.</li>
      </ol>
      <H>Do not start</H>
      <p>Uni v4 hook. Base Sepolia. Hyperliquid. User-sold options. Ethereum L1. Raising α.</p>
      <H>Tickets</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>W1-00 Spec lock — N</li>
        <li>W1-01 DeskEngine + golden tests — P+Q</li>
        <li>W1-02 Remaining RISK limits — Q (Γ, ν, OI, fill band, circuit, 0.5 vol-pt, 1% insurance halt)</li>
        <li>W1-03 Five drills — Q</li>
        <li>W1-04 Tick-log export — U</li>
        <li>W1-05 Foundry skeleton — P</li>
        <li>W1-06 Insurance / harvest tax — P+Q</li>
        <li>W1-07 Blank quotes + reject on ticket — U</li>
        <li>W1-08 Gauge display 70/20/10 — U</li>
        <li>W1-09 VITE_CHAIN banner — U</li>
        <li>W1-10 Daily build notes — all</li>
        <li>W1-11 Copy / legal — L+N</li>
        <li>W1-12 Friday demo — all</li>
      </ul>
      <H>Calendar</H>
      <p>Tue kickoff. Wed limits + Foundry + blank quotes. Thu drills 1–3 + vault math. Fri drills 4–5 + demo. Mon close. Red Friday extends week 1; it does not start v4.</p>
      <p className="text-fg">Closed 25 Aug. See Q1 for Sep–Nov.</p>
    </>
  );
}

function Q1() {
  return (
    <>
      <p className="text-fg">1 Sep – 30 Nov 2026. Full tickets: docs/Q1.md. ~1,650h. Unfunded Sepolia only.</p>
      <H>Done on 30 Nov when</H>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Vault + ERC-1155 minis + keepers on Base Sepolia.</li>
        <li>Uni v4 hook: depth to vault, cover never concentrated, cannot go naked.</li>
        <li>Same desk, VITE_CHAIN=base-sepolia. Default remains sim.</li>
        <li>D1–D5 + 20% gap replayed on Sepolia, keepers delayed 2 min.</li>
        <li>Audit #1 in flight. Audit #2 RFP sent. Bounty drafted.</li>
        <li>Geo stub. No US leveraged flow. No funded vault. No L1.</li>
      </ol>
      <H>Seats</H>
      <p>Sep: P, Q, U, L. 22 Sep: +P2, P3. 13 Oct: +S. 3 Nov: +I if events exist. No DevRel.</p>
      <H>Months</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Sep — CI, D4 netting, 1155, hook spec, adapter, geo stub.</li>
        <li>Oct — hook, keepers, oracles, audit pack, blotter on chain.</li>
        <li>Nov — public Sepolia TEST, gap drill, staging URL, freeze. Buffer 24–30 Nov is slip only.</li>
      </ul>
      <H>Nick’s demos</H>
      <p>Sep: D4 + naked 1155 revert. Oct: covered call and mini long on Sepolia, keeper liq. Nov: +40%/−20% on Sepolia, pause, audit status. No α control.</p>
      <H>Do not start</H>
      <p>Funded vault. Hyperliquid. User-sold options. TGE. Ethereum L1. Raising α.</p>
    </>
  );
}

function Notes() {
  return (
    <>
      <p className="text-fg">Append-only. Newest first. Full file: docs/BUILD-NOTES.md.</p>
      <H>2026-08-25 (Tue) — Week 1 closed</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Done: G1–G6, RISK caps, D1–D5, Foundry vault, tape export, blank quotes, gauges, VITE_CHAIN, harvest tax.</li>
        <li>Tape: engine 22/22, forge 8/8. Still sim. Ready for nick-kuhle/WolfPit + new PAT.</li>
        <li>Nick initials: pending on docs/BUILD-NOTES.md.</li>
      </ul>
      <H>2026-08-25 (Tue) — kickoff</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Done: specs locked. Week 1 order written. Desk already paper + Base + insurance + Δ/Γ.</li>
        <li>Blocked: P/Q/U/L seats may be empty. Tickets stay on the role.</li>
        <li>
          Tape: α=0.40 in spec. Engine still missing Γ/ν/OI/circuit caps (W1-02). Drills unrecorded
          (W1-03). No Foundry (W1-05).
        </li>
        <li>Nick initials: pending in the markdown log.</li>
      </ul>
      <H>Ritual</H>
      <p>Every day: Done / Blocked / Tape. Do not rewrite history. Do not deploy from a red tape line.</p>
    </>
  );
}

function Team() {
  return (
    <>
      <p>Start with five people. Scale after testnet volume is real.</p>
      <H>Core (hire now)</H>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <span className="text-fg">CEO — Nick.</span> Capital, counsel, BD, does not write risk params.
        </li>
        <li>
          <span className="text-fg">CTO / protocol.</span> Solidity + appchain decision, adapter layer, never
          lets governance vote IV.
        </li>
        <li>
          <span className="text-fg">Head of quant / MM.</span> Inventory engine, BS/SABR, liquidation math,
          owns the util cap. This person is the product.
        </li>
        <li>
          <span className="text-fg">Trading UI lead.</span> This desk. Latency, order ticket, chain, mobile.
        </li>
        <li>
          <span className="text-fg">GC / CFTC specialist (fractional OK).</span> Product gating, geo, token.
        </li>
      </ul>
      <H>Next wave</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Two protocol engineers (keepers, oracles, vaults).</li>
        <li>Security engineer + audit liaison.</li>
        <li>Indexer / subgraph.</li>
        <li>Designer who has shipped a trading UI.</li>
        <li>DevRel. Community after there is a testnet to farm, not before.</li>
      </ul>
      <H>Duties that must not blur</H>
      <p>
        Quant sets bands. CTO implements bands. CEO does not override a utilization cap in a bull tape.
        Legal can halt a listing. Nobody can list a naked call.
      </p>
    </>
  );
}

function Roadmap() {
  return (
    <>
      <H>P0 — shipped</H>
      <p>Paper desk. Inventory visible. Clock acceleration.</p>
      <H>P1 — v1.0 sim (now)</H>
      <p>Base decision. RV→IV, put skew, util-weighted farm, insurance, Δ/Γ, 4× IM, α=40%.</p>
      <H>P2 — contracts</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Foundry on Base Sepolia. Uni v4 hook + vault + ERC-1155.</li>
        <li>DeskEngine viem adapter. Same symbols.</li>
      </ul>
      <H>P3 — live</H>
      <p>One ETH-USDC vault on Base, tiny caps, 4×, insurance floor. Not Ethereum L1.</p>
      <H>P4</H>
      <p>Hyperliquid ETH perp as hedge rung 2. More underlyings after a boring Friday.</p>
    </>
  );
}

function Quant() {
  return (
    <>
      <p className="text-fg">
        v1.0 is paper with surgical limits. Full math is in docs/CHAIN, LP, FARM, MM, RISK on GitHub.
      </p>
      <H>Chain</H>
      <p>
        Home: <span className="text-fg">Base</span>. Uniswap v4 + canonical USDC + sub-cent keepers. Ethereum
        L1 is disqualified (gas is hedge error). Hyperliquid is the 2026 perp champion — HIP-3 is still
        perps. We may hedge there later. We do not list there in v1.
      </p>
      <H>LP</H>
      <p>
        Spot pools (ETH/USDC, WPIT pairs) are not the pit. The dealer vault is. Cover is full inventory,
        never a concentrated Uni range. Utilization α = 40%. Reject if the fill would break reserved ETH/USDC.
      </p>
      <H>Farm</H>
      <p>
        Pay quoting capital. Gauges: vault 70 / WPIT-USDC 20 / WPIT-ETH 10. ETH-USDC spot unfarmed. 10% of
        emissions → insurance. veWPIT boosts vault only, cap 2.5×. Staked WPIT is first-loss junior.
      </p>
      <H>MM</H>
      <p>
        Dealer, not vAMM. IV_atm = 1.08 × EWMA RV. Smile: OTM puts richer. Spread = 8 + 80·util + 40·(IV−0.40)
        + 25·|Δ|/ETH. No quote if the hedge cannot complete. Hedge error ≈ ½ Γ (ΔS)².
      </p>
      <H>Risk</H>
      <p>
        4× IM / 12.5% MM, isolated. Naked call impossible (lock ETH). Naked put impossible (lock K×size USDC).
        |Γ| cash 1h ≤ 2% NAV. Insurance seed $25k sim. Five recorded drills before live: −20% 1h, +40% (must
        not nuke), witching, mismatched entries, util cap reject.
      </p>
    </>
  );
}

function Business() {
  return (
    <>
      <H>Wedge</H>
      <p>
        Hyperliquid owns perps. Derive owns listed options with a permissioned underlying set. Panoptic owns
        perpetual options on Uni LPs. WolfPit owns dated vanilla that lists when a pool is funded, never
        naked, CME-style expiry. That hole is still empty as of August 2026.
      </p>
      <H>Model</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Spot 5–30 bps. Derivatives 0.5–3 bps + spread the vault keeps.</li>
        <li>Liquidation penalty → insurance fund.</li>
        <li>WPIT: fee discount, stake as first-loss, governance over circuit breakers only.</li>
        <li>No sub-5-second funding casino. Term structure is the product.</li>
      </ul>
      <H>Seed ask (illustrative)</H>
      <p>
        $4–8M. 18 months. 55% protocol + audit, 20% quant/infra, 15% go-to-market, 10% legal/runway. Raise on
        the sim, the spec, and the team — not on a TVL multiple.
      </p>
      <H>PE / later capital</H>
      <p>
        Private equity cares about take-rate, risk of ruin, and regulation. Show: (1) zero insolvency in sim
        stress, (2) audit letters, (3) a venue theory the CFTC can classify, (4) LP P&L that is vol
        harvesting not directional. Do not sell a token narrative as the business.
      </p>
    </>
  );
}

function Protocol() {
  return (
    <>
      <H>Hard rules (encoded in this desk)</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Net trader-long futures ≤ free ETH × utilization cap (45%).</li>
        <li>Net trader-short futures ≤ free USDC / spot × cap.</li>
        <li>Every call the vault sells locks ETH. Every put locks strike × size USDC.</li>
        <li>Hedges are 1:1. The house is not levered. Traders may be (v1: 5× IM).</li>
        <li>Mismatched entries on a flat book are paid from crystallized spot hedge P&L, never printed.</li>
        <li>If the hedge cannot complete, the order does not exist.</li>
      </ul>
      <H>Adapter target</H>
      <p className="font-mono text-xs text-fg">
        DeskEngine {"{"} quote, spotSwap, openFuture, closeFuture, buyOption, settle, addLiquidity {"}"}
      </p>
      <p>
        Today: in-memory GBM + AMM. Next: viem on TEST. Then: same methods, LIVE addresses. Frontend never
        imports a vault address except through env.
      </p>
    </>
  );
}

function Legal() {
  return (
    <>
      <p>
        Dated ETH futures and options are CFTC-territory products in the US. This simulation is not an offer
        of those products. Do not take US leveraged flow until counsel structures the venue (offshore
        protocol + geo-blocked UI, or a registered DCM/SEF path).
      </p>
      <p>
        WPIT is not registered. Do not market it as an investment contract. Utility: fees, stake, backstop.
        Emissions after legal memo.
      </p>
      <p>
        Mainnet TEST tokens: still public, still immutable, still a phishing surface. Prefer Base testnet
        until the adapter is proven. Kill-switch pauses listings — not a silent mint.
      </p>
      <p>
        ToS stub (sim): this software is a paper desk. It does not custody assets. It is not an exchange,
        DCM, SEF, or broker. Do not describe emissions as yield or risk-free. US persons: no leveraged
        product until counsel says so.
      </p>
    </>
  );
}
