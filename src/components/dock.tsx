import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type SVGProps } from "react";
import { harvestDue } from "@/lib/wolfpit/engine";
import { chainLabel, chainMode } from "@/lib/wolfpit/chain";
import { useWolf, useEquity } from "@/lib/wolfpit/store";
import { useAlerts } from "@/lib/wolfpit/alerts";
import { fmtUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/" as const, label: "Floor", Icon: IconFloor, match: (p: string) => p === "/" },
  { to: "/pools" as const, label: "Farms", Icon: IconFarm, match: (p: string) => p === "/pools" || p === "/stake" },
  { to: "/trade" as const, label: "Trade", Icon: IconTrade, match: (p: string) => p === "/trade" || p.startsWith("/asset") },
  { to: "/book" as const, label: "Book", Icon: IconCase, match: (p: string) => p === "/book" },
] as const;

export function PitDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [more, setMore] = useState(false);
  const ripe = useWolf(harvestDue);
  const working = useWolf((s) => (s.working ?? []).length);
  const alerts = useAlerts((s) => s.items.length);
  const badge = working + (alerts > 0 ? 1 : 0);
  const moreActive = more || !TABS.some((t) => t.match(pathname));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-[#0d0d0d] pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Pit"
      >
        <div className="grid h-[3.35rem] grid-cols-5">
          {TABS.map((t) => {
            const on = t.match(pathname);
            const farmBadge = t.to === "/pools" && ripe > 0;
            return (
              <Link
                key={t.to}
                to={t.to}
                onClick={() => setMore(false)}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 pt-1",
                  on ? "text-brass" : "text-[#8e8e8e]",
                )}
              >
                <t.Icon className="size-[22px]" />
                <span className="text-[10px] leading-none tracking-tight">{t.label}</span>
                {farmBadge ? (
                  <span className="absolute right-[18%] top-0.5 h-1.5 w-1.5 rounded-full bg-brass" />
                ) : null}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            className={cn("relative flex flex-col items-center justify-center gap-0.5 pt-1", moreActive ? "text-brass" : "text-[#8e8e8e]")}
          >
            <IconMore className="size-[22px]" />
            <span className="text-[10px] leading-none tracking-tight">More</span>
            {badge > 0 ? (
              <span className="absolute right-[18%] top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#3b82f6] px-0.5 text-[9px] font-medium text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            ) : null}
          </button>
        </div>
      </nav>
      {more ? <MoreSheet onClose={() => setMore(false)} /> : null}
    </>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const eq = useEquity();
  const s = useWolf();
  const reset = useWolf((st) => st.reset);
  const setSpeed = useWolf((st) => st.setSpeed);

  function go(to: "/pools" | "/stake" | "/orders" | "/learn" | "/terms" | "/plan" | "/admin" | "/watch") {
    onClose();
    void nav({ to });
  }

  return (
    <div className="fixed inset-x-0 top-0 z-40 lg:hidden" style={{ bottom: "calc(3.4rem + env(safe-area-inset-bottom))" }}>
      <button type="button" className="absolute inset-0 bg-bg/75" aria-label="Fold menu down" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[min(82dvh,36rem)] overflow-auto rounded-t-[1.1rem] border-t border-border bg-[#121212] shadow-2xl">
        <button type="button" onClick={onClose} className="flex w-full flex-col items-center pb-1 pt-2" aria-label="Done">
          <span className="h-1 w-10 rounded-full bg-border-strong" />
          <span className="mt-1 font-mono text-[11px] uppercase tracking-wider text-brass">Done · fold down</span>
        </button>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="grid size-12 place-items-center rounded-full bg-brass font-display text-lg text-bg">N</div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">You · paper</div>
            <div className="font-mono text-[12px] text-muted">Net liq {fmtUsd(eq)}</div>
          </div>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              chainMode() === "base" ? "border border-down text-down" : "border border-border text-brass",
            )}
          >
            {chainLabel()}
          </span>
        </div>

        <div className="px-3 pb-3">
          <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-subtle">Pit</p>
          <Row icon="★" label="Watch" hint="Tape, gainers, chains" onClick={() => go("/watch")} />
          <Row icon="◎" label="Stake" hint="12% APR junior" onClick={() => go("/stake")} />
          <Row icon="☰" label="Fills" hint={`${s.fills.length} on the tape`} onClick={() => go("/orders")} />
          <Row icon="?" label="Learn" hint="Pit school" onClick={() => go("/learn")} />
          <Row icon="⌘" label="Plan" hint="Roadmap" onClick={() => go("/plan")} />
        </div>

        <div className="border-t border-border px-3 py-3">
          <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-subtle">Settings</p>
          <div className="flex items-center justify-between rounded-lg px-2 py-2">
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
          <Row icon="↺" label="Reset paper" hint="1,000 ETH · 100,000 USDC" onClick={() => { reset(); onClose(); }} />
          <Row icon="§" label="Terms" hint="Clickwrap" onClick={() => go("/terms")} />
          <Row icon="⚙" label="Pit ops" hint="Admin" onClick={() => go("/admin")} />
        </div>
        <div className="sticky bottom-0 border-t border-border bg-[#121212] px-3 py-3">
          <button type="button" onClick={onClose} className="h-11 w-full rounded-full bg-brass font-medium text-bg">
            Fold down
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, hint, onClick }: { icon: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-elevated">
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
function IconFarm(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <path d="M12 21V9" />
      <path d="M12 14c-3.2-1.2-5.2-3.6-6.4-7 2.8.4 5 1.8 6.4 4.2" />
      <path d="M12 14c3.2-1.2 5.2-3.6 6.4-7-2.8.4-5 1.8-6.4 4.2" />
      <path d="M12 10c-2-2.4-3-5-3.2-8 2 .8 3.4 2.6 3.2 5.4" />
      <path d="M12 10c2-2.4 3-5 3.2-8-2 .8-3.4 2.6-3.2 5.4" />
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
                ["/watch", "Watch"],
                ["/stake", "Stake"],
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
