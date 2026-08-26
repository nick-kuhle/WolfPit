import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialState } from "./engine.ts";
import {
  GAMES_VAULT_SEED,
  OVERROUND_HORSE,
  RUN_MS,
  cardFor,
  ensureRace,
  fieldAt,
  fracOdds,
  makeCard,
  placeBet,
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
    assert.equal(Math.abs(h.start - d.start), 30_000);
  });

  it("seals a commit and reveals a matching seed", () => {
    const start = slotStart(2_000_000_000_000, "horse");
    const now = start + 1_000;
    const s = ensureRace(initialState(), "horse", now);
    const fair = s.games?.races?.[cardFor("horse", now, s.games).id];
    assert.ok(fair);
    assert.equal(fair!.commit, sha256Hex(fair!.seed));
    assert.ok(verifyFair({ ...fair! }, 8));
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
        assert.ok(cur[i]!.x + 1e-9 >= prev[i]!.x, `runner ${cur[i]!.no} reversed`);
      }
      prev = cur;
    }
    const field = fieldAt(card, card.settleAt);
    const first = field.reduce((a, b) => (a.x >= b.x ? a : b));
    assert.equal(first.no, card.winner);
    assert.ok(first.x >= 0.99, `winner short of the wire ${first.x}`);
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
});
