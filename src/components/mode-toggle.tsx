import { cn } from "@/lib/utils";
import { MODE_COPY, type Mode } from "@/lib/wolfpit/mode-config";
import { useMode } from "@/lib/wolfpit/mode";

/**
 * The sim / testnet / live selector. Lives in the app shell, so it appears on
 * every page that renders `Shell` — which is every page.
 *
 * It shows ALL three modes, always. An earlier version hid modes whose
 * contracts were not configured; with no Sepolia deployment that collapsed the
 * list to a single entry and the toggle rendered nothing at all, anywhere. A
 * mode that is not ready is now shown and marked, so the map is visible and
 * the reason is legible.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { mode, setMode, statuses } = useMode();
  return (
    <div
      role="tablist"
      aria-label="Trading mode"
      className={cn("flex items-center gap-0.5 rounded-full border border-border bg-elevated p-0.5", className)}
    >
      {statuses.map(({ mode: m, ready, reason }) => (
        <button
          key={m}
          role="tab"
          type="button"
          aria-selected={mode === m}
          aria-disabled={!ready}
          disabled={!ready}
          title={ready ? undefined : reason}
          onClick={() => ready && setMode(m)}
          className={cn(
            "h-7 rounded-full px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
            !ready && "cursor-not-allowed text-subtle opacity-45",
            ready && mode === m && toneClass(m),
            ready && mode !== m && "text-muted hover:text-fg",
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
 * One-line statement of what the current mode actually trades, so no page can
 * imply real funds while pointed at test tokens (or vice versa).
 */
export function ModeBanner() {
  const { mode, copy } = useMode();
  if (mode === "sim") return null; // the sim banner already says this
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border-b px-3 py-1.5 text-center",
        mode === "live" ? "border-warn/40 bg-warn/10" : "border-brass/40 bg-brass/10",
      )}
    >
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.22em]",
          mode === "live" ? "text-warn" : "text-brass",
        )}
      >
        {copy.banner}
      </span>
    </div>
  );
}
