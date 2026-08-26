import { RunnerGfx } from "@/components/desk/runner-gfx";
import { fieldAt, fracOdds, shortHash, type RaceCard, type Runner } from "@/lib/wolfpit/games";
import { cn, fmtQty } from "@/lib/utils";

export function RaceTrack({ card, now, compact }: { card: RaceCard; now: number; compact?: boolean }) {
  const field = fieldAt(card, now);
  const t = Math.min(1, Math.max(0, (now - card.postAt) / Math.max(1, card.settleAt - card.postAt)));
  const bg = card.kind === "horse" ? "/brand/races/track-horse.jpg" : "/brand/races/track-dog.jpg";
  const moving = card.status !== "open";

  return (
    <div>
      <div className={cn("relative overflow-hidden rounded-[var(--radius-lg)] border border-[#5a4030]", compact ? "h-44" : "h-64 sm:h-80")}>
        <img src={bg} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg/85 via-bg/25 to-transparent" />
        <div className="absolute inset-y-4 right-[8%] z-[1] w-1.5 rounded-full bg-brass shadow-[0_0_18px_#f0c14b]" />
        <div className="absolute inset-x-2 bottom-2 top-7">
          {field.map((r, i) => (
            <div key={r.no} className="absolute left-0 right-10" style={{ top: `${(i / Math.max(field.length - 1, 1)) * 78}%` }}>
              <div className="absolute top-0" style={{ left: `${(moving ? r.x : 0.02) * 100}%` }}>
                <RunnerGfx kind={card.kind} coat={r.coat} no={r.no} size={compact ? 28 : 40} />
              </div>
            </div>
          ))}
        </div>
        <div className="absolute left-2 top-2 rounded bg-bg/75 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brass">
          {card.status === "official" ? "Official" : card.status === "running" ? `Show vol · ${Math.round(t * 100)}%` : "At the gate"}
        </div>
      </div>
      <div className={cn("mt-2 grid gap-1", card.kind === "horse" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
        {card.runners.map((r) => (
          <div key={r.no} className="flex items-center gap-1.5 rounded-md border border-border bg-elevated px-1.5 py-1">
            <RunnerGfx kind={card.kind} coat={r.coat} no={r.no} size={22} />
            <div className="min-w-0">
              <div className="truncate font-display text-[13px] leading-tight">{r.name}</div>
              <div className="font-mono text-[10px] text-brass">
                {fracOdds(r.odds)} · {r.odds.toFixed(2)}
              </div>
            </div>
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
  const paddock = card.kind === "horse" ? "/brand/races/paddock-horse.jpg" : "/brand/races/paddock-dog.jpg";
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="relative h-24 sm:h-32">
        <img src={paddock} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/55 to-transparent" />
        <p className="absolute bottom-2 left-3 font-display text-2xl text-brass">Entry</p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
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
        "rounded-md border px-2 py-2 text-left",
        on ? "border-brass ring-1 ring-brass" : "border-border",
        win && "border-up ring-1 ring-up",
      )}
    >
      <div className="flex items-center gap-2">
        <RunnerGfx kind={kind} coat={r.coat} no={r.no} size={44} />
        <div className="min-w-0">
          <div className="truncate font-display text-base leading-tight">{r.name}</div>
          <div className="font-mono text-[11px] text-brass">
            {fracOdds(r.odds)} · {r.odds.toFixed(2)}
          </div>
          <div className="truncate font-mono text-[9px] text-subtle">Prize {fmtQty(100 * r.odds)} /100</div>
        </div>
      </div>
    </button>
  );
}

export function OddsTape({ card }: { card: RaceCard; now?: number }) {
  return (
    <div className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
      {card.runners.map((r) => (
        <div key={r.no} className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1">
          <RunnerGfx kind={card.kind} coat={r.coat} no={r.no} size={18} />
          <span className="font-mono text-[10px]">
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
    <div className="mt-2 rounded-md border border-border bg-elevated px-3 py-2 font-mono text-[10px] leading-relaxed text-muted">
      <div className="uppercase tracking-wider text-brass">Provably fair</div>
      <div>Commit {card.commit ? shortHash(card.commit, 16) : "sealing…"}</div>
      {open ? (
        <div>Seed sealed until official. sha256(seed) must match commit.</div>
      ) : (
        <>
          <div>Seed {card.seed ? shortHash(card.seed, 16) : "—"}</div>
          <div>
            Winner #{card.winner} · sha256(seed) = commit · sha256(seed:id:winner) → horse
          </div>
        </>
      )}
    </div>
  );
}
