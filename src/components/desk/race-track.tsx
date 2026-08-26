import { RunnerGfx } from "@/components/desk/runner-gfx";
import { fieldAt, fracOdds, shortHash, type RaceCard, type Runner } from "@/lib/wolfpit/games";
import { cn, fmtQty } from "@/lib/utils";

export function RaceTrack({ card, now, compact }: { card: RaceCard; now: number; compact?: boolean }) {
  const field = fieldAt(card, now);
  const t = Math.min(1, Math.max(0, (now - card.postAt) / Math.max(1, card.settleAt - card.postAt)));
  const bg = card.kind === "horse" ? "/brand/races/track-horse.jpg" : "/brand/races/track-dog.jpg";
  const moving = card.status !== "open";
  const sprite = compact ? 18 : 22;

  return (
    <div className="min-w-0">
      <div
        className={cn(
          "relative overflow-hidden rounded-[var(--radius-lg)] border border-[#5a4030]",
          compact ? "h-32 sm:h-40" : "h-36 sm:h-52",
        )}
      >
        <img src={bg} alt="" className="absolute inset-0 size-full object-cover object-[center_70%]" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg/80 via-bg/20 to-transparent" />
        <div className="absolute inset-y-3 right-[6%] z-[1] w-1 rounded-full bg-brass shadow-[0_0_12px_#f0c14b]" />
        <div className="absolute inset-x-1 bottom-1 top-6 sm:inset-x-2">
          {field.map((r, i) => (
            <div
              key={r.no}
              className="absolute left-0 right-10 sm:right-12"
              style={{ top: `${(i / Math.max(field.length - 1, 1)) * 78}%` }}
            >
              <div
                className="absolute top-0"
                style={{ left: `${(moving ? r.x : 0.02) * 100}%` }}
              >
                <RunnerGfx kind={card.kind} coat={r.coat} no={r.no} size={sprite} />
              </div>
            </div>
          ))}
        </div>
        <div className="absolute left-1.5 top-1.5 rounded bg-bg/75 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-brass">
          {card.status === "official" ? "Official" : card.status === "running" ? `Live ${Math.round(t * 100)}%` : "Gate"}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {card.runners.map((r) => (
          <div key={r.no} className="flex min-w-0 items-center gap-1">
            <span className="grid size-4 shrink-0 place-items-center rounded-[3px] font-mono text-[9px] font-bold text-bg" style={{ background: r.silk }}>
              {r.no}
            </span>
            <span className="min-w-0 truncate text-[11px] leading-tight">{r.name}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-brass">{fracOdds(r.odds)}</span>
          </div>
        ))}
      </div>
    </div>
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
      <RunnerGfx kind={kind} coat={r.coat} no={r.no} size={28} />
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
