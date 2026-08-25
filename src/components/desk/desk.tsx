import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AccountBar } from "@/components/desk/account-bar";
import { Blotter } from "@/components/desk/blotter";
import { PitChart } from "@/components/desk/chart";
import { OptionChain } from "@/components/desk/option-chain";
import { OrderTicket } from "@/components/desk/order-ticket";
import { Watchlist } from "@/components/desk/watchlist";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx } from "@/lib/utils";
import { chainLabel } from "@/lib/wolfpit/chain";

export function Desk() {
  const eth = useWolf((s) => s.eth);
  const candles = useWolf((s) => s.candles);
  const [bottom, setBottom] = useState<"blotter" | "chain">("blotter");
  const [mobile, setMobile] = useState<"chart" | "ticket" | "book">("chart");

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <AccountBar />
      <div className="flex items-baseline justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-medium">ETH-USD</h1>
          <span className="font-mono text-lg tabular-nums">{fmtPx(eth)}</span>
          <span className="text-[10px] uppercase tracking-wider text-brass">Paper · {chainLabel()} · WOLFPIT-*-TEST</span>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border px-2 lg:hidden">
        {(["chart", "ticket", "book"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setMobile(k)}
            className={`h-11 px-3 text-xs uppercase tracking-wider ${mobile === k ? "text-fg" : "text-muted"}`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 lg:hidden">
        {mobile === "chart" && (
          <div className="flex h-full flex-col">
            <PitChart candles={candles} height={260} />
            <BottomTabs bottom={bottom} setBottom={setBottom} />
          </div>
        )}
        {mobile === "ticket" && <OrderTicket />}
        {mobile === "book" && <Watchlist />}
      </div>

      <div className="hidden min-h-0 flex-1 lg:block">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize="18%" minSize="14%" maxSize="28%" className="h-full overflow-hidden">
            <Watchlist />
          </Panel>
          <Separator className="w-px bg-border" />
          <Panel defaultSize="56%" minSize="36%">
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize="58%" minSize="36%">
                <PitChart candles={candles} height={340} />
              </Panel>
              <Separator className="h-px bg-border" />
              <Panel defaultSize="42%" minSize="24%">
                <BottomTabs bottom={bottom} setBottom={setBottom} />
              </Panel>
            </Group>
          </Panel>
          <Separator className="w-px bg-border" />
          <Panel defaultSize="26%" minSize="20%" maxSize="36%">
            <OrderTicket />
          </Panel>
        </Group>
      </div>
    </div>
  );
}

function BottomTabs({
  bottom,
  setBottom,
}: {
  bottom: "blotter" | "chain";
  setBottom: (v: "blotter" | "chain") => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-border">
        <button
          className={`h-10 px-4 text-xs uppercase tracking-wider ${bottom === "blotter" ? "text-fg" : "text-muted"}`}
          onClick={() => setBottom("blotter")}
        >
          Positions
        </button>
        <button
          className={`h-10 px-4 text-xs uppercase tracking-wider ${bottom === "chain" ? "text-fg" : "text-muted"}`}
          onClick={() => setBottom("chain")}
        >
          Option chain
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{bottom === "blotter" ? <Blotter /> : <OptionChain />}</div>
    </div>
  );
}
