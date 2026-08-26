import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OddsTape, RaceTrack } from "@/components/desk/race-track";
import { Button } from "@/components/ui/button";
import { farmApy, poolTvl } from "@/lib/wolfpit/engine";
import { cardFor } from "@/lib/wolfpit/games";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { cn, fmtPct, fmtUsd } from "@/lib/utils";

const SLIDES = 3;

export function FloorDeck() {
  const scroller = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const hold = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const id = window.setInterval(() => {
      if (hold.current) return;
      const next = (Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) + 1) % SLIDES;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, 7000);
    return () => window.clearInterval(id);
  }, []);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  }

  function go(n: number) {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  }

  return (
    <section className="relative border-b border-brass/40 bg-bg">
      <div
        ref={scroller}
        className="floor-deck flex overflow-x-auto"
        onScroll={onScroll}
        onPointerDown={() => {
          hold.current = true;
        }}
        onPointerUp={() => {
          hold.current = false;
        }}
        onPointerCancel={() => {
          hold.current = false;
        }}
      >
        <InfoSlide />
        <RanchSlide />
        <YieldSlide />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-2">
        {[0, 1, 2].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Slide ${n + 1}`}
            className={cn("pointer-events-auto h-2 rounded-full transition-all", i === n ? "w-7 bg-brass" : "w-2 bg-fg/35")}
            onClick={() => go(n)}
          />
        ))}
      </div>
    </section>
  );
}

function Slide({ children, bg, tone }: { children: ReactNode; bg: string; tone?: "dark" | "brass" }) {
  return (
    <article className={cn("floor-slide relative isolate min-h-[32rem] w-full shrink-0 sm:min-h-[36rem]", tone === "brass" && "bg-brass text-bg")}>
      <img src={bg} alt="" decoding="async" className="absolute inset-0 size-full object-cover" />
      <div
        className={cn(
          "absolute inset-0",
          tone === "brass" ? "bg-gradient-to-t from-brass via-brass/80 to-brass/35" : "bg-gradient-to-t from-bg via-bg/70 to-bg/25",
        )}
      />
      <div className="relative mx-auto flex min-h-[32rem] max-w-5xl flex-col justify-end px-4 pb-12 pt-10 sm:min-h-[36rem] sm:px-6 sm:pb-14">
        {children}
      </div>
    </article>
  );
}

function InfoSlide() {
  return (
    <Slide bg="/brand/hero-pit.jpg">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-brass">The Floor · WolfPit</p>
      <h1 className="mt-3 max-w-3xl font-display text-4xl font-medium leading-[0.95] tracking-tight sm:text-6xl">
        The first fully automated
        <span className="italic text-brass"> derivatives AMM.</span>
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
        Smart contracts issue dated calls, puts, and minis on-chain. Every listing is backed by assets locked in the
        vault — never a naked book, never insolvent. LPs earn the spread plus farm emissions. The desk is live tape,
        Greeks, and cover. The Ranch is the after-hours shout.
      </p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {["On-chain vanillas", "Locked collateral", "Autonomous delta hedge", "High LP yields", "Games & data"].map((x) => (
          <li key={x} className="rounded-full border border-brass/40 bg-bg/50 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-brass">
            {x}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/trade">
          <Button className="h-12 px-6">Open the desk</Button>
        </Link>
        <Link to="/learn">
          <Button variant="outline" className="h-12 px-6">
            How it works
          </Button>
        </Link>
      </div>
    </Slide>
  );
}

function RanchSlide() {
  const [now, setNow] = useState(() => Date.now());
  const games = useWolf((s) => s.games);
  const seedRaces = useWolf((s) => s.seedRaces);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    seedRaces();
  }, [Math.floor(now / 1000), seedRaces]);
  const horse = useMemo(() => cardFor("horse", now, games), [now, games]);
  const dog = useMemo(() => cardFor("dog", now, games), [now, games]);
  const live = horse.status === "running" ? horse : dog.status === "running" ? dog : horse.status === "open" ? horse : dog;
  const vault = games?.vaultWpit ?? 0;
  const wpit = useWolf((s) => s.wpit);

  return (
    <Slide bg={live.kind === "horse" ? "/brand/races/track-horse.jpg" : "/brand/races/track-dog.jpg"}>
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-brass">The Floor · The Ranch</p>
      <h2 className="mt-2 font-display text-4xl font-medium leading-[0.95] sm:text-5xl">
        Horses. Dogs. <span className="italic text-brass">A finish every minute.</span>
      </h2>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Classic book. Tickets in WPIT. Prize vault {fmtUsd(vault * wpit)}. More games coming — this is the paddock.
      </p>
      <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-brass/30 bg-bg/70 p-2">
        <RaceTrack card={live} now={now} compact list={false} />
        <OddsTape card={live} />
      </div>
      <div className="mt-5">
        <Link to="/games">
          <Button className="h-12 px-6">Walk the paddock</Button>
        </Link>
      </div>
    </Slide>
  );
}

function YieldSlide() {
  const s = useWolf();
  const farms = [
    { id: "ETH-USDC" as const, name: "ETH / USDC" },
    { id: "WPIT-USDC-TEST" as const, name: "WPIT / USDC" },
    { id: "WPIT-ETH-TEST" as const, name: "WPIT / ETH" },
  ];
  const tvl = farms.reduce((a, p) => a + poolTvl(s, p.id), 0);

  return (
    <Slide bg="/brand/card-farm.jpg" tone="brass">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-bg/70">The Floor · Farms & pools</p>
      <h2 className="mt-2 font-display text-4xl font-medium leading-[0.95] sm:text-5xl">
        Rich APYs. Real TVL. <span className="italic">Park it.</span>
      </h2>
      <p className="mt-3 max-w-xl text-sm text-bg/80">
        LPs take the spread and farm emissions. Junior stake pays {(STAKE_APR * 100).toFixed(0)}% APR. Protocol TVL{" "}
        {fmtUsd(tvl)}. Simulated now — same math we take live.
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {farms.map((p) => (
          <Link key={p.id} to="/pools" className="rounded-[var(--radius-lg)] border border-bg/25 bg-bg/20 p-3">
            <div className="font-mono text-[9px] uppercase tracking-wider text-bg/70">{p.name}</div>
            <div className="mt-1 font-display text-2xl leading-none sm:text-3xl">{fmtPct(farmApy(s, p.id))}</div>
            <div className="mt-1 font-mono text-[10px] text-bg/70">TVL {fmtUsd(poolTvl(s, p.id))}</div>
          </Link>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/pools">
          <Button className="h-12 bg-bg px-6 text-brass hover:bg-bg">Open farms</Button>
        </Link>
        <Link to="/stake">
          <Button variant="outline" className="h-12 border-bg px-6 text-bg hover:bg-bg/10">
            Stake WPIT · {(STAKE_APR * 100).toFixed(0)}%
          </Button>
        </Link>
      </div>
    </Slide>
  );
}
