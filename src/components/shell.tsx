import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WolfMark } from "@/components/mark";
import { cn } from "@/lib/utils";
import { chainLabel, chainMode } from "@/lib/wolfpit/chain";

const NAV = [
  { to: "/trade" as const, label: "Floor" },
  { to: "/orders" as const, label: "Fills" },
  { to: "/pools" as const, label: "Farms" },
  { to: "/stake" as const, label: "Stake" },
];

export function BrandLockup({ className, markClass }: { className?: string; markClass?: string }) {
  return (
    <Link to="/" className={cn("flex min-h-11 items-center gap-2 text-fg", className)}>
      <WolfMark className={cn("size-7 text-brass", markClass)} />
      <span className="text-[13px] font-medium tracking-[0.28em] text-brass">WOLFPIT</span>
    </Link>
  );
}

export function ChainChip() {
  const live = chainMode() === "base";
  return (
    <span
      className={cn(
        "rounded-[var(--radius-xs)] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        live ? "border-down text-down" : "border-border text-brass",
      )}
    >
      {chainLabel()}
    </span>
  );
}

export function Shell({ children, desk }: { children: ReactNode; desk?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-4">
        <BrandLockup />
        <span className="hidden sm:inline">
          <ChainChip />
        </span>
        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "pressable flex h-11 items-center px-3 text-sm text-muted hover:text-fg",
                pathname === n.to && "text-brass",
              )}
            >
              {n.label}
            </Link>
          ))}
          <Link
            to="/trade"
            className={cn("pressable flex h-11 items-center px-3 text-sm text-muted hover:text-fg", pathname === "/trade" && "text-brass")}
          >
            Ticket
          </Link>
          <Link to="/learn" className="pressable flex h-11 items-center px-3 text-sm text-muted hover:text-fg">
            Learn
          </Link>
        </nav>
      </header>
      <div className={cn("min-h-0 flex-1", "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0")}>{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-5">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "pressable flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider",
                pathname === n.to ? "text-brass" : "text-muted",
              )}
            >
              {n.label}
            </Link>
          ))}
          <Link
            to="/trade"
            className={cn(
              "pressable flex h-14 flex-col items-center justify-center text-[11px] uppercase tracking-wider",
              pathname === "/trade" ? "text-brass" : "text-muted",
            )}
          >
            Ticket
          </Link>
        </div>
      </nav>
    </div>
  );
}
