import type { CSSProperties } from "react";
import { useAlerts, type AlertTone, type PitAlert } from "@/lib/wolfpit/alerts";
import { cn } from "@/lib/utils";

const LABELS = ["FILL", "BET", "TICKET", "WPIT", "SLIP", "PAID", "PIT", "LONG", "CONF", "BOOK", "YES", "OUT", "MINI", "SPOT", "CALL", "PUT", "WIN", "ASK"];

export function PitAlerts() {
  const items = useAlerts((s) => s.items);
  const dismiss = useAlerts((s) => s.dismiss);
  const burst = items.find((a) => a.burst);
  const quiet = items.filter((a) => !a.burst);
  return (
    <>
      {burst ? <FillBurst a={burst} onDismiss={() => dismiss(burst.id)} /> : null}
      {quiet.length ? (
        <div className="pointer-events-none fixed inset-x-3 top-14 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-16 sm:w-80">
          {quiet.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => dismiss(a.id)}
              className={cn(
                "pointer-events-auto rounded-[var(--radius-md)] border bg-panel/95 px-3 py-2.5 text-left text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur",
                a.tone === "up" && "border-up/40",
                a.tone === "down" && "border-down/40",
                a.tone === "brass" && "border-brass/40",
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-brass">Pit</div>
              <div className="mt-0.5 leading-snug">{a.msg}</div>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function FillBurst({ a, onDismiss }: { a: PitAlert; onDismiss: () => void }) {
  const bits = spray(a.id, a.tone);
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center">
      <button type="button" className="fill-dim pointer-events-auto absolute inset-0 bg-bg/60" aria-label="Dismiss" onClick={onDismiss} />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {bits.map((b, i) =>
          b.kind === "slip" ? (
            <span
              key={i}
              className={cn(
                "confetti-spray absolute left-1/2 top-1/2 whitespace-nowrap rounded-[5px] border bg-panel px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider shadow-md sm:text-[11px]",
                b.cls,
              )}
              style={b.style}
            >
              {b.label}
            </span>
          ) : (
            <span key={i} className={cn("confetti-spray absolute left-1/2 top-1/2 rounded-[1px]", b.cls)} style={b.style} />
          ),
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          "alert-grow pointer-events-auto relative z-[1] w-[min(92vw,28rem)] rounded-[1.15rem] border-2 bg-panel px-6 py-7 text-left shadow-[0_18px_60px_rgba(0,0,0,0.45)]",
          a.tone === "up" && "border-up",
          a.tone === "down" && "border-down",
          a.tone === "brass" && "border-brass",
        )}
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">
          {a.msg.startsWith("Won") ? "Winner · pit ticket" : "Fill · pit ticket"}
        </div>
        <div className="mt-2 font-display text-[1.85rem] leading-tight sm:text-[2.15rem]">{a.msg}</div>
        <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-subtle">Tap to clear</div>
      </button>
    </div>
  );
}

type Bit = {
  kind: "slip" | "bit";
  label: string;
  cls: string;
  style: CSSProperties;
};

function spray(id: string, tone: AlertTone): Bit[] {
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const toneCls = tone === "up" ? "border-up/80 text-up" : tone === "down" ? "border-down/80 text-down" : "border-brass text-brass";
  const paper = ["bg-brass", "bg-up", "bg-down", "bg-fg", "bg-warn"];
  const out: Bit[] = [];
  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * Math.PI * 2 + ((seed + i * 17) % 13) * 0.07;
    const dist = 22 + ((i * 5 + seed) % 28);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.78;
    const rot = ((i % 2 ? 1 : -1) * (16 + (i % 13) * 9) + (seed % 20)) % 180;
    const delay = (i % 16) * 22;
    const dur = 1.05 + (i % 6) * 0.12;
    if (i % 5 !== 1) {
      out.push({
        kind: "slip",
        label: LABELS[(i + seed) % LABELS.length]!,
        cls: toneCls,
        style: {
          "--dx": `${dx}vw`,
          "--dy": `${dy}vh`,
          "--rot": `${rot}deg`,
          animationDelay: `${delay}ms`,
          animationDuration: `${dur}s`,
        } as CSSProperties,
      });
    } else {
      const w = 6 + (i % 4) * 3;
      const h = 10 + (i % 3) * 4;
      out.push({
        kind: "bit",
        label: "",
        cls: paper[i % paper.length]!,
        style: {
          width: w,
          height: h,
          "--dx": `${dx * 1.15}vw`,
          "--dy": `${dy * 1.15}vh`,
          "--rot": `${rot * 2}deg`,
          animationDelay: `${delay + 30}ms`,
          animationDuration: `${dur + 0.2}s`,
        } as CSSProperties,
      });
    }
  }
  return out;
}
