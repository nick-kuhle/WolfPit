import type { CSSProperties } from "react";
import { useAlerts, type PitAlert } from "@/lib/wolfpit/alerts";
import { cn } from "@/lib/utils";

export function PitAlerts() {
  const items = useAlerts((s) => s.items);
  const dismiss = useAlerts((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-14 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-16 sm:w-96">
      {items.map((a) => (
        <AlertCard key={a.id} a={a} onDismiss={() => dismiss(a.id)} />
      ))}
    </div>
  );
}

function AlertCard({ a, onDismiss }: { a: PitAlert; onDismiss: () => void }) {
  return (
    <div className="relative">
      {a.burst ? <SlipBurst tone={a.tone} /> : null}
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          "pointer-events-auto relative z-[1] w-full overflow-hidden rounded-[var(--radius-md)] border bg-panel/95 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur",
          a.burst ? "px-4 py-3.5 ticket-card" : "px-3 py-2.5",
          a.tone === "up" && "border-up/50",
          a.tone === "down" && "border-down/50",
          a.tone === "brass" && "border-brass/50",
          a.burst && "alert-pop",
        )}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass">
          {a.burst ? "Fill · pit ticket" : "Pit"}
        </div>
        <div className={cn("mt-0.5 leading-snug", a.burst && "font-display text-lg")}>{a.msg}</div>
      </button>
    </div>
  );
}

function SlipBurst({ tone }: { tone: PitAlert["tone"] }) {
  const slips = [
    { dx: -120, dy: -90, rot: -28, delay: 0, label: "FILL" },
    { dx: 110, dy: -80, rot: 22, delay: 40, label: "BET" },
    { dx: -40, dy: -130, rot: -8, delay: 70, label: "WPIT" },
    { dx: 90, dy: -40, rot: 16, delay: 90, label: "TICKET" },
    { dx: -140, dy: 20, rot: -34, delay: 50, label: "SLIP" },
    { dx: 130, dy: 30, rot: 30, delay: 110, label: "PAID" },
    { dx: -70, dy: 90, rot: -18, delay: 130, label: "PIT" },
    { dx: 50, dy: 110, rot: 12, delay: 80, label: "LONG" },
    { dx: 20, dy: -150, rot: 4, delay: 20, label: "CONF" },
    { dx: -160, dy: -50, rot: -40, delay: 150, label: "OUT" },
    { dx: 155, dy: -100, rot: 38, delay: 60, label: "YES" },
    { dx: -20, dy: 140, rot: -6, delay: 170, label: "BOOK" },
  ];
  const border = tone === "up" ? "border-up/70 text-up" : tone === "down" ? "border-down/70 text-down" : "border-brass text-brass";
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-0">
      {slips.map((s, i) => (
        <span
          key={i}
          className={cn(
            "slip-fly absolute -left-8 -top-3 whitespace-nowrap rounded-[4px] border bg-panel px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider shadow-md",
            border,
          )}
          style={
            {
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              "--rot": `${s.rot}deg`,
              animationDelay: `${s.delay}ms`,
            } as CSSProperties
          }
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}
