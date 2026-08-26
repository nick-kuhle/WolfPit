import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { EntryBoard, FairProof, OddsTape, RaceTrack } from "@/components/desk/race-track";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { YieldNav } from "@/components/yield-nav";
import { Button } from "@/components/ui/button";
import { MIN_BET, cardFor, fracOdds, openTickets, type RaceCard } from "@/lib/wolfpit/games";
import { useWolf } from "@/lib/wolfpit/store";
import { cn, fmtQty } from "@/lib/utils";

export const Route = createFileRoute("/games")({ component: GamesPage });

const STAKES = [50, 100, 250, 500, 1000];

function GamesPage() {
  const [now, setNow] = useState(() => Date.now());
  const games = useWolf((s) => s.games);
  const seedRaces = useWolf((s) => s.seedRaces);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 120);
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
        <div className="relative overflow-hidden border-b border-brass/40 bg-brass text-bg">
          <img src="/brand/races/paddock-horse.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-35" />
          <div className="relative mx-auto max-w-3xl px-4 py-5 sm:py-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-bg/80">Farm / Racetrack</p>
            <h1 className="mt-1 font-display text-3xl font-medium tracking-tight sm:text-5xl">
              A card a minute. <span className="italic">Prizes in WPIT.</span>
            </h1>
            <p className="mt-2 max-w-md text-sm text-bg/85">
              Entry, then they break. Vault {fmtQty(vault)} WPIT. Odds are the book. The dash is only for show. Winner is hashed before the gates.
            </p>
            <YieldNav on="track" />
          </div>
        </div>
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
  const s = useWolf();
  const bet = useWolf((st) => st.placeRaceBet);
  const [pick, setPick] = useState<number | null>(null);
  const [stake, setStake] = useState("100");
  const [review, setReview] = useState(false);
  const runner = card.runners.find((r) => r.no === pick) ?? null;
  const n = Number(stake) || 0;
  const left = Math.max(0, card.postAt - now);
  const wpit = s.account.wpit;
  const vault = s.games?.vaultWpit ?? 0;
  const blocked = !runner || card.status !== "open" || n < MIN_BET || n > wpit + 1e-9;

  useEffect(() => {
    setPick(null);
    setReview(false);
  }, [card.id]);

  function send() {
    if (!runner || blocked) return;
    bet(card.kind, runner.no, n);
    setReview(false);
  }

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
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">Show vol · nobody runs backward · the wire is already hashed</p>
      ) : null}
      {card.status === "official" ? (
        <p className="mt-3 rounded-md bg-brass/15 px-3 py-2 font-display text-lg text-brass">
          Prize to #{card.winner} {card.runners.find((r) => r.no === card.winner)?.name} · {fracOdds(card.runners.find((r) => r.no === card.winner)?.odds ?? 0)}
        </p>
      ) : null}
      <FairProof card={card} />
      <div className="mt-3 flex flex-wrap gap-1">
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
            {x} WPIT
          </button>
        ))}
        <input className="h-9 w-24 rounded-full border border-border bg-elevated px-3 font-mono text-[11px]" value={stake} onChange={(e) => setStake(e.target.value)} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>Wallet {fmtQty(wpit)} WPIT</span>
        <span>Prize vault {fmtQty(vault)} WPIT</span>
      </div>
      <Button className="mt-3 h-12 w-full bg-brass text-bg" disabled={blocked} onClick={() => setReview(true)}>
        {runner ? `Review ${n} WPIT on ${runner.name}` : "Pick a runner"}
      </Button>
      {review && runner ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 p-3 pb-[calc(3.6rem+env(safe-area-inset-bottom))] sm:items-center">
          <div className="sheet-in w-full max-w-md overflow-hidden rounded-[1.1rem] border border-brass/40 bg-panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-brass">Confirm ticket</p>
            <h3 className="mt-1 font-display text-2xl">
              {n} WPIT · {runner.name}
            </h3>
            <dl className="mt-3 space-y-1 font-mono text-[12px]">
              <Row k="Odds" v={`${fracOdds(runner.odds)}  (${runner.odds.toFixed(2)})`} />
              <Row k="Stake" v={`${fmtQty(n)} WPIT`} />
              <Row k="Prize if it hits" v={`${fmtQty(n * runner.odds)} WPIT`} />
              <Row k="WPIT after entry" v={fmtQty(wpit - n)} />
              <Row k="Commit" v={card.commit ? card.commit.slice(0, 16) : "sealing"} />
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12" onClick={() => setReview(false)}>
                Edit
              </Button>
              <Button className="h-12 bg-brass text-bg" onClick={send}>
                Confirm bet
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
            <div className="font-mono text-[10px] uppercase tracking-wider text-brass">Open · {b.kind}</div>
            <div className="font-display text-xl">
              #{b.runner} {b.name}
            </div>
            <div className="font-mono text-[12px] text-muted">
              {fmtQty(b.stake)} WPIT @ {fracOdds(b.odds)} · prize {fmtQty(b.stake * b.odds)}
            </div>
          </article>
        ))}
        {recent.map((b) => (
          <article key={b.id} className={cn("rounded-[var(--radius-lg)] border p-3", b.status === "won" ? "border-up/40 bg-up/10" : "border-border bg-panel")}>
            <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              {b.status} · {b.kind}
            </div>
            <div className="font-display text-xl">
              #{b.runner} {b.name}
            </div>
            <div className="font-mono text-[12px] text-muted">
              {fmtQty(b.stake)} WPIT @ {fracOdds(b.odds)}
              {b.status === "won" ? ` · prize ${fmtQty(b.payout)}` : ""}
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
