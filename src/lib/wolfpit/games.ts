import { uid } from "./math";
import { requireFinitePositive } from "./limits";
import { randomHex, sha256Hex } from "./sha256";
import type { EngineState, FairRace } from "./types";
import type { GameBet, GameMeet, GamesState, RaceKind } from "./types";

export const RACE_MS = 60_000;
export const POST_AT = 38_000;
export const RUN_MS = 18_000;
export const GAMES_VAULT_SEED = 200_000;
export const MIN_BET = 10;
export const MAX_BET = 5_000;
export const OVERROUND_HORSE = 1.14;
export const OVERROUND_DOG = 1.12;

const HORSES = [
  "Hot to Trot", "Lady Godiva", "Bareback", "Slow Hands", "Velvet Rope",
  "Midnight Heat", "Come Hither", "Silk Sheets", "Last Call", "Red Light",
  "Sugar Daddy", "Night Nurse", "Bad Influence", "French Kiss", "Pit Tease",
  "Loose Cannon", "After Hours", "Dirty Martini", "Low Cut", "On the House",
  "Sweet Spot", "Fast Company", "No Panties", "Bedroom Eyes", "Sin Tax",
  "Open Kimono", "Lap Dance", "Honey Trap", "Backseat", "Whiskey Dick",
  "Easy Virtue", "She Bites", "Full Monty", "Tease the Wire", "Pink Slip",
  "One Night", "Heat Check", "Unbuttoned", "Call Girl", "Wolf Whistle",
];

const DOGS = [
  "Bad Bitch", "Fast Tail", "Hot Mess", "Lickety Split", "Trouble",
  "Nasty Habit", "Sugar Fang", "Heat Wave", "Side Piece", "Pony Play",
  "Bite Me", "Red Collar", "Night Howl", "Slick", "Tramp Stamp",
  "Underdog", "Filthy Rich", "Kiss Kiss", "Wrecked", "Saliva",
  "Tease", "Muzzle Me", "Quickie", "All Night",
];

const TRAINERS = [
  "Vic Moretti", "Sable Quinn", "Hank Devereaux", "Lola Finch", "Cal Rourke",
  "Nico Vane", "Maeve Brass", "Jules Hart", "Rio Santos", "Wren Hollow",
  "Dex Lang", "Ivy Crowe",
];

const BARNS = [
  "Pit & Paddock", "Brass Stables", "Night Rail", "Curb Club", "Wolf Barn",
  "Ticket Yard", "Open Outcry", "Red Board",
];

const SILKS = ["#2563eb", "#dc2626", "#e6e2d6", "#d4a017", "#22c55e", "#7c3aed", "#f97316", "#22d3ee"];
export const COATS = ["blue", "red", "zebra", "leopard", "rainbow", "gold", "green", "purple"] as const;
export type Coat = (typeof COATS)[number];

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
  trainer: string;
  barn: string;
  coat: Coat;
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
  commit?: string;
  seed?: string;
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
  return { vaultWpit: GAMES_VAULT_SEED, bets: [], meets: [], races: {} };
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
    return {
      no: i + 1,
      name: pool[i]!,
      odds,
      silk: SILKS[i]!,
      form: f,
      trainer: TRAINERS[Math.floor(r() * TRAINERS.length)]!,
      barn: BARNS[Math.floor(r() * BARNS.length)]!,
      coat: COATS[i]!,
    };
  });
  const postAt = start + POST_AT;
  const settleAt = postAt + RUN_MS;
  const nextAt = start + RACE_MS;
  let status: RaceCard["status"] = "open";
  if (now >= settleAt) status = "official";
  else if (now >= postAt) status = "running";
  const nos = runners.map((x) => x.no);
  return { id, kind, start, postAt, settleAt, nextAt, runners, places: nos, winner: nos[0]!, status };
}

export function placesFromSeed(seed: string, raceId: string, n: number) {
  const winner = winnerFromSeed(seed, raceId, n);
  const rest: number[] = [];
  for (let i = 1; i <= n; i++) if (i !== winner) rest.push(i);
  const r = rng(parseInt(sha256Hex(`${seed}:${raceId}:order`).slice(0, 8), 16) >>> 0);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return { winner, places: [winner, ...rest] };
}

export function winnerFromSeed(seed: string, raceId: string, n: number) {
  const x = parseInt(sha256Hex(`${seed}:${raceId}:winner`).slice(0, 8), 16);
  return (x % n) + 1;
}

export function applyFair(card: RaceCard, fair?: FairRace | null): RaceCard {
  if (!fair) return card;
  const { winner, places } = placesFromSeed(fair.seed, card.id, card.runners.length);
  return { ...card, winner, places, commit: fair.commit, seed: fair.seed };
}

export function makeFair(kind: RaceKind, id: string, n: number): FairRace {
  const seed = randomHex(32);
  const commit = sha256Hex(seed);
  return { id, kind, seed, commit, winner: winnerFromSeed(seed, id, n) };
}

export function verifyFair(fair: { seed: string; commit: string; winner: number; id: string }, n: number) {
  if (sha256Hex(fair.seed) !== fair.commit) return false;
  return winnerFromSeed(fair.seed, fair.id, n) === fair.winner;
}

export function ensureRace(s: EngineState, kind: RaceKind, now = Date.now()): EngineState {
  const card = makeCard(kind, now);
  const games = s.games ?? emptyGames();
  const races = { ...(games.races ?? {}) };
  if (races[card.id]) return s.games ? s : { ...s, games };
  races[card.id] = makeFair(kind, card.id, card.runners.length);
  return { ...s, games: { ...games, races } };
}

export function ensureRaces(s: EngineState, now = Date.now()): EngineState {
  return ensureRace(ensureRace(s, "horse", now), "dog", now);
}

export function cardFor(kind: RaceKind, now: number, games?: GamesState | null): RaceCard {
  const card = makeCard(kind, now);
  return applyFair(card, games?.races?.[card.id]);
}

export function fieldAt(card: RaceCard, now: number) {
  const t = Math.min(1, Math.max(0, (now - card.postAt) / RUN_MS));
  return card.runners.map((r) => {
    const place = Math.max(0, card.places.indexOf(r.no));
    const x = raceX(t, place, r.no, hash(card.id + (card.seed ?? "")));
    return { ...r, x, place };
  });
}

/** Strictly increasing. Pattern is unique per runner/race — winner is not always last. */
export function raceX(t: number, place: number, no: number, seed: number) {
  const tt = Math.min(1, Math.max(0, t));
  const finish = 0.86 - place * 0.03;
  const r = rng(seed ^ Math.imul(no + 1, 2654435761));
  const p = 0.4 + r() * 2.4;
  const knots = 7;
  const ys: number[] = [0];
  for (let i = 1; i < knots; i++) {
    const u = i / knots;
    const mix = 0.45 * r() + 0.55 * Math.pow(u, p);
    const y = finish * mix;
    const prev = ys[ys.length - 1]!;
    ys.push(Math.max(prev + finish * 0.012, Math.min(finish * 0.97, y)));
  }
  ys.push(finish);
  const x = tt * knots;
  const i = Math.min(knots - 1, Math.floor(x));
  const local = x - i;
  const s = local * local * (3 - 2 * local);
  return ys[i]! + (ys[i + 1]! - ys[i]!) * s;
}

export function shortHash(hex: string, n = 10) {
  return hex.slice(0, n);
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
  s = ensureRace(s, kind, now);
  const card = cardFor(kind, now, s.games);
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
  const before = { usdc: s.account.usdc, eth: s.account.eth, wpit: s.account.wpit };
  const after = { ...before, wpit: before.wpit - stake };
  const commit = card.commit ?? games.races?.[card.id]?.commit ?? "";
  return {
    ...s,
    account: { ...s.account, wpit: after.wpit },
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
        note: `${fracOdds(run.odds)} · ${card.id} · commit ${shortHash(commit)}`,
        before,
        after,
        fair: { raceId: card.id, commit },
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
      card = applyFair(makeCard(b.kind, probe), games.races?.[b.raceId]);
      cards.set(b.raceId, card);
    }
    if (now < card.settleAt) return b;
    changed = true;
    const win = b.runner === card.winner;
    const fair = games.races?.[card.id];
    const proof = fair ? { raceId: card.id, commit: fair.commit, seed: fair.seed, winner: fair.winner } : undefined;
    if (!win) {
      const before = { usdc: s.account.usdc, eth: s.account.eth, wpit };
      fills.unshift({
        id: uid("f"),
        t: s.clock,
        product: "spot",
        symbol: `${b.kind} ${b.name}`,
        side: "lose",
        size: b.stake,
        price: b.odds,
        fee: 0,
        note: `Official ${card.id} · seed ${shortHash(fair?.seed ?? "")}`,
        before,
        after: before,
        fair: proof,
      });
      return { ...b, status: "lost" as const, payout: 0 };
    }
    const payout = b.stake * b.odds;
    const pay = Math.min(payout, vault);
    const before = { usdc: s.account.usdc, eth: s.account.eth, wpit };
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
      note: `Official ${card.id} · ${fracOdds(b.odds)} · seed ${shortHash(fair?.seed ?? "")}`,
      before,
      after: { ...before, wpit },
      fair: proof,
    });
    if (!meets.some((m) => m.raceId === card!.id)) {
      meets.unshift({
        raceId: card.id,
        kind: card.kind,
        winner: card.winner,
        winnerName: card.runners.find((x) => x.no === card!.winner)?.name ?? "",
        paid: pay,
        at: card.settleAt,
        commit: fair?.commit,
        seed: fair?.seed,
      });
    }
    return { ...b, status: "won" as const, payout: pay };
  });
  if (!changed) return s.games ? s : { ...s, games };
  return {
    ...s,
    account: { ...s.account, wpit, realized },
    games: { ...games, vaultWpit: Math.max(0, vault), bets, meets: meets.slice(0, 24) },
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
