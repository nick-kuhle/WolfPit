import type { Coat } from "@/lib/wolfpit/games";

const SRC = {
  horse: "/brand/races/horse-run.png",
  dog: "/brand/races/dog-run.png",
} as const;

export function RunnerGfx({
  kind,
  coat,
  no,
  size = 36,
}: {
  kind: "horse" | "dog";
  coat: Coat;
  no: number;
  size?: number;
}) {
  const w = Math.round(size * 1.7);
  return (
    <div className="relative shrink-0" style={{ width: w, height: size }}>
      <div
        className="absolute inset-0"
        style={{
          background: coatBg(coat),
          WebkitMaskImage: `url(${SRC[kind]})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${SRC[kind]})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
      />
      <span className="absolute left-1/2 top-[38%] grid size-[1.15em] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-bg font-mono text-[0.55em] font-bold leading-none text-brass ring-1 ring-brass">
        {no}
      </span>
    </div>
  );
}

function coatBg(coat: Coat) {
  if (coat === "zebra") return "repeating-linear-gradient(105deg,#f4f0e6 0 5px,#1a1a1a 5px 9px)";
  if (coat === "leopard")
    return "radial-gradient(circle at 20% 30%,#5a3a12 0 3px,transparent 4px),radial-gradient(circle at 70% 60%,#5a3a12 0 2.5px,transparent 3.5px),#d4a017";
  if (coat === "rainbow") return "linear-gradient(90deg,#ef4444,#f59e0b,#eab308,#22c55e,#3b82f6,#a855f7)";
  if (coat === "blue") return "#2563eb";
  if (coat === "red") return "#dc2626";
  if (coat === "gold") return "#e3b341";
  if (coat === "green") return "#16a34a";
  return "#7c3aed";
}
