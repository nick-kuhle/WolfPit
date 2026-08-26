import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DesktopNav, PitDock } from "@/components/dock";
import { WolfMark } from "@/components/mark";
import { cn } from "@/lib/utils";
import { chainLabel, chainMode } from "@/lib/wolfpit/chain";
import { truncAddr, useWallet } from "@/lib/wallet/session";

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
  const address = useWallet((s) => s.address);
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-4">
        <BrandLockup />
        <span className="hidden sm:inline">
          <ChainChip />
        </span>
        <DesktopNav pathname={pathname} />
        <Link
          to="/profile"
          className={cn(
            "ml-auto flex h-11 items-center font-mono text-[11px] lg:ml-1",
            address ? "text-brass" : "text-muted",
            pathname === "/profile" && "text-brass",
          )}
        >
          {address ? truncAddr(address) : "Connect"}
        </Link>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-x-hidden", pathname.startsWith("/admin") ? "" : "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0")}>{children}</div>
      {pathname.startsWith("/admin") ? null : <PitDock />}
    </div>
  );
}
