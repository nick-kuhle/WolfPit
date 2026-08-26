import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialState } from "./engine.ts";
import {
  GAMES_VAULT_SEED,
  OVERROUND_HORSE,
  fieldAt,
  fracOdds,
  makeCard,
  placeBet,
  settleGames,
  slotStart,
} from "./games.ts";

describe("pit racetrack", () => {
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
    const card = makeCard("horse", now);
    const winner = card.winner;
    const loser = card.runners.find((r) => r.no !== winner)!.no;
    const winOdds = card.runners.find((r) => r.no === winner)!.odds;
    const s0 = initialState();
    s0.account.wpit = 5_000;
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
  });

  it("keeps the winner in front at the wire", () => {
    const start = slotStart(2_300_000_000_000, "dog");
    const card = makeCard("dog", start + 1_000);
    const field = fieldAt(card, card.settleAt);
    const first = field.reduce((a, b) => (a.x >= b.x ? a : b));
    assert.equal(first.no, card.winner);
  });
});
