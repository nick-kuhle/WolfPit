import { useNavigate } from "@tanstack/react-router";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { useWolf } from "@/lib/wolfpit/store";
import { STAKE_APR } from "@/lib/wolfpit/types";
import { fmtPct, fmtPx } from "@/lib/utils";

type TapeItem =
  | { kind: "asset"; listing: Listing }
  | { kind: "route"; k: string; v: string; to: "/trade" | "/pools" | "/stake" | "/games" };

export function LiveTicker() {
  const universe = useDesk((s) => s.universe);
  const s = useWolf();
  const nav = useNavigate();
  const coins = universe.slice(0, 16);
  const extras: TapeItem[] = [
    { kind: "route", k: "ETH-USDC", v: `${fmtPx(s.eth)} pool`, to: "/pools" },
    { kind: "route", k: "STAKE", v: `${(STAKE_APR * 100).toFixed(0)}% APR`, to: "/stake" },
    { kind: "route", k: "TRACK", v: "horses · dogs · 5m", to: "/games" },
  ];
  const items: TapeItem[] = [...coins.map((c) => ({ kind: "asset" as const, listing: c })), ...extras];
  const loop = [...items, ...items];

  function go(it: TapeItem) {
    if (it.kind === "asset") {
      useDesk.getState().setFocus(it.listing);
      useWolf.getState().listToken(it.listing.symbol, it.listing.price || 1);
      void nav({ to: "/trade" });
      return;
    }
    void nav({ to: it.to });
  }

  return (
    <div className="overflow-hidden border-y border-border bg-elevated">
      <div className="ticker-track flex w-max gap-2 py-1.5 pl-2 font-mono text-[11px] uppercase tracking-wider animate-[ticker_48s_linear_infinite]">
        {loop.map((it, i) => {
          const k = it.kind === "asset" ? it.listing.symbol : it.k;
          const v =
            it.kind === "asset" ? `${fmtPx(it.listing.price)} ${fmtPct(it.listing.change24)}` : it.v;
          const up = it.kind === "asset" ? it.listing.change24 >= 0 : true;
          return (
            <button
              key={`${k}-${i}`}
              type="button"
              onClick={() => go(it)}
              className="pressable shrink-0 rounded-full border border-transparent px-3 py-1.5 hover:border-brass/50 hover:bg-panel"
            >
              <span className="text-brass">{k}</span>{" "}
              <span className={up ? "text-up" : "text-down"}>{v}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
