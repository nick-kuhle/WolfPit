import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared review-then-confirm sheet — the same look as the trade ticket's
 * review panel (kicker · title · detail rows · brass Confirm). Used for
 * liquidity add/remove, pool creation, harvest, and staking so every
 * state-changing action on the floor gets the identical confirmation UX.
 *
 * Success notifications for the same actions use the confetti "pit ticket"
 * burst (pit-alerts.tsx) — see store.ts pings.
 */
export type ConfirmRow = { k: string; v: string; tone?: "up" | "down" | "brass" };

export type Confirm = {
  kicker: string;
  title: string;
  sub?: string;
  rows: ConfirmRow[];
  note?: ReactNode;
  confirmLabel: string;
  confirmTone?: "default" | "up" | "down";
  run: () => void;
};

export function ConfirmSheet({
  confirm,
  onClose,
}: {
  confirm: Confirm | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, onClose]);

  if (!confirm) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/70 p-4 pb-[calc(3.6rem+env(safe-area-inset-bottom))] sm:items-center">
      <div className="sheet-in flex max-h-[min(88dvh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-[1.1rem] border border-brass/40 bg-panel shadow-2xl">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">{confirm.kicker}</p>
          <h3 className="mt-1 font-display text-2xl leading-tight">{confirm.title}</h3>
          {confirm.sub ? <p className="mt-1 font-mono text-[11px] text-muted">{confirm.sub}</p> : null}
        </div>
        <dl className="min-h-0 flex-1 space-y-0 overflow-auto px-4 py-2 font-mono text-[12px]">
          {confirm.rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-subtle">{r.k}</dt>
              <dd
                className={
                  "text-right tabular-nums " +
                  (r.tone === "up" ? "text-up" : r.tone === "down" ? "text-down" : r.tone === "brass" ? "text-brass" : "text-fg")
                }
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>
        {confirm.note ? <p className="px-4 pb-2 text-[11px] text-muted">{confirm.note}</p> : null}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border p-3">
          <Button variant="outline" className="h-12" onClick={onClose}>
            Back
          </Button>
          <Button
            className="h-12"
            variant={confirm.confirmTone === "up" ? "up" : confirm.confirmTone === "down" ? "down" : "default"}
            onClick={() => {
              confirm.run();
              onClose();
            }}
          >
            {confirm.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
