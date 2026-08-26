import type { Coat } from "@/lib/wolfpit/games";

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
  const id = `${kind}-${coat}-${no}`;
  return (
    <svg
      viewBox="0 0 100 50"
      width={size * 2}
      height={size}
      aria-hidden
      className="overflow-visible drop-shadow-[0_2px_1px_rgba(0,0,0,0.5)]"
    >
      <defs>
        <pattern id={`zebra-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">
          <rect width="5" height="5" fill="#f4f0e6" />
          <rect width="2.2" height="5" fill="#1a1a1a" />
        </pattern>
        <pattern id={`leo-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
          <rect width="9" height="9" fill="#d4a017" />
          <circle cx="2.5" cy="2.5" r="1.3" fill="#5a3a12" />
          <circle cx="7" cy="6" r="1.1" fill="#5a3a12" />
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
      <g fill={fillFor(coat, id)} stroke="#111" strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round">
        {kind === "horse" ? <Horse /> : <Hound />}
      </g>
      <circle cx="46" cy="22" r="6.4" fill="#0b0c0b" stroke="#f0c14b" strokeWidth="1.15" />
      <text x="46" y="25.2" textAnchor="middle" fill="#f0c14b" fontSize="8.5" fontFamily="ui-monospace, monospace" fontWeight="700">
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

function Horse() {
  return (
    <>
      <path d="M22 23c-9-5-16 0-18 7 6-1 12-1 18 0z" />
      <ellipse cx="44" cy="26" rx="18" ry="8" transform="rotate(-8 44 26)" />
      <path d="M58 21c8-4 12-13 18-17-1 7-3 13-8 17-4 2-7 3-10 3z" />
      <ellipse cx="82" cy="8" rx="8.5" ry="4" transform="rotate(-26 82 8)" />
      <path d="M76 5.5l2-7.5 3.2 7" />
      <path d="M80.5 4.5l1.4-6.5 2.6 6.4" />
      <path d="M32 32.5 23 48h2.6l7.8-15.2z" />
      <path d="M40 33.5 38.6 48h2.4l1-14.5z" />
      <path d="M50 32.5 53 48h2.4l-2.8-15.5z" />
      <path d="M58 31.5 70 47.5h-2.8L56 32z" />
    </>
  );
}

function Hound() {
  return (
    <>
      <path d="M20 28c-8-1-14 4-16 10 5-2 10-3 16-3z" />
      <ellipse cx="46" cy="29" rx="22" ry="5.4" transform="rotate(-3 46 29)" />
      <path d="M66 26c12-2 22-1 32 4 1 2-3 4-10 4-8-1-16-2-22-4z" />
      <path d="M94 26l7-4-1.5 5.5z" />
      <path d="M36 33 27 48h2.3l7.6-14.6z" />
      <path d="M44 34 43 48h2.2l.8-14z" />
      <path d="M54 33 58 48h2.2l-3.4-15z" />
      <path d="M62 32 78 46.5h-2.6L60.5 32.5z" />
    </>
  );
}
