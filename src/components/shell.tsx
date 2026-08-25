import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WolfMark } from "@/components/mark";
import { cn } from "@/lib/utils";
import { chainLabel, chainMode } from "@/lib/wolfpit/chain";

const NAV = [
  { to: "/trade", label: "Desk" },
  { to: "/pools", label: "Pools" },
  { to: "/stake", label: "Stake" },
  { to: "/plan", label: "Plan" },
];

export function BrandLockup({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex items-center gap-2 text-fg", className)}>
      <WolfMark className="size-6 text-accent" />
      <span className="text-sm font-medium tracking-[0.22em]">WOLFPIT</span>
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

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
        <BrandLockup />
        <span className="hidden sm:inline">
          <ChainChip />
        </span>
        <nav className="ml-auto flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex h-11 items-center px-3 text-sm text-muted hover:text-fg",
                pathname === n.to && "text-fg",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
