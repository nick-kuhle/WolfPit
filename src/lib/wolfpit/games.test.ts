import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialState } from "./engine.ts";
import {
  GAMES_VAULT_SEED,
  OVERROUND_HORSE,
  RACE_MS,
  RUN_MS,
  cardFor,
  ensureRace,
  fieldAt,
  fracOdds,
  groupTickets,
  makeCard,
  placeBet,
  placeTickets,
  refundOpenBets,
  settleGames,
  slotStart,
  verifyFair,
} from "./games.ts";
import { sha256Hex } from "./sha256.ts";

describe("pit racetrack", () => {
  it("sha256 matches a known vector", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("posts a horse card with 8 runners and a loaded book", () => {
    const card = makeCard("horse", slotStart(1_704_000_000_000, "horse") + 1_000);
    assert.equal(card.runners.length, 8);
    assert.equal(card.status, "open");
    const implied = card.runners.reduce((a, r) => a + 1 / r.odds, 0);
    assert.ok(implied > 1.05, `book ${implied}`);
    assert.ok(implied < OVERROUND_HORSE + 0.12);
    for (const r of card.runners) {
      assert.ok(r.odds >= 1.2 && r.odds <= 50);
      assert.ok(fracOdds(r.odds).length > 0);
    }
  });

  it("staggers dogs by half a cycle", () => {
    const t = 1_704_000_000_000;
    const h = makeCard("horse", t);
    const d = makeCard("dog", t);
    assert.notEqual(h.start, d.start);
    assert.equal(Math.abs(h.start - d.start), RACE_MS / 2);
  });

  it("seals a commit and reveals a matching seed", () => {
    const start = slotStart(2_000_000_000_000, "horse");
    const now = start + 1_000;
    const s = ensureRace(initialState(), "horse", now);
    const card = cardFor("horse", now, s.games);
    const fair = s.games?.races?.[card.id];
    assert.ok(fair);
    assert.equal(fair!.commit, sha256Hex(fair!.seed));
    assert.ok(verifyFair({ ...fair! }, card.runners.map((r) => r.form)));
  });

  it("takes a ticket from WPIT into the games vault", () => {
    const start = slotStart(2_000_000_000_000, "horse");
    const now = start + 1_000;
    const card = makeCard("horse", now);
    const s = initialState();
    s.account.wpit = 1_000;
    const r = placeBet(s, "horse", card.runners[0]!.no, 100, now);
    assert.equal(typeof r, "object");
    if (typeof r === "string") throw new Error(r);
    assert.equal(r.account.wpit, 900);
    assert.equal(r.games?.vaultWpit, GAMES_VAULT_SEED + 100);
    assert.equal(r.games?.bets[0]?.status, "open");
    assert.equal(r.games?.bets[0]?.stake, 100);
    assert.equal(r.fills[0]?.before?.wpit, 1_000);
    assert.equal(r.fills[0]?.after?.wpit, 900);
    assert.ok(r.fills[0]?.fair?.commit);
  });

  it("rejects a bet after post", () => {
    const start = slotStart(2_100_000_000_000, "horse");
    const card = makeCard("horse", start + 1_000);
    const s = initialState();
    s.account.wpit = 1_000;
    const r = placeBet(s, "horse", 1, 100, card.postAt + 10);
    assert.equal(typeof r, "string");
  });

  it("pays a winner from the vault and keeps a loser", () => {
    const start = slotStart(2_200_000_000_000, "horse");
    const now = start + 1_000;
    let s0 = initialState();
    s0.account.wpit = 5_000;
    s0 = ensureRace(s0, "horse", now);
    const card = cardFor("horse", now, s0.games);
    const winner = card.winner;
    const loser = card.runners.find((r) => r.no !== winner)!.no;
    const winOdds = card.runners.find((r) => r.no === winner)!.odds;
    const a = placeBet(s0, "horse", winner, 100, now);
    assert.equal(typeof a, "object");
    if (typeof a === "string") throw new Error(a);
    const b = placeBet(a, "horse", loser, 100, now);
    assert.equal(typeof b, "object");
    if (typeof b === "string") throw new Error(b);
    assert.equal(b.account.wpit, 4_800);
    const done = settleGames(b, card.settleAt + 50);
    const win = done.games?.bets.find((x) => x.runner === winner);
    const lost = done.games?.bets.find((x) => x.runner === loser);
    assert.equal(win?.status, "won");
    assert.equal(lost?.status, "lost");
    assert.ok(Math.abs((win?.payout ?? 0) - 100 * winOdds) < 1e-6);
    assert.equal(done.account.wpit, 4_800 + 100 * winOdds);
    const vault = done.games!.vaultWpit;
    assert.ok(vault < GAMES_VAULT_SEED + 200);
    assert.ok(vault > 0);
    assert.ok(done.fills[0]?.fair?.seed);
  });

  it("paces stay even — no surge then stall", () => {
    for (let k = 0; k < 8; k++) {
      const now = 3_500_000_000_000 + k * 120_000 + 1_000;
      const s = ensureRace(initialState(), "horse", now);
      const card = cardFor("horse", now, s.games);
      const a = fieldAt(card, card.postAt + RUN_MS * 0.33);
      const b = fieldAt(card, card.postAt + RUN_MS * 0.66);
      const c = fieldAt(card, card.settleAt);
      for (let i = 0; i < a.length; i++) {
        const x1 = a[i]!.x;
        const x2 = b[i]!.x;
        const x3 = c[i]!.x;
        assert.ok(x1 > 0.22 && x1 < 0.48, `early surge/lag ${a[i]!.no} ${x1}`);
        assert.ok(x2 > 0.5 && x2 < 0.82, `mid surge/lag ${b[i]!.no} ${x2}`);
        const d1 = x1;
        const d2 = x2 - x1;
        const d3 = x3 - x2;
        assert.ok(d1 / d3 < 2.4 && d3 / d1 < 2.4, `uneven thirds ${a[i]!.no} ${d1} ${d2} ${d3}`);
        assert.ok(d2 / d1 < 2.2 && d1 / d2 < 2.2, `mid lurch ${a[i]!.no}`);
      }
    }
  });

  it("never moves a runner backward and winner is first at the wire", () => {
    const start = slotStart(2_300_000_000_000, "dog");
    const now = start + 1_000;
    const s = ensureRace(initialState(), "dog", now);
    const card = cardFor("dog", now, s.games);
    let prev = fieldAt(card, card.postAt);
    for (let k = 1; k <= 40; k++) {
      const t = card.postAt + (k / 40) * RUN_MS;
      const cur = fieldAt(card, t);
      for (let i = 0; i < cur.length; i++) {
        const dx = cur[i]!.x - prev[i]!.x;
        assert.ok(dx + 1e-9 >= 0, `runner ${cur[i]!.no} reversed`);
        if (k < 40) assert.ok(dx > 0.0015, `runner ${cur[i]!.no} stalled ${dx}`);
      }
      prev = cur;
    }
    const field = fieldAt(card, card.settleAt);
    const first = field.reduce((a, b) => (a.x >= b.x ? a : b));
    assert.equal(first.no, card.winner);
    assert.ok(first.x >= 0.99, `winner short of the wire ${first.x}`);
  });

  it("changes the lead during the race", () => {
    let swaps = 0;
    for (let k = 0; k < 12; k++) {
      const now = 3_400_000_000_000 + k * 120_000 + 1_000;
      const s = ensureRace(initialState(), "horse", now);
      const card = cardFor("horse", now, s.games);
      const a = [...fieldAt(card, card.postAt + RUN_MS * 0.28)].sort((x, y) => y.x - x.x)[0]!;
      const b = [...fieldAt(card, card.postAt + RUN_MS * 0.72)].sort((x, y) => y.x - x.x)[0]!;
      if (a.no !== b.no) swaps += 1;
    }
    assert.ok(swaps >= 3, `lead never changed ${swaps}/12`);
  });

  it("does not always leave the winner last at mid-race", () => {
    let last = 0;
    for (let k = 0; k < 20; k++) {
      const now = 3_100_000_000_000 + k * 60_000 + 1_000;
      const s = ensureRace(initialState(), "horse", now);
      const card = cardFor("horse", now, s.games);
      const mid = fieldAt(card, card.postAt + RUN_MS * 0.45);
      const rank = [...mid].sort((a, b) => b.x - a.x).findIndex((r) => r.no === card.winner);
      if (rank >= mid.length - 2) last += 1;
    }
    assert.ok(last < 16, `winner parked last ${last}/20`);
  });

  it("pays place on second and quinella on the exact pair", () => {
    const start = slotStart(2_400_000_000_000, "horse");
    const now = start + 1_000;
    let s0 = initialState();
    s0.account.wpit = 5_000;
    s0 = ensureRace(s0, "horse", now);
    const card = cardFor("horse", now, s0.games);
    const first = card.places[0]!;
    const second = card.places[1]!;
    const third = card.places[2]!;
    const a = placeBet(s0, "horse", second, 100, now, "place");
    assert.equal(typeof a, "object");
    if (typeof a === "string") throw new Error(a);
    const b = placeBet(a, "horse", first, 100, now, "quinella", second);
    assert.equal(typeof b, "object");
    if (typeof b === "string") throw new Error(b);
    const c = placeBet(b, "horse", third, 100, now, "show");
    assert.equal(typeof c, "object");
    if (typeof c === "string") throw new Error(c);
    const d = placeBet(c, "horse", second, 100, now, "exacta", first);
    assert.equal(typeof d, "object");
    if (typeof d === "string") throw new Error(d);
    const done = settleGames(d, card.settleAt + 50);
    const place = done.games?.bets.find((x) => x.market === "place");
    const q = done.games?.bets.find((x) => x.market === "quinella");
    const show = done.games?.bets.find((x) => x.market === "show");
    const ex = done.games?.bets.find((x) => x.market === "exacta");
    assert.equal(place?.status, "won");
    assert.equal(q?.status, "won");
    assert.equal(show?.status, "won");
    assert.equal(ex?.status, "lost");
  });

  it("boxes a 3-horse quinella into three tickets and pays the hitting pair", () => {
    const start = slotStart(2_500_000_000_000, "horse");
    const now = start + 1_000;
    let s0 = initialState();
    s0.account.wpit = 5_000;
    s0 = ensureRace(s0, "horse", now);
    const card = cardFor("horse", now, s0.games);
    const a = card.places[0]!;
    const b = card.places[1]!;
    const c = card.places[3]!;
    const r = placeTickets(s0, "horse", [a, b, c], 100, now, "quinella");
    assert.equal(typeof r, "object");
    if (typeof r === "string") throw new Error(r);
    assert.ok(Math.abs(r.account.wpit - 4_900) < 1e-6);
    assert.equal(r.games?.bets.filter((x) => x.status === "open").length, 3);
    const gids = new Set(r.games?.bets.map((x) => x.groupId));
    assert.equal(gids.size, 1);
    assert.equal(groupTickets(r.games?.bets ?? []).filter((t) => t.market === "quinella").length, 1);
    const view = groupTickets(r.games?.bets ?? []).find((t) => t.market === "quinella");
    assert.ok(view);
    assert.ok(Math.abs((view?.stake ?? 0) - 100) < 1e-6);
    assert.equal(view?.legs, 3);
    const legs = r.games?.bets.filter((x) => x.market === "quinella") ?? [];
    const spent = legs.reduce((a, b) => a + b.stake, 0);
    assert.ok(Math.abs(spent - 100) < 1e-6);
    const done = settleGames(r, card.settleAt + 50);
    const wins = done.games?.bets.filter((x) => x.market === "quinella" && x.status === "won") ?? [];
    const lost = done.games?.bets.filter((x) => x.market === "quinella" && x.status === "lost") ?? [];
    assert.equal(wins.length, 1);
    assert.equal(lost.length, 2);
    const hit = wins[0]!;
    const top = new Set([a, b]);
    assert.ok(top.has(hit.runner) && hit.runnerB && top.has(hit.runnerB));
    assert.ok(done.account.wpit > 4_900);
    assert.ok(Math.abs(done.account.wpit - (4_900 + hit.payout)) < 1e-6);
  });

  it("credits WPIT on a late settle after the next card has started", () => {
    const start = slotStart(2_600_000_000_000, "horse");
    const now = start + 1_000;
    let s0 = initialState();
    s0.account.wpit = 1_000;
    s0 = ensureRace(s0, "horse", now);
    const card = cardFor("horse", now, s0.games);
    const r = placeBet(s0, "horse", card.winner, 100, now, "win");
    assert.equal(typeof r, "object");
    if (typeof r === "string") throw new Error(r);
    const done = settleGames(r, card.settleAt + RACE_MS + 5_000);
    const win = done.games?.bets.find((x) => x.id === r.games?.bets[0]?.id);
    assert.equal(win?.status, "won");
    assert.ok(done.account.wpit > 900);
    assert.ok(Math.abs(done.account.wpit - (900 + (win?.payout ?? 0))) < 1e-6);
  });

  it("draws winners weighted by form, not uniform", () => {
    // Each card re-seeds its field, so track the ACTUAL form favorite per
    // race. Over many seeds the favorite's observed win rate must track its
    // form share and sit far above the uniform 1/8 baseline — the pre-fix
    // uniform draw failed this by construction.
    const n = 4_000;
    let favWins = 0;
    let expFav = 0;
    for (let k = 0; k < n; k++) {
      const now = 4_000_000_000_000 + k;
      const s = ensureRace(initialState(), "horse", now);
      const card = cardFor("horse", now, s.games);
      const forms = card.runners.map((r) => r.form);
      const sum = forms.reduce((a, b) => a + b, 0);
      const fav = forms.indexOf(Math.max(...forms));
      expFav += forms[fav]! / sum;
      if (card.winner === fav + 1) favWins += 1;
      const fair = s.games?.races?.[card.id];
      assert.ok(fair && verifyFair({ ...fair }, forms));
    }
    const obs = favWins / n;
    const exp = expFav / n;
    assert.ok(Math.abs(obs - exp) < 0.04, `favorite ${obs} vs expected ${exp}`);
    assert.ok(obs > 0.16, `favorite ${obs} — uniform baseline is 1/8`);
  });

  it("refunds open stakes as refunded, not lost", () => {
    const start = slotStart(2_700_000_000_000, "horse");
    const now = start + 1_000;
    let s0 = initialState();
    s0.account.wpit = 1_000;
    s0 = ensureRace(s0, "horse", now);
    const card = cardFor("horse", now, s0.games);
    const r = placeBet(s0, "horse", card.runners[0]!.no, 100, now);
    assert.equal(typeof r, "object");
    if (typeof r === "string") throw new Error(r);
    const refunded = refundOpenBets(r);
    assert.equal(refunded.games?.bets[0]?.status, "refunded");
    assert.equal(refunded.games?.bets[0]?.payout, 0);
    assert.ok(Math.abs(refunded.account.wpit - 1_000) < 1e-6);
    assert.ok(Math.abs((refunded.games?.vaultWpit ?? 0) - GAMES_VAULT_SEED) < 1e-6);
    const view = groupTickets(refunded.games?.bets ?? [])[0];
    assert.equal(view?.status, "refunded");
    assert.ok(Math.abs((view?.stake ?? 0) - 100) < 1e-6);
  });

  it("marks a short-paid winner honestly (BOOK SHORT note)", () => {
    const start = slotStart(2_800_000_000_000, "horse");
    const now = start + 1_000;
    let s0 = initialState();
    s0.account.wpit = 5_000;
    s0 = ensureRace(s0, "horse", now);
    const card = cardFor("horse", now, s0.games);
    const r = placeBet(s0, "horse", card.winner, 100, now);
    assert.equal(typeof r, "object");
    if (typeof r === "string") throw new Error(r);
    // Drain the book: only 10 WPIT left to pay a ~200 stake×odds ticket.
    const drained = { ...r, games: { ...r.games!, vaultWpit: 10 } };
    const done = settleGames(drained, card.settleAt + 50);
    const win = done.games?.bets[0];
    assert.ok(win, "bet settled");
    assert.equal(win!.status, "won");
    assert.equal(win.payout, 10);
    const note = done.fills.find((f) => f.symbol.includes(card.runners.find((x) => x.no === card.winner)!.name))?.note ?? "";
    assert.ok(note.includes("BOOK SHORT"), note);
    assert.ok(note.includes("paid 10.00 of"), note);
    assert.ok(Math.abs(done.account.wpit - 4_910) < 1e-6);
  });
});
