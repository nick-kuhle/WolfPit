export const PIT_OPEN = {
  id: "pit-open-2026-09",
  name: "Pit Open",
  start: Date.UTC(2026, 7, 25, 20, 0, 0),
  end: Date.UTC(2026, 8, 25, 20, 0, 0),
  entryUsdc: 100_000,
  prize: [
    { place: 1, wpit: 1_000_000 },
    { place: 2, wpit: 250_000 },
    { place: 3, wpit: 100_000 },
  ],
} as const;

const NAMES = ["Curb", "Screamer", "Ticket", "Rail", "Chalk", "Open Outcry", "Fill or Kill", "Local"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export function compBoard(now: number, you: { name: string; equity: number; joined: boolean }) {
  const t = Math.max(0, Math.min(1, (now - PIT_OPEN.start) / Math.max(PIT_OPEN.end - PIT_OPEN.start, 1)));
  const r = rng(0x71c0de);
  const field = NAMES.map((name) => {
    const drift = (r() - 0.42) * 0.35 * t;
    const noise = Math.sin(now / 3_600_000 + r() * 9) * 0.03;
    const equity = PIT_OPEN.entryUsdc * (1 + drift + noise);
    return { name, equity, you: false };
  });
  const rows = you.joined ? [{ name: you.name, equity: you.equity, you: true }, ...field] : field;
  return rows.sort((a, b) => b.equity - a.equity).map((row, i) => ({ ...row, place: i + 1 }));
}

export function compLive(now: number) {
  return now >= PIT_OPEN.start && now < PIT_OPEN.end;
}

export function prizeFor(place: number) {
  return PIT_OPEN.prize.find((p) => p.place === place)?.wpit ?? 0;
}
