import { fieldAt, fracOdds, type RaceCard } from "@/lib/wolfpit/games";
import { cn } from "@/lib/utils";

export function RaceTrack({ card, now, compact }: { card: RaceCard; now: number; compact?: boolean }) {
  const field = fieldAt(card, now);
  const running = card.status === "running";
  const official = card.status === "official";
  const t = Math.min(1, Math.max(0, (now - card.postAt) / (card.settleAt - card.postAt)));

  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-lg)] border border-[#4a3824]", compact ? "p-2" : "p-3")}>
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,#3a2a18_0_12px,#43301c_12px_24px)]" />
      <div className="pointer-events-none absolute inset-y-2 right-[8%] w-0.5 bg-brass/80" />
      <div className="relative space-y-1">
        {field.map((r) => (
          <div key={r.no} className="relative h-8">
            <div className="absolute inset-x-0 top-1/2 h-px bg-black/30" />
            <div
              className="absolute top-0 flex h-8 items-center gap-1 transition-[left] duration-150 ease-linear"
              style={{ left: `calc(${(running || official ? r.x : 0.02) * 86}% )` }}
            >
              <span
                className="grid size-7 place-items-center rounded-sm text-[11px] font-bold text-bg shadow"
                style={{ background: r.silk }}
              >
                {r.no}
              </span>
              <span className="text-lg leading-none drop-shadow" aria-hidden>
                {card.kind === "horse" ? "♞" : "▲"}
              </span>
              {!compact ? <span className="hidden font-mono text-[10px] text-[#f6e7b0] sm:inline">{r.name}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="relative mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[#d4c4a0]">
        <span>{card.kind === "horse" ? "1m 2f · dirt" : "480y · lure"}</span>
        <span>
          {official ? "Official" : running ? `Running ${Math.round(t * 100)}%` : "At the gate"}
        </span>
      </div>
    </div>
  );
}

export function OddsBoard({
  card,
  picked,
  onPick,
}: {
  card: RaceCard;
  picked: number | null;
  onPick: (no: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="grid grid-cols-[2rem_1fr_3.4rem_3.2rem] bg-elevated px-2 py-1.5 font-mono text-[9px] uppercase tracking-wider text-subtle">
        <span>#</span>
        <span>Runner</span>
        <span className="text-right">Frac</span>
        <span className="text-right">Dec</span>
      </div>
      {card.runners.map((r) => {
        const on = picked === r.no;
        const win = card.status === "official" && card.winner === r.no;
        return (
          <button
            key={r.no}
            type="button"
            disabled={card.status !== "open"}
            onClick={() => onPick(r.no)}
            className={cn(
              "grid w-full grid-cols-[2rem_1fr_3.4rem_3.2rem] items-center border-t border-border px-2 py-2 text-left",
              on && "bg-brass/15",
              win && "bg-up/15",
              card.status !== "open" && "opacity-80",
            )}
          >
            <span className="grid size-6 place-items-center rounded-sm text-[11px] font-bold text-bg" style={{ background: r.silk }}>
              {r.no}
            </span>
            <span className="truncate font-medium">{r.name}</span>
            <span className="text-right font-mono text-[12px] text-brass">{fracOdds(r.odds)}</span>
            <span className="text-right font-mono text-[12px] tabular-nums">{r.odds.toFixed(2)}</span>
          </button>
        );
      })}
    </div>
  );
}
