import type { Coat } from "@/lib/wolfpit/games";

export function RunnerGfx({
  kind,
  coat,
  no,
  size = 56,
}: {
  kind: "horse" | "dog";
  coat: Coat;
  no: number;
  size?: number;
}) {
  const id = `${kind}-${coat}-${no}`;
  return (
    <svg viewBox="0 0 88 52" width={size * 1.7} height={size} aria-hidden className="drop-shadow">
      <defs>
        <pattern id={`zebra-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
          <rect width="6" height="6" fill="#f4f0e6" />
          <rect width="3" height="6" fill="#1a1a1a" />
        </pattern>
        <pattern id={`leo-${id}`} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill="#d4a017" />
          <circle cx="3" cy="3" r="1.6" fill="#5a3a12" />
          <circle cx="8" cy="7" r="1.4" fill="#5a3a12" />
        </pattern>
        <linearGradient id={`rb-${id}`} x1="0" x2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="20%" stopColor="#f59e0b" />
          <stop offset="40%" stopColor="#eab308" />
          <stop offset="60%" stopColor="#22c55e" />
          <stop offset="80%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <g fill={fillFor(coat, id)}>
        {kind === "horse" ? <HorsePath /> : <DogPath />}
      </g>
      <circle cx="40" cy="18" r="9" fill="#0b0c0b" stroke="#f0c14b" strokeWidth="1.4" />
      <text x="40" y="22" textAnchor="middle" fill="#f0c14b" fontSize="11" fontFamily="ui-monospace, monospace" fontWeight="700">
        {no}
      </text>
    </svg>
  );
}

function fillFor(coat: Coat, id: string) {
  if (coat === "zebra") return `url(#zebra-${id})`;
  if (coat === "leopard") return `url(#leo-${id})`;
  if (coat === "rainbow") return `url(#rb-${id})`;
  if (coat === "blue") return "#2563eb";
  if (coat === "red") return "#dc2626";
  if (coat === "gold") return "#e3b341";
  if (coat === "green") return "#16a34a";
  return "#7c3aed";
}

function HorsePath() {
  return (
    <>
      <ellipse cx="42" cy="28" rx="22" ry="11" />
      <path d="M62 26c8-2 12-10 16-14 1 6-1 12-6 16-2 8-1 14 2 18h-4c-2-6-3-12-1-16-6 1-10 2-14 1z" />
      <path d="M22 26c-6 1-10 4-14 2 2 4 6 6 12 6z" />
      <rect x="28" y="36" width="3.2" height="14" rx="1" />
      <rect x="36" y="36" width="3.2" height="14" rx="1" />
      <rect x="46" y="36" width="3.2" height="14" rx="1" />
      <rect x="54" y="36" width="3.2" height="14" rx="1" />
    </>
  );
}

function DogPath() {
  return (
    <>
      <ellipse cx="44" cy="30" rx="20" ry="8" />
      <path d="M64 28c10-1 16-6 20-4-2 5-8 8-16 8z" />
      <path d="M24 28c-8 2-14 1-18-2 4 6 10 8 18 7z" />
      <rect x="30" y="36" width="2.6" height="12" rx="1" />
      <rect x="38" y="36" width="2.6" height="12" rx="1" />
      <rect x="48" y="36" width="2.6" height="12" rx="1" />
      <rect x="56" y="36" width="2.6" height="12" rx="1" />
    </>
  );
}
