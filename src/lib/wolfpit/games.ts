import { uid } from "./math";
import { requireFinitePositive } from "./limits";
import type { EngineState } from "./types";
import type { GameBet, GameMeet, GamesState, RaceKind } from "./types";

export const RACE_MS = 300_000;
export const POST_AT = 220_000;
export const RUN_MS = 72_000;
export const GAMES_VAULT_SEED = 200_000;
export const MIN_BET = 10;
export const MAX_BET = 5_000;
export const OVERROUND_HORSE = 1.14;
export const OVERROUND_DOG = 1.12;

const HORSES = [
  "Thunderclap", "Lady Brass", "Red Ticket", "Iron Pit", "Night Whistle",
  "Golden Curb", "Fast Ledger", "Copper Stampede", "Pit Wolf", "Silk Hedge",
  "Midnight Fill", "Curb Appeal", "Brass Monkey", "Delta Queen", "Railbird",
  "Photo Finish", "Mudlark", "Whistlejacket", "Stub Ticket", "Open Outcry",
  "Blackboard", "Yellow Pad", "Two Dollar", "Clubhouse", "Longshot Lil",
  "Favorite Son", "Gate Crash", "Turn of Foot", "Homestretch", "Wire to Wire",
  "Paddock Ghost", "Stewards' Cup", "Furlong Fever", "Oatbag", "Haymaker",
  "Saddle Soap", "Blinkers Off", "Crop Duster", "Lead Pony", "Call to Post",
];

const DOGS = [
  "Zip", "Copper", "Blitz", "Nudge", "Flea", "Rocket",
  "Cinder", "Pepper", "Dash", "Nitro", "Scoot", "Brass",
  "Wicket", "Pebble", "Streak", "Jinx", "Hustle", "Grit",
  "Sparky", "Muzzle", "Trapdoor", "Lure", "Tin Cup", "Rake",
];

const SILKS = ["#f0c14b", "#3dcc7a", "#ef5a4e", "#e6e2d6", "#6ea8fe", "#c084fc", "#fb923c", "#22d3ee"];

const FRACS: [number, string][] = [
  [1.1, "1/10"], [1.2, "1/5"], [1.25, "1/4"], [1.33, "1/3"], [1.4, "2/5"], [1.5, "1/2"],
  [1.62, "4/7"], [1.73, "8/11"], [1.8, "4/5"], [1.91, "10/11"], [2, "EVS"], [2.1, "11/10"],
  [2.2, "6/5"], [2.38, "11/8"], [2.5, "6/4"], [2.75, "7/4"], [3, "2/1"], [3.5, "5/2"],
  [4, "3/1"], [4.5, "7/2"], [5, "4/1"], [6, "5/1"], [7, "6/1"], [8, "7/1"], [9, "8/1"],
  [10, "9/1"], [11, "10/1"], [13, "12/1"], [15, "14/1"], [17, "16/1"], [21, "20/1"],
  [26, "25/1"], [34, "33/1"], [51, "50/1"],
];

export type Runner = {
  no: number;
  name: string;
  odds: number;
  silk: string;
  form: number;
};

export type RaceCard = {
  id: string;
  kind: RaceKind;
  start: number;
  postAt: number;
  settleAt: number;
  nextAt: number;
  runners: Runner[];
  places: number[];
  winner: number;
  status: "open" | "running" | "official";
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function fracOdds(dec: number) {
  let best = FRACS[0]!;
  let d = Math.abs(dec - best[0]);
  for (const row of FRACS) {
    const x = Math.abs(dec - row[0]);
    if (x < d) {
      d = x;
      best = row;
    }
  }
  return best[1];
}

export function emptyGames(): GamesState {
  return { vaultWpit: GAMES_VAULT_SEED, bets: [], meets: [] };
}

export function slotStart(now: number, kind: RaceKind) {
  const offset = kind === "dog" ? RACE_MS / 2 : 0;
  return Math.floor((now - offset) / RACE_MS) * RACE_MS + offset;
}

export function makeCard(kind: RaceKind, now = Date.now()): RaceCard {
  const start = slotStart(now, kind);
  const id = `${kind === "horse" ? "H" : "D"}-${start}`;
  const r = rng(hash(id));
  const n = kind === "horse" ? 8 : 6;
  const pool = kind === "horse" ? HORSES.slice() : DOGS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const form = Array.from({ length: n }, () => 0.35 + r() ** 1.15 * 0.9);
  const sum = form.reduce((a, b) => a + b, 0);
  const over = kind === "horse" ? OVERROUND_HORSE : OVERROUND_DOG;
  const runners: Runner[] = form.map((f, i) => {
    const p = f / sum;
    const odds = Math.min(50, Math.max(1.2, Math.round((1 / (p * over)) * 20) / 20));
    return { no: i + 1, name: pool[i]!, odds, silk: SILKS[i]!, form: f };
  });
  const places = runners
    .map((x) => x.no)
    .sort((a, b) => {
      const fa = runners[a - 1]!.form + r() * 0.22;
      const fb = runners[b - 1]!.form + r() * 0.22;
      return fb - fa;
    });
  const postAt = start + POST_AT;
  const settleAt = postAt + RUN_MS;
  const nextAt = start + RACE_MS;
  let status: RaceCard["status"] = "open";
  if (now >= settleAt) status = "official";
  else if (now >= postAt) status = "running";
  return { id, kind, start, postAt, settleAt, nextAt, runners, places, winner: places[0]!, status };
}

export function fieldAt(card: RaceCard, now: number) {
  const t = Math.min(1, Math.max(0, (now - card.postAt) / RUN_MS));
  const ease = t * t * (3 - 2 * t);
  return card.runners.map((r) => {
    const place = card.places.indexOf(r.no);
    const finish = 1 - place * (card.kind === "horse" ? 0.035 : 0.045);
    const wobble = 0.07 * Math.sin(t * 14 + r.no * 1.7) * t * (1 - t);
    const x = Math.min(1, Math.max(0, ease * finish + wobble));
    return { ...r, x, place };
  });
}

export function liability(odds: number, stake: number) {
  return stake * Math.max(0, odds - 1);
}

export function placeBet(
  s: EngineState,
  kind: RaceKind,
  runner: number,
  stake: number,
  now = Date.now(),
): EngineState | string {
  const bad = requireFinitePositive(stake, "Stake");
  if (bad) return bad;
  if (stake < MIN_BET) return `Minimum ticket is ${MIN_BET} WPIT.`;
  if (stake > MAX_BET) return `House limit ${MAX_BET} WPIT a ticket.`;
  const card = makeCard(kind, now);
  if (card.status !== "open") return "Betting closed. Gates are up.";
  const run = card.runners.find((x) => x.no === runner);
  if (!run) return "No such runner.";
  const games = s.games ?? emptyGames();
  if (s.account.wpit + 1e-9 < stake) return "Not enough WPIT.";
  const due = liability(run.odds, stake);
  const onRunner = games.bets
    .filter((b) => b.raceId === card.id && b.runner === runner && b.status === "open")
    .reduce((a, b) => a + liability(b.odds, b.stake), 0);
  if (due + onRunner > games.vaultWpit * 0.15) return "Book is full on that runner. Cut the stake.";
  const bet: GameBet = {
    id: uid("bet"),
    raceId: card.id,
    kind,
    runner: run.no,
    name: run.name,
    stake,
    odds: run.odds,
    placedAt: now,
    status: "open",
    payout: 0,
  };
  return {
    ...s,
    account: { ...s.account, wpit: s.account.wpit - stake },
    games: {
      ...games,
      vaultWpit: games.vaultWpit + stake,
      bets: [bet, ...games.bets].slice(0, 80),
    },
    fills: [
      {
        id: uid("f"),
        t: s.clock,
        product: "spot" as const,
        symbol: `${card.kind} ${run.name}`,
        side: "bet",
        size: stake,
        price: run.odds,
        fee: 0,
        note: `${fracOdds(run.odds)} · ${card.id}`,
      },
      ...s.fills,
    ].slice(0, 80),
  };
}

export function settleGames(s: EngineState, now = Date.now()): EngineState {
  const games = s.games ?? emptyGames();
  const open = games.bets.filter((b) => b.status === "open");
  if (open.length === 0) return s.games ? s : { ...s, games };
  const cards = new Map<string, RaceCard>();
  let vault = games.vaultWpit;
  let wpit = s.account.wpit;
  let realized = s.account.realized;
  const meets: GameMeet[] = games.meets.slice();
  const fills = s.fills.slice();
  let changed = false;
  const bets = games.bets.map((b) => {
    if (b.status !== "open") return b;
    let card = cards.get(b.raceId);
    if (!card) {
      const start = Number(b.raceId.split("-")[1]);
      const probe = Number.isFinite(start) ? start + POST_AT + RUN_MS + 1 : now;
      card = makeCard(b.kind, probe);
      cards.set(b.raceId, card);
    }
    if (now < card.settleAt) return b;
    changed = true;
    const win = b.runner === card.winner;
    if (!win) return { ...b, status: "lost" as const, payout: 0 };
    const payout = b.stake * b.odds;
    const pay = Math.min(payout, vault);
    vault -= pay;
    wpit += pay;
    realized += pay - b.stake;
    fills.unshift({
      id: uid("f"),
      t: s.clock,
      product: "spot",
      symbol: `${b.kind} ${b.name}`,
      side: "win",
      size: pay,
      price: b.odds,
      fee: 0,
      note: `Official ${card.id} · ${fracOdds(b.odds)}`,
    });
    if (!meets.some((m) => m.raceId === card!.id)) {
      meets.unshift({
        raceId: card.id,
        kind: card.kind,
        winner: card.winner,
        winnerName: card.runners.find((x) => x.no === card!.winner)?.name ?? "",
        paid: pay,
        at: card.settleAt,
      });
    }
    return { ...b, status: "won" as const, payout: pay };
  });
  if (!changed) return s.games ? s : { ...s, games };
  return {
    ...s,
    account: { ...s.account, wpit, realized },
    games: { vaultWpit: Math.max(0, vault), bets, meets: meets.slice(0, 24) },
    fills: fills.slice(0, 80),
  };
}

export function refundOpenBets(s: EngineState): EngineState {
  const games = s.games ?? emptyGames();
  const open = games.bets.filter((b) => b.status === "open");
  if (!open.length) return s.games ? s : { ...s, games };
  const refund = open.reduce((a, b) => a + b.stake, 0);
  return {
    ...s,
    account: { ...s.account, wpit: s.account.wpit + refund },
    games: {
      ...games,
      vaultWpit: Math.max(0, games.vaultWpit - refund),
      bets: games.bets.map((b) => (b.status === "open" ? { ...b, status: "lost" as const, payout: 0 } : b)),
    },
  };
}

export function openTickets(s: EngineState) {
  return (s.games?.bets ?? []).filter((b) => b.status === "open");
}

export function gamesPnl(s: EngineState) {
  const bets = s.games?.bets ?? [];
  let n = 0;
  for (const b of bets) {
    if (b.status === "won") n += b.payout - b.stake;
    else if (b.status === "lost") n -= b.stake;
  }
  return n;
}
