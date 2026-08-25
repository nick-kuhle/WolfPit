import { useAlerts } from "@/lib/wolfpit/alerts";
import { cn } from "@/lib/utils";

export function PitAlerts() {
  const items = useAlerts((s) => s.items);
  const dismiss = useAlerts((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-14 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-16 sm:w-80">
      {items.map((a) => (
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
  );
}
