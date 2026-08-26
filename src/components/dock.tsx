import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type SVGProps } from "react";
import { harvestDue } from "@/lib/wolfpit/engine";
import { chainLabel, chainMode } from "@/lib/wolfpit/chain";
import { useWolf, useEquity } from "@/lib/wolfpit/store";
import { useAlerts } from "@/lib/wolfpit/alerts";
import { fmtUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useWallet, truncAddr } from "@/lib/wallet/session";

const TABS = [
  { to: "/" as const, label: "Floor", Icon: IconFloor, match: (p: string) => p === "/", catchy: false },
  { to: "/games" as const, label: "The Ranch", Icon: IconRanch, match: (p: string) => p === "/pools" || p === "/stake" || p === "/games", catchy: true },
  { to: "/trade" as const, label: "Trade", Icon: IconTrade, match: (p: string) => p === "/trade" || p.startsWith("/asset"), catchy: false },
  { to: "/book" as const, label: "Book", Icon: IconCase, match: (p: string) => p === "/book", catchy: false },
] as const;

export function PitDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState(false);
  const ripe = useWolf(harvestDue);
  const working = useWolf((s) => (s.working ?? []).length);
  const alerts = useAlerts((s) => s.items.length);
  const badge = working + (alerts > 0 ? 1 : 0);
  const moreActive = more || sheet || !TABS.some((t) => t.match(pathname));

  useEffect(() => {
    if (more) setSheet(true);
  }, [more]);

  function requestClose() {
    setMore(false);
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-[#0a0a0a] px-2 pt-1.5 pb-[calc(0.35rem+env(safe-area-inset-bottom))] lg:hidden"
        aria-label="Pit"
      >
        <div className="flex items-stretch gap-1.5">
          {TABS.map((t) => {
            const on = t.match(pathname);
            const farmBadge = t.to === "/games" && ripe > 0;
            return (
              <Link
                key={t.to}
                to={t.to}
                onClick={() => requestClose()}
                className={cn(
                  "relative flex min-h-[3.2rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 pt-1",
                  on ? "border-brass bg-brass/15 text-brass" : "border-[#2a2a2a] bg-[#141414] text-[#8e8e8e]",
                  t.catchy && !on && "border-brass/50 text-brass/80",
                )}
              >
                <t.Icon className="size-[20px]" />
                <span className="px-0.5 text-center text-[9px] font-medium leading-[1.05] tracking-tight">{t.label}</span>
                {t.catchy ? (
                  <span className="absolute -top-1 right-1 rounded-full bg-brass px-1 font-mono text-[7px] font-bold uppercase leading-4 text-bg">
                    Live
                  </span>
                ) : null}
                {farmBadge ? (
                  <span className="absolute left-1.5 top-1 h-1.5 w-1.5 rounded-full bg-brass" />
                ) : null}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            className={cn(
              "relative flex min-h-[3.2rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 pt-1",
              moreActive ? "border-brass bg-brass/15 text-brass" : "border-[#2a2a2a] bg-[#141414] text-[#8e8e8e]",
            )}
          >
            <IconMore className="size-[20px]" />
            <span className="text-[9px] font-medium leading-none tracking-tight">More</span>
            {badge > 0 ? (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#3b82f6] px-0.5 text-[9px] font-medium text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            ) : null}
          </button>
        </div>
      </nav>
      {sheet ? (
        <MoreSheet
          open={more}
          onClose={requestClose}
          onExited={() => setSheet(false)}
        />
      ) : null}
    </>
  );
}

function MoreSheet({ open, onClose, onExited }: { open: boolean; onClose: () => void; onExited: () => void }) {
  const nav = useNavigate();
  const eq = useEquity();
  const s = useWolf();
  const reset = useWolf((st) => st.reset);
  const setSpeed = useWolf((st) => st.setSpeed);
  const wallet = useWallet();
  const closing = !open;

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onExited, 340);
    return () => window.clearTimeout(t);
  }, [closing, onExited]);

  function go(to: "/pools" | "/stake" | "/orders" | "/learn" | "/terms" | "/plan" | "/admin" | "/watch" | "/profile" | "/games") {
    onClose();
    window.setTimeout(() => {
      void nav({ to });
    }, 180);
  }

  return (
    <div className="fixed inset-x-0 top-0 z-40 lg:hidden" style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}>
      <button
        type="button"
        className={cn("absolute inset-0 bg-bg/75 dock-dim", closing && "is-closing")}
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        key={open ? "up" : "down"}
        className={cn(
          "dock-sheet absolute inset-x-0 bottom-0 max-h-[min(82dvh,36rem)] overflow-auto rounded-t-[1.1rem] border-t border-border bg-[#121212] shadow-2xl",
          closing && "is-closing",
        )}
      >
        <button type="button" onClick={onClose} className="flex w-full flex-col items-center pb-1 pt-2" aria-label="Close">
          <span className="h-1 w-10 rounded-full bg-border-strong" />
          <span className="mt-1 font-mono text-[11px] uppercase tracking-wider text-brass">Close</span>
        </button>
        <button type="button" onClick={() => go("/profile")} className="dock-row flex w-full items-center gap-3 px-4 py-3 text-left" style={{ animationDelay: "40ms" }}>
          <div className="grid size-12 place-items-center rounded-full bg-brass font-display text-lg text-bg">
            {wallet.address ? wallet.address.slice(2, 4).toUpperCase() : "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{wallet.address ? truncAddr(wallet.address) : "Profile · connect"}</div>
            <div className="font-mono text-[12px] text-muted">
              {wallet.address ? `Net liq ${fmtUsd(eq)}` : "Wallet required to trade"}
            </div>
          </div>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              chainMode() === "base" ? "border border-down text-down" : "border border-border text-brass",
            )}
          >
            {chainLabel()}
          </span>
        </button>

        <div className="px-3 pb-3">
          <p className="dock-row px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-subtle" style={{ animationDelay: "70ms" }}>
            Pit
          </p>
          <Row icon="☻" label="Profile" hint={wallet.address ? truncAddr(wallet.address) : "Connect wallet to trade"} onClick={() => go("/profile")} delay={90} />
          <Row icon="♞" label="Racetrack" hint="Horses · dogs · every 2 minutes" onClick={() => go("/games")} delay={120} />
          <Row icon="★" label="Watch" hint="Tape, gainers, chains" onClick={() => go("/watch")} delay={150} />
          <Row icon="◎" label="Pools" hint="12% APR junior" onClick={() => go("/stake")} delay={180} />
          <Row icon="▣" label="Farms" hint="Cut the yield" onClick={() => go("/pools")} delay={200} />
          <Row icon="☰" label="Fills" hint={`${s.fills.length} on the tape`} onClick={() => go("/orders")} delay={210} />
          <Row icon="?" label="Learn" hint="Pit school" onClick={() => go("/learn")} delay={240} />
          <Row icon="⌘" label="Plan" hint="Roadmap" onClick={() => go("/plan")} delay={270} />
        </div>

        <div className="border-t border-border px-3 py-3">
          <p className="dock-row px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-subtle" style={{ animationDelay: "300ms" }}>
            Settings
          </p>
          <div className="dock-row flex items-center justify-between rounded-lg px-2 py-2" style={{ animationDelay: "320ms" }}>
            <span className="text-sm">Sim speed</span>
            <div className="flex overflow-hidden rounded-full border border-border">
              {([1, 10, 60] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSpeed(n)}
                  className={cn("h-8 px-3 font-mono text-[11px]", s.simSpeed === n ? "bg-brass text-bg" : "text-muted")}
                >
                  {n}×
                </button>
              ))}
            </div>
          </div>
          <Row icon="↺" label="Reset paper" hint="1,000 ETH · 100,000 USDC" onClick={() => { reset(); onClose(); }} delay={350} />
          <Row icon="§" label="Terms" hint="Clickwrap" onClick={() => go("/terms")} delay={380} />
          <Row icon="⚙" label="Pit ops" hint="Admin" onClick={() => go("/admin")} delay={410} />
        </div>
        <div className="sticky bottom-0 border-t border-border bg-[#121212] px-3 py-3">
          <button type="button" onClick={onClose} className="h-11 w-full rounded-full bg-brass font-medium text-bg">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, hint, onClick, delay = 0 }: { icon: string; label: string; hint: string; onClick: () => void; delay?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dock-row flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-elevated"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="grid size-9 place-items-center rounded-lg bg-elevated text-sm">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg">{label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
      <span className="text-subtle">›</span>
    </button>
  );
}

function IconFloor(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}
function IconRanch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 11.5V20h14v-8.5" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}
function IconTrade(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <path d="M4 18V8M9 18V5M14 18v-7" />
      <path d="M18.2 6.5v5M16 9h4.4" strokeWidth="1.8" />
    </svg>
  );
}
function IconCase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <rect x="3" y="8" width="18" height="12" rx="1.6" />
      <path d="M8 8V6.4A2.4 2.4 0 0 1 10.4 4h3.2A2.4 2.4 0 0 1 16 6.4V8" />
      <path d="M3 13h18" />
    </svg>
  );
}
function IconMore(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

export function DesktopNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="ml-auto hidden items-center gap-1 lg:flex">
      {TABS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className={cn("pressable flex h-11 items-center px-3 text-sm text-muted hover:text-fg", t.match(pathname) && "text-brass")}
        >
          {t.label}
        </Link>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn("pressable flex h-11 items-center px-3 text-sm text-muted hover:text-fg", open && "text-brass")}
        >
          More
        </button>
        {open ? (
          <div className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-xl">
            {(
              [
                ["/profile", "Profile"],
                ["/games", "The Ranch"],
                ["/pools", "Farms"],
                ["/stake", "Pools"],
                ["/watch", "Watch"],
                ["/orders", "Fills"],
                ["/learn", "Learn"],
                ["/plan", "Plan"],
                ["/terms", "Terms"],
                ["/admin", "Pit ops"],
              ] as const
            ).map(([to, label]) => (
              <Link key={to} to={to} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-fg">
                {label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
