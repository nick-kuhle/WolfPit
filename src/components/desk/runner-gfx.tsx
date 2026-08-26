import type { Coat } from "@/lib/wolfpit/games";
import { cn } from "@/lib/utils";

const SRC = {
  horse: "/brand/races/horse-run.png",
  dog: "/brand/races/dog-run.png",
} as const;

export function RunnerGfx({
  kind,
  coat,
  no,
  size = 36,
  gait = "off",
  silk,
}: {
  kind: "horse" | "dog";
  coat: Coat;
  no: number;
  size?: number;
  gait?: "run" | "idle" | "off";
  silk?: string;
}) {
  const w = Math.round(size * 1.7);
  const fill = coatBg(coat, silk);
  const mask = {
    background: fill,
    WebkitMaskImage: `url(${SRC[kind]})`,
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    WebkitMaskSize: "contain",
    maskImage: `url(${SRC[kind]})`,
    maskRepeat: "no-repeat",
    maskPosition: "center",
    maskSize: "contain",
    animationDelay: `-${(no % 8) * 0.04}s`,
  } as const;
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width: w, height: size }}>
      {gait === "run" ? (
        <>
          <div className="absolute inset-0 runner-body" style={{ ...mask, clipPath: "inset(0 0 38% 0)" }} />
          <div
            className={cn("absolute inset-0 runner-legs", kind === "dog" && "is-dog")}
            style={{ ...mask, clipPath: "inset(55% 0 0 0)" }}
          />
        </>
      ) : (
        <div className={cn("absolute inset-0", gait === "idle" && "runner-idle")} style={mask} />
      )}
      <span
        className="absolute left-1/2 top-[38%] grid size-[1.15em] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono text-[0.55em] font-bold leading-none text-bg ring-1 ring-bg/70"
        style={{ background: silk || namedCoat(coat) }}
      >
        {no}
      </span>
    </div>
  );
}

function namedCoat(coat: Coat) {
  if (coat === "zebra") return "#e6e2d6";
  if (coat === "leopard") return "#d4a017";
  if (coat === "blue") return "#2563eb";
  if (coat === "red") return "#dc2626";
  if (coat === "green") return "#22c55e";
  if (coat === "orange") return "#f97316";
  if (coat === "cyan") return "#22d3ee";
  return "#7c3aed";
}

function coatBg(coat: Coat, silk?: string) {
  const base = silk || namedCoat(coat);
  if (coat === "zebra") return `repeating-linear-gradient(105deg,${base} 0 5px,#1a1a1a 5px 9px)`;
  if (coat === "leopard")
    return `radial-gradient(circle at 20% 30%,#5a3a12 0 3px,transparent 4px),radial-gradient(circle at 70% 60%,#5a3a12 0 2.5px,transparent 3.5px),${base}`;
  return base;
}
