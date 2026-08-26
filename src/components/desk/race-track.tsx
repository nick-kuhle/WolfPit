import { RunnerGfx } from "@/components/desk/runner-gfx";
import { fieldAt, fracOdds, shortHash, type RaceCard, type Runner } from "@/lib/wolfpit/games";
import { cn, fmtQty } from "@/lib/utils";

export function RaceTrack({ card, now, compact }: { card: RaceCard; now: number; compact?: boolean }) {
  const field = fieldAt(card, now);
  const t = Math.min(1, Math.max(0, (now - card.postAt) / Math.max(1, card.settleAt - card.postAt)));
  const live = [...field].sort((a, b) => b.x - a.x);
  const pack = live.reduce((a, r) => a + r.x, 0) / Math.max(live.length, 1);
  const cam = card.status === "open" ? 0 : card.status === "official" ? 1 : pack;
  const bg = card.kind === "horse" ? "/brand/races/track-horse.jpg" : "/brand/races/track-dog.jpg";
  const gait = card.status === "running" ? "run" : card.status === "open" ? "idle" : "off";
  const sprite = compact ? 26 : 32;
  const startPct = (0 - cam) * 90 + 8;
  const finishPct = (1 - cam) * 90 + 8;

  return (
    <div className="min-w-0">
      <div
        className={cn(
          "relative overflow-hidden rounded-[var(--radius-lg)] border border-[#5a4030]",
          compact ? "h-40 sm:h-48" : "h-44 sm:h-60",
        )}
      >
        <div className="track-world absolute inset-0">
          <div className="track-loop" style={{ transform: `translateX(${-cam * 50}%)` }}>
            <img src={bg} alt="" />
            <img src={bg} alt="" />
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-bg/75 via-bg/10 to-transparent" />
        <Pole pct={startPct} label="Start" className="bg-[repeating-linear-gradient(180deg,#f4f0e6_0_8px,#1a1a1a_8px_16px)]" />
        <Pole pct={finishPct} label="Finish" className="bg-[repeating-linear-gradient(45deg,#0b0c0b_0_6px,#f0c14b_6px_12px)]" />
        <div className="absolute inset-x-1 bottom-1 top-6 sm:inset-x-2">
          {live.map((r, i) => {
            const place = i + 1;
            const rel = (r.x - cam) * 0.9 + 0.1;
            return (
              <div key={r.no} className="absolute left-0 right-0" style={{ top: `${(i / Math.max(live.length - 1, 1)) * 74}%` }}>
                <div
                  className="absolute top-0 flex items-center gap-1"
                  style={{ left: `calc(${Math.min(0.92, Math.max(-0.08, rel)) * 100}% - ${Math.min(0.92, Math.max(0, rel)) * sprite * 1.5}px)` }}
                >
                  <PlaceMark place={place} />
                  <RunnerGfx kind={card.kind} coat={r.coat} no={r.no} size={sprite} gait={gait} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="absolute left-1.5 top-1.5 rounded bg-bg/75 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-brass">
          {card.status === "official" ? "Official" : card.status === "running" ? `Live ${Math.round(t * 100)}%` : "Gate"}
        </div>
      </div>
      <ol className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {live.map((r, i) => {
          const place = i + 1;
          return (
            <li key={r.no} className="flex min-w-0 items-center gap-1">
              <PlaceMark place={place} />
              <span className="grid size-4 shrink-0 place-items-center rounded-[3px] font-mono text-[9px] font-bold text-bg" style={{ background: r.silk }}>
                {r.no}
              </span>
              <span className="min-w-0 truncate text-[11px] leading-tight">{r.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-brass">{fracOdds(r.odds)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Pole({ pct, label, className }: { pct: number; label: string; className: string }) {
  if (pct < -8 || pct > 108) return null;
  return (
    <div className="pointer-events-none absolute inset-y-2 z-[1]" style={{ left: `${pct}%` }}>
      <div className={cn("h-full w-1.5 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.45)]", className)} />
      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-bg/80 px-1 font-mono text-[8px] uppercase tracking-wider text-brass">
        {label}
      </span>
    </div>
  );
}

function PlaceMark({ place }: { place: number }) {
  if (place <= 3) return <Trophy place={place as 1 | 2 | 3} />;
  return (
    <span className="grid size-4 shrink-0 place-items-center font-mono text-[9px] tabular-nums text-subtle">{place}</span>
  );
}

function Trophy({ place }: { place: 1 | 2 | 3 }) {
  const fill = place === 1 ? "#e3b341" : place === 2 ? "#c5c8ce" : "#c67b3a";
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-label={`${place}`} role="img">
      <path
        fill={fill}
        d="M3.2 2.2h9.6v1.4h1.4c0 2.1-1.5 3.4-3.2 3.7-.5 1-1.4 1.7-2.6 1.9v1.6h2.2v1.4H5.4V10.8h2.2V9.2C6.4 9 5.5 8.3 5 7.3 3.3 7 1.8 5.7 1.8 3.6h1.4V2.2zm1.4 1.4v1.1c0 .9.6 1.6 1.4 2 .3-1.1.8-1.9 1.4-2.4H4.6zm6.8 0H8.8c.6.5 1.1 1.3 1.4 2.4.8-.4 1.4-1.1 1.4-2V3.6z"
      />
    </svg>
  );
}

export function EntryBoard({
  card,
  picked,
  onPick,
}: {
  card: RaceCard;
  now?: number;
  picked: number | null;
  onPick: (no: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="flex items-center justify-between border-b border-border bg-elevated px-2.5 py-1.5">
        <p className="font-display text-lg text-brass">Entry</p>
        <p className="font-mono text-[9px] uppercase tracking-wider text-subtle">Tap a runner</p>
      </div>
      <div className="grid grid-cols-2 gap-1 p-1.5">
        {card.runners.map((r) => (
          <EntryCard key={r.no} kind={card.kind} r={r} official={card.status === "official"} winner={card.winner} on={picked === r.no} locked={card.status !== "open"} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function EntryCard({
  kind,
  r,
  official,
  winner,
  on,
  locked,
  onPick,
}: {
  kind: "horse" | "dog";
  r: Runner;
  official: boolean;
  winner: number;
  on: boolean;
  locked: boolean;
  onPick: (n: number) => void;
}) {
  const win = official && winner === r.no;
  return (
    <button
      type="button"
      disabled={locked && !on}
      onClick={() => onPick(r.no)}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left",
        on ? "border-brass bg-brass/10" : "border-border",
        win && "border-up bg-up/10",
      )}
    >
      <RunnerGfx kind={kind} coat={r.coat} no={r.no} size={28} gait="idle" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-sm leading-tight">{r.name}</div>
        <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
          <span className="text-brass">
            {fracOdds(r.odds)} · {r.odds.toFixed(2)}
          </span>
          <span className="text-subtle">+{fmtQty(100 * r.odds)}</span>
        </div>
      </div>
    </button>
  );
}

export function OddsTape({ card }: { card: RaceCard; now?: number }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]">
      {card.runners.map((r) => (
        <div key={r.no} className="flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5">
          <span className="grid size-4 place-items-center rounded-sm font-mono text-[8px] font-bold text-bg" style={{ background: r.silk }}>
            {r.no}
          </span>
          <span className="max-w-[7rem] truncate font-mono text-[10px]">
            {r.name} <span className="text-brass">{fracOdds(r.odds)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function FairProof({ card }: { card: RaceCard }) {
  const open = card.status !== "official";
  return (
    <div className="mt-2 rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-muted">
      <div className="uppercase tracking-wider text-brass">Provably fair</div>
      <div className="truncate">Commit {card.commit ? shortHash(card.commit, 16) : "sealing…"}</div>
      {open ? (
        <div>Seed sealed until official.</div>
      ) : (
        <div className="truncate">
          Seed {card.seed ? shortHash(card.seed, 16) : "—"} · #{card.winner}
        </div>
      )}
    </div>
  );
}
