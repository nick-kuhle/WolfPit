import { useWolf, useEquity } from "@/lib/wolfpit/store";
import { bookGreeks, exportTape } from "@/lib/wolfpit/engine";
import { fmtPct, fmtUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AccountBar() {
  const eq = useEquity();
  const start = useWolf((s) => s.account.startEquity);
  const usdc = useWolf((s) => s.account.usdc);
  const realized = useWolf((s) => s.account.realized);
  const clock = useWolf((s) => s.clock);
  const speed = useWolf((s) => s.simSpeed);
  const setSpeed = useWolf((s) => s.setSpeed);
  const reset = useWolf((s) => s.reset);
  const pnl = eq - start;
  const up = pnl >= 0;
  return (
    <div className="flex flex-nowrap items-center gap-x-3 overflow-x-auto border-b border-border bg-panel px-3 py-1.5 text-xs sm:gap-x-5">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">Net liq</div>
        <div className="font-mono tabular-nums text-sm text-fg">{fmtUsd(eq)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">Open P&L</div>
        <div className={`font-mono tabular-nums text-sm ${up ? "text-up" : "text-down"}`}>
          {up ? "+" : "−"}
          {fmtUsd(Math.abs(pnl))} ({fmtPct(pnl / start)})
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">Cash USDC</div>
        <div className="font-mono tabular-nums text-sm">{fmtUsd(usdc)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">Realized</div>
        <div className={`font-mono tabular-nums text-sm ${realized >= 0 ? "text-up" : "text-down"}`}>
          {fmtUsd(realized)}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">Clock</div>
        <div className="font-mono tabular-nums text-sm">{new Date(clock).toISOString().slice(11, 19)}</div>
      </div>
      <div className="ml-auto hidden items-center gap-2 sm:flex">
        <span className="text-[10px] uppercase tracking-wider text-subtle">Speed</span>
        {([1, 10, 60] as const).map((n) => (
          <Button key={n} size="sm" variant={speed === n ? "default" : "outline"} onClick={() => setSpeed(n)}>
            {n}×
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="hidden sm:inline-flex"
          onClick={() => {
            const s = useWolf.getState();
            const blob = new Blob([JSON.stringify({ ...exportTape(s), greeks: bookGreeks(s) }, null, 2)], {
              type: "application/json",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `wolfpit-tape-${s.clock}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Export tape
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Reset paper
        </Button>
      </div>
    </div>
  );
}
