import { fieldAt, flashOdds, fracOdds, type RaceCard, type Runner } from "@/lib/wolfpit/games";
import { cn, fmtQty } from "@/lib/utils";

export function RaceTrack({ card, now, compact }: { card: RaceCard; now: number; compact?: boolean }) {
  const field = fieldAt(card, now);
  const running = card.status === "running";
  const official = card.status === "official";
  const t = Math.min(1, Math.max(0, (now - card.postAt) / (card.settleAt - card.postAt)));
  const bg = card.kind === "horse" ? "/brand/races/track-horse.jpg" : "/brand/races/track-dog.jpg";
  const h = compact ? 10 : 14;

  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-lg)] border border-[#5a4030]", compact ? "h-40" : "h-56 sm:h-72")}>
      <img src={bg} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg/80 via-bg/20 to-transparent" />
      <div className="absolute inset-y-3 right-[7%] z-[1] w-1 rounded-full bg-brass shadow-[0_0_18px_#f0c14b]" />
      <div className="absolute inset-x-2 bottom-2 top-6">
        {field.map((r, i) => (
          <div key={r.no} className="absolute left-0 right-8" style={{ top: `${(i / Math.max(field.length - 1, 1)) * 72}%` }}>
            <div
              className="absolute top-0 flex items-end gap-1 transition-[left] duration-100 ease-linear"
              style={{ left: `${(running || official ? r.x : 0.02) * 100}%` }}
            >
              <img
                src={r.sprite}
                alt=""
                className={cn("object-cover object-center drop-shadow-lg", compact ? "h-8 w-12" : "h-11 w-[4.2rem] sm:h-14 sm:w-20")}
                style={{ height: compact ? 32 : h * 4 }}
              />
              <span
                className="grid size-6 place-items-center rounded-sm text-[11px] font-bold text-bg shadow"
                style={{ background: r.silk }}
              >
                {r.no}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="absolute left-2 top-2 rounded bg-bg/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brass">
        {official ? "Official" : running ? `LIVE · ${Math.round(t * 100)}% · VOL HIGH` : "At the gate"}
      </div>
    </div>
  );
}

export function EntryBoard({
  card,
  now,
  picked,
  onPick,
}: {
  card: RaceCard;
  now: number;
  picked: number | null;
  onPick: (no: number) => void;
}) {
  const paddock = card.kind === "horse" ? "/brand/races/paddock-horse.jpg" : "/brand/races/paddock-dog.jpg";
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="relative h-28 sm:h-36">
        <img src={paddock} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/50 to-transparent" />
        <p className="absolute bottom-2 left-3 font-display text-2xl text-brass">Entry</p>
        <p className="absolute bottom-3 right-3 font-mono text-[10px] uppercase tracking-wider text-brass">Odds live · high vol</p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
        {card.runners.map((r) => (
          <EntryCard key={r.no} r={r} now={now} official={card.status === "official"} winner={card.winner} on={picked === r.no} locked={card.status !== "open"} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function EntryCard({
  r,
  now,
  official,
  winner,
  on,
  locked,
  onPick,
}: {
  r: Runner;
  now: number;
  official: boolean;
  winner: number;
  on: boolean;
  locked: boolean;
  onPick: (n: number) => void;
}) {
  const live = flashOdds(r.odds, now, r.no);
  const up = live >= r.odds;
  const prize = 100 * (locked ? r.odds : live);
  const win = official && winner === r.no;
  return (
    <button
      type="button"
      disabled={locked && !on}
      onClick={() => onPick(r.no)}
      className={cn(
        "overflow-hidden rounded-md border text-left",
        on ? "border-brass ring-1 ring-brass" : "border-border",
        win && "border-up ring-1 ring-up",
      )}
    >
      <div className="relative h-24">
        <img src={r.portrait} alt="" className="size-full object-cover" />
        <span className="absolute left-1 top-1 grid size-6 place-items-center rounded-sm text-[11px] font-bold text-bg" style={{ background: r.silk }}>
          {r.no}
        </span>
        <span className="absolute inset-x-0 bottom-0 bg-bg/75 px-1.5 py-0.5 font-display text-sm leading-tight">{r.name}</span>
      </div>
      <div className="px-1.5 py-1.5">
        <div className="font-mono text-[9px] uppercase tracking-wider text-subtle">{r.barn}</div>
        <div className="truncate text-[11px] text-muted">{r.trainer}</div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className={cn("font-mono text-sm tabular-nums", up ? "text-up" : "text-down")}>
            {fracOdds(live)} <span className="text-[10px]">{live.toFixed(2)}</span>
          </span>
          <span className="font-mono text-[10px] text-brass">Prize {fmtQty(prize)}</span>
        </div>
      </div>
    </button>
  );
}

export function OddsTape({ card, now }: { card: RaceCard; now: number }) {
  return (
    <div className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
      {card.runners.map((r) => {
        const live = flashOdds(r.odds, now, r.no);
        return (
          <div key={r.no} className="shrink-0 rounded-full border border-border px-2 py-1 font-mono text-[10px]">
            <span style={{ color: r.silk }}>#{r.no}</span> {r.name}{" "}
            <span className={live >= r.odds ? "text-up" : "text-down"}>{fracOdds(live)}</span>
          </div>
        );
      })}
    </div>
  );
}
