import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function YieldNav({ on }: { on: "farms" | "stake" | "track" }) {
  const tabs = [
    { to: "/pools" as const, id: "farms", label: "Farms" },
    { to: "/games" as const, id: "track", label: "Racetrack" },
    { to: "/stake" as const, id: "stake", label: "Stake" },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          to={t.to}
          className={cn(
            "inline-flex h-9 items-center rounded-full px-4 text-sm",
            on === t.id ? "bg-bg text-brass" : "border border-current/35 text-inherit",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
