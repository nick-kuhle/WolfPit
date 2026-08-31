import { uid } from "./math";
import { requireFinitePositive } from "./limits";
import { randomHex, sha256Hex } from "./sha256";
import type { BetMarket, EngineState, FairRace } from "./types";
import type { GameBet, GameMeet, GamesState, RaceKind } from "./types";

export const RACE_MS = 120_000;
const POST_AT = 88_000;
export const RUN_MS = 22_000;
export const GAMES_VAULT_SEED = 200_000;
export const MIN_BET = 10;
const MAX_BET = 5_000;
export const OVERROUND_HORSE = 1.14;
const OVERROUND_DOG = 1.12;

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
const COATS = ["blue", "red", "zebra", "leopard", "green", "purple", "orange", "cyan"] as const;
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

/**
 * Weighted winner from the reveal seed: runners win in proportion to their
 * form probability, so the quoted odds (≈ 1/(p·overround)) are FAIR and the
 * house keeps the overround. (The old code drew the winner UNIFORMLY while
 * pricing odds from form — every longshot was +EV against the book.)
 * Deterministic for a given (seed, raceId).
 */
function winnerFromSeed(seed: string, raceId: string, probs: number[]): number {
  const n = probs.length;
  if (n === 0) return 1;
  const x = parseInt(sha256Hex(`${seed}:${raceId}:winner`).slice(0, 8), 16);
  const u = x / 4294967296; // 0..1
  const total = probs.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return (x % n) + 1; // degenerate field — uniform fallback
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += Math.max(0, probs[i]!) / total;
    if (u <= acc || i === n - 1) return i + 1;
  }
  return n;
}

function placesFromSeed(seed: string, raceId: string, probs: number[]) {
  const n = probs.length;
  const winner = winnerFromSeed(seed, raceId, probs);
  const rest: number[] = [];
  for (let i = 1; i <= n; i++) if (i !== winner) rest.push(i);
  const r = rng(parseInt(sha256Hex(`${seed}:${raceId}:order`).slice(0, 8), 16) >>> 0);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return { winner, places: [winner, ...rest] };
}

function applyFair(card: RaceCard, fair?: FairRace | null): RaceCard {
  if (!fair) return card;
  const { winner, places } = placesFromSeed(fair.seed, card.id, card.runners.map((r) => r.form));
  return { ...card, winner, places, commit: fair.commit, seed: fair.seed };
}

function makeFair(kind: RaceKind, id: string, probs: number[]): FairRace {
  const seed = randomHex(32);
  const commit = sha256Hex(seed);
  return { id, kind, seed, commit, winner: winnerFromSeed(seed, id, probs) };
}

export function verifyFair(fair: { seed: string; commit: string; winner: number; id: string }, probs: number[]) {
  if (sha256Hex(fair.seed) !== fair.commit) return false;
  return winnerFromSeed(fair.seed, fair.id, probs) === fair.winner;
}

export function ensureRace(s: EngineState, kind: RaceKind, now = Date.now()): EngineState {
  const card = makeCard(kind, now);
  const games = s.games ?? emptyGames();
  const races = { ...(games.races ?? {}) };
  if (races[card.id]) return s.games ? s : { ...s, games };
  races[card.id] = makeFair(kind, card.id, card.runners.map((r) => r.form));
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

/** Even pace, small wobble. Winner has the highest mean speed; nobody surges then stalls. */
function raceX(t: number, place: number, no: number, seed: number) {
  const tt = Math.min(1, Math.max(0, t));
  const finish = 1 - place * 0.015;
  const r = rng(seed ^ Math.imul(no + 13, 2654435761) ^ Math.imul(place + 7, 1597334677));
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const a1 = 0.07 + r() * 0.05;
  const a2 = 0.03 + r() * 0.03;
  const env = tt * (1 - tt);
  const wobble = a1 * Math.sin(2 * Math.PI * tt + p1) * env + a2 * Math.sin(4 * Math.PI * tt + p2) * env;
  return finish * Math.min(1, Math.max(0, tt + wobble));
}

export function shortHash(hex: string, n = 10) {
  return hex.slice(0, n);
}

function liability(odds: number, stake: number) {
  return stake * Math.max(0, odds - 1);
}

function roundOdds(n: number) {
  return Math.min(120, Math.max(1.15, Math.round(n * 20) / 20));
}

function pWin(card: RaceCard, no: number) {
  const o = card.runners.find((r) => r.no === no)?.odds ?? 10;
  return 1 / Math.max(1.05, o);
}

export function marketOdds(card: RaceCard, market: BetMarket, a: number, b?: number) {
  const run = card.runners.find((r) => r.no === a);
  const win = run?.odds ?? 3;
  if (market === "win") return roundOdds(win);
  if (market === "place") return roundOdds(1 + (win - 1) * 0.38);
  if (market === "show") return roundOdds(1 + (win - 1) * 0.22);
  if ((market === "quinella" || market === "exacta") && b && b !== a) {
    const pa = pWin(card, a);
    const pb = pWin(card, b);
    if (market === "quinella") {
      const pq = pa * (pb / Math.max(0.08, 1 - pa)) + pb * (pa / Math.max(0.08, 1 - pb));
      return roundOdds(1 / Math.max(0.012, pq * 0.88));
    }
    const pe = pa * (pb / Math.max(0.08, 1 - pa));
    return roundOdds(1 / Math.max(0.01, pe * 0.85));
  }
  return roundOdds(win);
}

function ticketHits(b: GameBet, places: number[]) {
  const m = b.market ?? "win";
  const i = places.indexOf(b.runner);
  if (m === "win") return i === 0;
  if (m === "place") return i >= 0 && i <= 1;
  if (m === "show") return i >= 0 && i <= 2;
  if (m === "quinella") {
    const top = new Set(places.slice(0, 2));
    return Boolean(b.runnerB && top.has(b.runner) && top.has(b.runnerB));
  }
  if (m === "exacta") return places[0] === b.runner && places[1] === b.runnerB;
  return false;
}

export function ticketName(card: RaceCard, market: BetMarket, a: number, b?: number) {
  const na = card.runners.find((r) => r.no === a)?.name ?? `#${a}`;
  const nb = b ? card.runners.find((r) => r.no === b)?.name ?? `#${b}` : "";
  if (market === "quinella" && nb) return `${na} / ${nb}`;
  if (market === "exacta" && nb) return `${na} > ${nb}`;
  return na;
}

export const MARKET_HINT: Record<BetMarket, string> = {
  win: "1st only",
  place: "1st or 2nd",
  show: "1st, 2nd or 3rd",
  quinella: "1st and 2nd, any order — tap two, or box three",
  exacta: "1st and 2nd, in order",
};

export function quinellaCombos(picks: number[]): [number, number][] {
  const u = [...new Set(picks.filter((n) => n >= 1))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i < u.length; i++) {
    for (let j = i + 1; j < u.length; j++) out.push([u[i]!, u[j]!]);
  }
  return out;
}

export function placeTickets(
  s: EngineState,
  kind: RaceKind,
  picks: number[],
  stake: number,
  now = Date.now(),
  market: BetMarket = "win",
): EngineState | string {
  if (market === "quinella") {
    const combos = quinellaCombos(picks);
    if (combos.length === 0) return "Pick two runners for the quinella.";
    if (stake < MIN_BET) return `Minimum ticket is ${MIN_BET} WPIT.`;
    if (stake > MAX_BET) return `House limit ${MAX_BET} WPIT a ticket.`;
    const gid = uid("box");
    let cur: EngineState | string = s;
    let left = stake;
    for (let i = 0; i < combos.length; i++) {
      const [a, b] = combos[i]!;
      const per = i === combos.length - 1 ? left : Math.round((stake / combos.length) * 1e6) / 1e6;
      left = Math.round((left - per) * 1e6) / 1e6;
      cur = placeBet(cur as EngineState, kind, a, per, now, "quinella", b, gid);
      if (typeof cur === "string") return cur;
    }
    return cur;
  }
  if (market === "exacta") {
    const a = picks[0];
    const b = picks[1];
    if (!a || !b || a === b) return "Pick 1st and 2nd.";
    return placeBet(s, kind, a, stake, now, "exacta", b);
  }
  const a = picks[0];
  if (!a) return "Pick a runner.";
  return placeBet(s, kind, a, stake, now, market);
}

function cardForBet(b: GameBet, games: GamesState, now = Date.now()): RaceCard {
  const start = Number(String(b.raceId).split("-")[1]);
  const probe = Number.isFinite(start) ? start + POST_AT + RUN_MS / 2 : now;
  return applyFair(makeCard(b.kind, probe), games.races?.[b.raceId]);
}

export function placeBet(
  s: EngineState,
  kind: RaceKind,
  runner: number,
  stake: number,
  now = Date.now(),
  market: BetMarket = "win",
  runnerB?: number,
  groupId?: string,
): EngineState | string {
  const bad = requireFinitePositive(stake, "Stake");
  if (bad) return bad;
  if (market !== "quinella" && stake < MIN_BET) return `Minimum ticket is ${MIN_BET} WPIT.`;
  if (market === "quinella" && stake < 0.01) return "Stake too small.";
  if (stake > MAX_BET) return `House limit ${MAX_BET} WPIT a ticket.`;
  s = ensureRace(s, kind, now);
  const card = cardFor(kind, now, s.games);
  if (card.status !== "open") return "Betting closed. Gates are up.";
  const run = card.runners.find((x) => x.no === runner);
  if (!run) return "No such runner.";
  if (market === "quinella" || market === "exacta") {
    if (!runnerB || runnerB === runner) return "Pick a second runner.";
    if (!card.runners.some((x) => x.no === runnerB)) return "No such runner.";
  }
  const odds = marketOdds(card, market, runner, runnerB);
  const games = s.games ?? emptyGames();
  if (s.account.wpit + 1e-9 < stake) return "Not enough WPIT.";
  const due = liability(odds, stake);
  const onBook = games.bets
    .filter((b) => b.raceId === card.id && b.status === "open")
    .reduce((a, b) => a + liability(b.odds, b.stake), 0);
  if (due + onBook > games.vaultWpit * 0.35) return "Book is full. Cut the stake.";
  const name = ticketName(card, market, runner, runnerB);
  const bet: GameBet = {
    id: uid("bet"),
    raceId: card.id,
    kind,
    runner: run.no,
    runnerB: market === "quinella" || market === "exacta" ? runnerB : undefined,
    name,
    stake,
    odds,
    market,
    placedAt: now,
    status: "open",
    payout: 0,
    groupId,
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
        symbol: `${card.kind} ${name}`,
        side: "bet",
        size: stake,
        price: odds,
        fee: 0,
        note: `${market.toUpperCase()} ${fracOdds(odds)} · ${card.id} · commit ${shortHash(commit)}`,
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
      card = cardForBet(b, games, now);
      cards.set(b.raceId, card);
    }
    if (now < card.settleAt) return b;
    changed = true;
    const hit = ticketHits(b, card.places);
    const fair = games.races?.[card.id];
    const proof = fair ? { raceId: card.id, commit: fair.commit, seed: fair.seed, winner: fair.winner } : undefined;
    if (!hit) {
      const before = { usdc: s.account.usdc, eth: s.account.eth, wpit };
      fills.unshift({
        id: uid("f"),
        t: now,
        product: "spot",
        symbol: `${b.kind} ${b.name}`,
        side: "lose",
        size: b.stake,
        price: b.odds,
        fee: 0,
        pnl: -b.stake,
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
    // Book-insolvency honesty: with fair (form-weighted) winners the house
    // keeps the overround and this should never trigger — but if it ever
    // does, the ticket must SAY it was short-paid, not quietly "won".
    const short = pay < payout - 1e-12;
    fills.unshift({
      id: uid("f"),
      t: now,
      product: "spot",
      symbol: `${b.kind} ${b.name}`,
      side: "win",
      size: pay,
      price: b.odds,
      fee: 0,
      pnl: pay - b.stake,
      note: `Official ${card.id} · ${fracOdds(b.odds)} · seed ${shortHash(fair?.seed ?? "")}${
        short ? ` · BOOK SHORT: paid ${pay.toFixed(2)} of ${payout.toFixed(2)}` : ""
      }`,
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
      // Refunded tickets are NOT "lost" — the stake came back. Dedicated
      // status so the UI can say "refunded" instead of a wall of losses.
      bets: games.bets.map((b) =>
        b.status === "open" ? { ...b, status: "refunded" as const, payout: 0 } : b,
      ),
    },
  };
}

export function openTickets(s: EngineState) {
  return (s.games?.bets ?? []).filter((b) => b.status === "open");
}

export type TicketView = {
  id: string;
  market: BetMarket;
  kind: RaceKind;
  name: string;
  stake: number;
  odds: number;
  status: "open" | "won" | "lost" | "refunded";
  payout: number;
  legs: number;
};

export function groupTickets(bets: GameBet[]): TicketView[] {
  const map = new Map<string, GameBet[]>();
  const order: string[] = [];
  for (const b of bets) {
    const key = b.groupId || b.id;
    const row = map.get(key);
    if (!row) {
      map.set(key, [b]);
      order.push(key);
    } else row.push(b);
  }
  return order.map((key) => {
    const legs = map.get(key)!;
    const stake = legs.reduce((a, b) => a + b.stake, 0);
    const won = legs.filter((b) => b.status === "won");
    const open = legs.some((b) => b.status === "open");
    const refunded = legs.length > 0 && legs.every((b) => b.status === "refunded");
    const payout = won.reduce((a, b) => a + b.payout, 0);
    const status: TicketView["status"] = open ? "open" : won.length ? "won" : refunded ? "refunded" : "lost";
    const names = new Set<string>();
    for (const b of legs) {
      for (const p of b.name.split(/\s*[/|>]\s*/)) {
        const t = p.trim();
        if (t) names.add(t);
      }
    }
    const odds = won[0]?.odds ?? Math.max(...legs.map((b) => b.odds));
    return {
      id: key,
      market: legs[0]!.market ?? "win",
      kind: legs[0]!.kind,
      name: [...names].join(" · ") || legs[0]!.name,
      stake,
      odds,
      status,
      payout,
      legs: legs.length,
    };
  });
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
