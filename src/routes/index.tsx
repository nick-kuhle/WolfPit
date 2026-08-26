import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SiteFooter } from "@/components/site-footer";
import { LiveTicker } from "@/components/ticker";
import { FloorDeck } from "@/components/floor-deck";
import { Button } from "@/components/ui/button";
import { PIT_OPEN, compBoard, compLive } from "@/lib/wolfpit/comp";
import { equity } from "@/lib/wolfpit/engine";
import { useWolf } from "@/lib/wolfpit/store";
import { useWallet } from "@/lib/wallet/session";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useWolf();
  const join = useWolf((st) => st.joinComp);
  const wallet = useWallet((s) => s.address);
  const nav = useNavigate();
  const now = Date.now();
  const live = compLive(now);
  const board = compBoard(now, { name: "You", equity: equity(s), joined: s.compJoined });
  const you = board.find((r) => r.you);
  const ends = new Date(PIT_OPEN.end).toUTCString().replace("GMT", "UTC");

  return (
    <Shell>
      <LiveTicker />
      <FloorDeck />

      <section className="relative overflow-hidden border-b border-brass/40 bg-brass text-bg">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <span className="fly-ticket absolute left-[8%] top-6 rounded-sm bg-ticket px-3 py-1 font-mono text-[10px] text-bg">BUY 12</span>
          <span className="fly-ticket absolute right-[12%] top-10 rounded-sm bg-bg px-3 py-1 font-mono text-[10px] text-brass" style={{ animationDelay: "0.8s" }}>
            SELL 4
          </span>
          <span className="fly-ticket absolute left-[40%] top-2 rounded-sm bg-down px-3 py-1 font-mono text-[10px] text-fg" style={{ animationDelay: "1.4s" }}>
            FILL
          </span>
          <span className="fly-ticket absolute right-[28%] bottom-6 rounded-sm bg-ticket px-3 py-1 font-mono text-[10px] text-bg" style={{ animationDelay: "1.8s" }}>
            1M WPIT
          </span>
        </div>
        <div className="relative mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:grid-cols-[minmax(0,1.2fr)_16rem] sm:py-12">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-bg px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-brass">Free entry</span>
              <span className="rounded-full bg-bg/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]">Compete for prizes</span>
              <span className="rounded-full bg-bg/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]">Paper only</span>
            </div>
            <h2 className="mt-4 font-display text-4xl font-medium leading-[0.95] sm:text-6xl">
              Pit Open.
              <span className="italic"> Winner takes 1,000,000 WPIT.</span>
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed">
              A trading competition. No deposit. Everyone starts with ${PIT_OPEN.entryUsdc.toLocaleString()} simulated
              USDC. Last fill {ends}. 2nd gets 250,000 WPIT. 3rd gets 100,000. The flying tickets are the pit shouting.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {s.compJoined ? (
                <Link to="/trade">
                  <Button className="h-12 bg-bg px-6 text-brass hover:bg-bg">You're in · trade now</Button>
                </Link>
              ) : (
                <Button
                  className="h-12 bg-bg px-6 text-brass hover:bg-bg"
                  onClick={() => {
                    if (!wallet) {
                      void nav({ to: "/profile" });
                      return;
                    }
                    join();
                    void nav({ to: "/trade" });
                  }}
                  disabled={!live}
                >
                  {!wallet ? "Connect to enter" : live ? "Enter free · $100k paper" : "Doors closed"}
                </Button>
              )}
              <Link to="/trade">
                <Button variant="outline" className="h-12 border-bg px-6 text-bg hover:bg-bg/10">
                  Watch the board
                </Button>
              </Link>
            </div>
            {you ? <p className="mt-3 font-mono text-xs">You're #{you.place} · {fmtUsd(you.equity)}</p> : null}
          </div>
          <ol className="space-y-2">
            <li className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-80">Live board</li>
            {board.slice(0, 5).map((r) => (
              <li
                key={r.name}
                className={`flex items-center justify-between rounded-md px-3 py-2 ${r.you ? "bg-bg text-brass" : "bg-bg/15"}`}
              >
                <span className="font-mono text-xs">
                  {r.place}. {r.name}
                </span>
                <span className="font-mono text-xs">{fmtUsd(r.equity)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <SiteFooter />
    </Shell>
  );
}
