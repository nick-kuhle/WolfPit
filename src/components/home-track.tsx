import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { OddsTape, RaceTrack } from "@/components/desk/race-track";
import { Button } from "@/components/ui/button";
import { flashOdds, fracOdds, makeCard } from "@/lib/wolfpit/games";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtQty } from "@/lib/utils";

export function HomeTrack() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, []);
  const sec = Math.floor(now / 1000);
  const horse = useMemo(() => makeCard("horse", now), [sec]);
  const dog = useMemo(() => makeCard("dog", now), [sec]);
  const vault = useWolf((s) => s.games?.vaultWpit ?? 0);
  const live = horse.status === "running" ? horse : dog.status === "running" ? dog : horse.status === "open" ? horse : dog;

  return (
    <section className="border-b border-brass/40 bg-panel">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">Farm / Racetrack · prizes</p>
            <h2 className="mt-1 font-display text-4xl font-medium sm:text-5xl">
              A race every minute. <span className="italic text-brass">Walk the paddock.</span>
            </h2>
            <p className="mt-2 max-w-lg text-sm text-muted">
              Prize vault {fmtQty(vault)} WPIT. Entry then they're off. Odds thrash. The wire is already written.
            </p>
          </div>
          <Link to="/games">
            <Button className="h-12 bg-brass px-6 text-bg">Open the track</Button>
          </Link>
        </div>
        <div className="mt-5">
          <RaceTrack card={live} now={now} compact />
          <OddsTape card={live} now={now} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <PrizeCard card={horse} now={now} />
          <PrizeCard card={dog} now={now} />
        </div>
      </div>
    </section>
  );
}

function PrizeCard({ card, now }: { card: ReturnType<typeof makeCard>; now: number }) {
  const top = [...card.runners].sort((a, b) => a.odds - b.odds).slice(0, 3);
  return (
    <article className="rounded-[var(--radius-lg)] border border-border bg-elevated p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl">{card.kind === "horse" ? "Horse prizes" : "Dog prizes"}</h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-brass">{card.status}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted">100 WPIT ticket · live board</p>
      <ul className="mt-2 space-y-1">
        {top.map((r) => {
          const live = flashOdds(r.odds, now, r.no);
          return (
            <li key={r.no} className="flex items-center justify-between gap-2 font-mono text-[12px]">
              <span className="truncate">
                #{r.no} {r.name}
              </span>
              <span className="text-brass">
                {fracOdds(live)} · prize {fmtQty(100 * live)} WPIT
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
