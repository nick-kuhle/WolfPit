import { useDesk } from "@/lib/wolfpit/desk";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx } from "@/lib/utils";

export function LiveTicker() {
  const universe = useDesk((s) => s.universe);
  const s = useWolf();
  const coins = universe.slice(0, 16);
  const items = [
    ...coins.map((c) => ({
      k: c.symbol,
      v: `${fmtPx(c.price)} ${fmtPct(c.change24)}`,
      up: c.change24 >= 0,
    })),
    { k: "ETH-USDC", v: `${fmtPx(s.eth)} pool`, up: true },
    { k: "STAKE", v: `${(STAKE_APR * 100).toFixed(0)}% APR`, up: true },
    { k: "WPIT-USDC FARM", v: "sim 48% APY", up: true },
    { k: "WPIT-ETH FARM", v: "sim 36% APY", up: true },
    { k: "PAPER", v: "1,000 ETH + $100k", up: true },
  ];
  const loop = [...items, ...items];
  return (
    <div className="overflow-hidden border-y border-border bg-elevated">
      <div className="flex w-max gap-8 py-2.5 pl-4 font-mono text-[11px] uppercase tracking-wider animate-[ticker_48s_linear_infinite]">
        {loop.map((it, i) => (
          <span key={`${it.k}-${i}`} className="shrink-0">
            <span className="text-brass">{it.k}</span>{" "}
            <span className={it.up ? "text-up" : "text-down"}>{it.v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
