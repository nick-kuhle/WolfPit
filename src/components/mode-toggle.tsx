import { cn } from "@/lib/utils";
import { MODE_COPY, type Mode } from "@/lib/wolfpit/mode-config";
import { useMode } from "@/lib/wolfpit/mode";

/**
 * The sim / testnet / live selector. Lives in the app shell, so it is on every
 * page and always reads the same state — previously it existed only on
 * `/trade` and nothing else in the app knew which mode you were in.
 *
 * Renders nothing when a deployment offers only one mode (a one-tab switch is
 * noise), so a mainnet-only build is unaffected by the testnet work.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { mode, setMode, available } = useMode();
  if (available.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="Trading mode"
      className={cn("flex items-center gap-0.5 rounded-full border border-border bg-elevated p-0.5", className)}
    >
      {available.map((m) => (
        <button
          key={m}
          role="tab"
          type="button"
          aria-selected={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            "h-7 rounded-full px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
            mode === m ? toneClass(m) : "text-muted hover:text-fg",
          )}
        >
          {MODE_COPY[m].tab}
        </button>
      ))}
    </div>
  );
}

/** Selected-tab colour per mode. Live is the loud one, deliberately. */
function toneClass(m: Mode) {
  if (m === "live") return "bg-warn text-bg";
  if (m === "testnet") return "bg-brass text-bg";
  return "bg-fg/90 text-bg";
}

/**
 * One-line statement of what the current mode actually trades. Shown under the
 * header so no page can imply real funds while pointed at test tokens.
 */
export function ModeBanner() {
  const { mode, copy, available } = useMode();
  if (available.length < 2 && mode === "sim") return null;
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border-b px-3 py-1.5 text-center",
        mode === "live" && "border-warn/40 bg-warn/10",
        mode === "testnet" && "border-brass/40 bg-brass/10",
        mode === "sim" && "border-border bg-surface",
      )}
    >
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.22em]",
          mode === "live" ? "text-warn" : mode === "testnet" ? "text-brass" : "text-muted",
        )}
      >
        {copy.banner}
      </span>
    </div>
  );
}
