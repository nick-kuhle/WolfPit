import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function YieldNav({ on }: { on: "track" | "farms" | "pools" }) {
  const tabs = [
    { to: "/games" as const, id: "track", label: "Racetrack" },
    { to: "/pools" as const, id: "farms", label: "Farms" },
    { to: "/stake" as const, id: "pools", label: "Pools" },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <Link
          key={t.id}
          to={t.to}
          className={cn(
            "inline-flex h-9 items-center rounded-full px-4 text-sm",
            on === t.id ? "bg-brass text-bg" : "border border-white/35 bg-bg/35 text-fg backdrop-blur-sm",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function RanchHero({
  on,
  kicker,
  title,
  sub,
  image,
}: {
  on: "track" | "farms" | "pools";
  kicker: string;
  title: ReactNode;
  sub: string;
  image: string;
}) {
  return (
    <div className="relative isolate overflow-hidden border-b border-brass/25">
      <img src={image} alt="" decoding="async" className="absolute inset-0 size-full object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-bg/45 to-bg/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-bg/20" />
      <div className="relative mx-auto flex min-h-[13.5rem] max-w-3xl flex-col justify-end px-4 py-7 sm:min-h-[16rem] sm:py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brass">{kicker}</p>
        <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-fg sm:text-5xl">{title}</h1>
        <p className="mt-2 max-w-md text-sm text-fg/80">{sub}</p>
        <YieldNav on={on} />
      </div>
    </div>
  );
}
