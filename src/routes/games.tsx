import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { EntryBoard, FairProof, OddsTape, RaceTrack } from "@/components/desk/race-track";
import { RunnerGfx } from "@/components/desk/runner-gfx";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { RanchHero } from "@/components/yield-nav";
import { Button } from "@/components/ui/button";
import {
  MARKET_HINT,
  MIN_BET,
  cardFor,
  fracOdds,
  marketOdds,
  openTickets,
  ticketName,
  type RaceCard,
} from "@/lib/wolfpit/games";
import { useWolf } from "@/lib/wolfpit/store";
import type { BetMarket } from "@/lib/wolfpit/types";
import { cn, fmtQty } from "@/lib/utils";

export const Route = createFileRoute("/games")({ component: GamesPage });

const STAKES = [50, 100, 250, 500, 1000];
const MARKETS: BetMarket[] = ["win", "place", "show", "quinella", "exacta"];

function GamesPage() {
  const [now, setNow] = useState(() => Date.now());
  const games = useWolf((s) => s.games);
  const seedRaces = useWolf((s) => s.seedRaces);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(t);
  }, []);
  const sec = Math.floor(now / 1000);
  useEffect(() => {
    seedRaces();
  }, [sec, seedRaces]);
  const horse = useMemo(() => cardFor("horse", now, games), [now, games]);
  const dog = useMemo(() => cardFor("dog", now, games), [now, games]);
  const vault = games?.vaultWpit ?? 0;

  return (
    <Shell>
      <ProductGate product="track">
        <RanchHero
          on="track"
          image="/brand/races/track-horse.jpg"
          kicker="The Ranch · Racetrack"
          title={
            <>
              A race every minute. <span className="italic text-brass">Walk the paddock.</span>
            </>
          }
          sub={`Tap a runner. Win, place, show, quinella, exacta. Vault ${fmtQty(vault)} WPIT. Horses and dogs, two minutes apart.`}
        />
        <main className="mx-auto grid max-w-5xl gap-5 px-3 py-4 lg:grid-cols-2 sm:px-4">
          <Meet card={horse} now={now} />
          <Meet card={dog} now={now} />
        </main>
        <Tickets />
      </ProductGate>
    </Shell>
  );
}

function Meet({ card, now }: { card: RaceCard; now: number }) {
  const [pick, setPick] = useState<number | null>(null);
  const left = Math.max(0, card.postAt - now);

  useEffect(() => {
    setPick(null);
  }, [card.id]);

  return (
    <section className="min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-panel p-2.5 sm:p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass">
            {card.kind === "horse" ? "Thoroughbreds" : "Greyhounds"} · {card.id}
          </p>
          <h2 className="font-display text-2xl">{card.status === "open" ? "Entry" : card.status === "running" ? "They're off" : "Official"}</h2>
        </div>
        <Clock card={card} now={now} left={left} />
      </div>
      <OddsTape card={card} />
      <div className="mt-2">
        {card.status === "open" ? <EntryBoard card={card} picked={pick} onPick={setPick} /> : <RaceTrack card={card} now={now} />}
      </div>
      {card.status === "running" ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">Always moving · hashed wire</p>
      ) : null}
      {card.status === "official" ? (
        <p className="mt-3 rounded-md bg-brass/15 px-3 py-2 font-display text-lg text-brass">
          Prize to #{card.winner} {card.runners.find((r) => r.no === card.winner)?.name} · {fracOdds(card.runners.find((r) => r.no === card.winner)?.odds ?? 0)}
        </p>
      ) : null}
      <FairProof card={card} />
      {pick && card.status === "open" ? <TicketSheet card={card} pick={pick} onClose={() => setPick(null)} /> : null}
    </section>
  );
}

function TicketSheet({ card, pick, onClose }: { card: RaceCard; pick: number; onClose: () => void }) {
  const bet = useWolf((st) => st.placeRaceBet);
  const wpit = useWolf((s) => s.account.wpit);
  const vault = useWolf((s) => s.games?.vaultWpit ?? 0);
  const runner = card.runners.find((r) => r.no === pick)!;
  const [market, setMarket] = useState<BetMarket>("win");
  const [pair, setPair] = useState<number | null>(null);
  const [stake, setStake] = useState("100");
  const [confirm, setConfirm] = useState(false);
  const n = Number(stake) || 0;
  const needsPair = market === "quinella" || market === "exacta";
  const odds = marketOdds(card, market, pick, pair ?? undefined);
  const maxPay = n * odds;
  const maxLoss = n;
  const ready = n >= MIN_BET && n <= wpit + 1e-9 && (!needsPair || (pair && pair !== pick));

  useEffect(() => {
    setPair(null);
    setConfirm(false);
    setMarket("win");
  }, [pick]);

  function send() {
    if (!ready) return;
    bet(card.kind, pick, n, market, pair ?? undefined);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 p-3 pb-[calc(3.6rem+env(safe-area-inset-bottom))] sm:items-center">
      <div className="sheet-in max-h-[min(88dvh,40rem)] w-full max-w-md overflow-auto rounded-[1.1rem] border border-brass/40 bg-panel p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <RunnerGfx kind={card.kind} coat={runner.coat} no={runner.no} size={36} gait="idle" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-brass">Ticket</p>
              <h3 className="font-display text-2xl leading-tight">{runner.name}</h3>
              <p className="font-mono text-[11px] text-muted">Win {fracOdds(runner.odds)}</p>
            </div>
          </div>
          <button type="button" className="h-9 px-2 font-mono text-[11px] text-muted" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-subtle">Market</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {MARKETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMarket(m);
                setConfirm(false);
              }}
              className={cn(
                "h-9 rounded-full border px-3 font-mono text-[11px] uppercase",
                market === m ? "border-brass bg-brass text-bg" : "border-border text-muted",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted">{MARKET_HINT[market]}</p>

        {needsPair ? (
          <div className="mt-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {market === "exacta" ? "2nd" : "With"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {card.runners
                .filter((r) => r.no !== pick)
                .map((r) => (
                  <button
                    key={r.no}
                    type="button"
                    onClick={() => setPair(r.no)}
                    className={cn(
                      "h-8 rounded-full border px-2.5 font-mono text-[10px]",
                      pair === r.no ? "border-brass bg-brass text-bg" : "border-border text-muted",
                    )}
                  >
                    #{r.no} {r.name}
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-subtle">Stake</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {STAKES.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setStake(String(x))}
              className={cn(
                "h-9 rounded-full border px-3 font-mono text-[11px]",
                Number(stake) === x ? "border-brass bg-brass text-bg" : "border-border text-muted",
              )}
            >
              {x}
            </button>
          ))}
          <input
            className="h-9 w-24 rounded-full border border-border bg-elevated px-3 font-mono text-[11px]"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </div>

        <dl className="mt-3 space-y-0 font-mono text-[12px]">
          <Row k="Selection" v={ticketName(card, market, pick, pair ?? undefined)} />
          <Row k="Odds" v={`${fracOdds(odds)}  (${odds.toFixed(2)})`} />
          <Row k="Max payout" v={`${fmtQty(maxPay)} WPIT`} />
          <Row k="Max loss" v={`${fmtQty(maxLoss)} WPIT`} />
          <Row k="Wallet after" v={fmtQty(Math.max(0, wpit - n))} />
          <Row k="Vault" v={`${fmtQty(vault)} WPIT`} />
        </dl>

        {!confirm ? (
          <Button className="mt-4 h-12 w-full bg-brass text-bg" disabled={!ready} onClick={() => setConfirm(true)}>
            {ready ? "Review ticket" : needsPair && !pair ? "Pick the other runner" : "Set a stake"}
          </Button>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12" onClick={() => setConfirm(false)}>
              Edit
            </Button>
            <Button className="h-12 bg-brass text-bg" onClick={send}>
              Confirm bet
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Clock({ card, now, left }: { card: RaceCard; now: number; left: number }) {
  const ms = card.status === "open" ? left : card.status === "running" ? Math.max(0, card.settleAt - now) : Math.max(0, card.nextAt - now);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const label = card.status === "open" ? "To post" : card.status === "running" ? "To wire" : "Next";
  return (
    <div className="text-right">
      <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className="font-display text-2xl tabular-nums leading-none">
        {m}:{String(s % 60).padStart(2, "0")}
      </div>
    </div>
  );
}

function Tickets() {
  const s = useWolf();
  const open = openTickets(s);
  const recent = (s.games?.bets ?? []).filter((b) => b.status !== "open").slice(0, 8);
  if (!open.length && !recent.length) return null;
  return (
    <section className="mx-auto max-w-5xl px-4 pb-10">
      <h2 className="font-display text-2xl">Your tickets</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {open.map((b) => (
          <article key={b.id} className="rounded-[var(--radius-lg)] border border-brass/40 bg-elevated p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-brass">
              Open · {b.market ?? "win"} · {b.kind}
            </div>
            <div className="font-display text-xl">{b.name}</div>
            <div className="font-mono text-[12px] text-muted">
              {fmtQty(b.stake)} WPIT @ {fracOdds(b.odds)} · max {fmtQty(b.stake * b.odds)}
            </div>
          </article>
        ))}
        {recent.map((b) => (
          <article key={b.id} className={cn("rounded-[var(--radius-lg)] border p-3", b.status === "won" ? "border-up/40 bg-up/10" : "border-border bg-panel")}>
            <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {b.status} · {b.market ?? "win"} · {b.kind}
            </div>
            <div className="font-display text-xl">{b.name}</div>
            <div className="font-mono text-[12px] text-muted">
              {fmtQty(b.stake)} WPIT @ {fracOdds(b.odds)}
              {b.status === "won" ? ` · prize ${fmtQty(b.payout)}` : ` · lost ${fmtQty(b.stake)}`}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5">
      <dt className="text-subtle">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
