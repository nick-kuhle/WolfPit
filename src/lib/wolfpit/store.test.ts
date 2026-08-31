import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { useWolf } from "./store.ts";
import { useAdmin } from "@/lib/admin/config";
import { cardFor, slotStart } from "./games.ts";
import { initialState } from "./engine.ts";

// zustand persist warns about missing localStorage under node — harmless.

const realNow = Date.now;

afterEach(() => {
  Date.now = realNow;
  useAdmin.getState().setGeo(false);
  useWolf.setState({ ...initialState(), lastError: null });
});

describe("store geo-fence (audit §3.6)", () => {
  it("placeRaceBet is blocked while the US geo-fence is on", () => {
    useWolf.setState({ ...initialState(), lastError: null });
    useAdmin.getState().setGeo(true);
    const betsBefore = useWolf.getState().games?.bets.length ?? 0;
    useWolf.getState().placeRaceBet("dog", [1], 10, "win");
    assert.equal(useWolf.getState().lastError, "US geo-fence on. Race betting unavailable.");
    assert.equal(useWolf.getState().games?.bets.length ?? 0, betsBefore, "no ticket written");
  });

  it("race bets flow again once the fence is lifted", () => {
    useAdmin.getState().setGeo(false);
    // Pin the clock just after a slot start so the betting window is
    // deterministically open (no post-time flake).
    const fixed = slotStart(realNow(), "dog") + 1_000;
    Date.now = () => fixed;
    const base = initialState();
    base.account.wpit = 5_000;
    useWolf.setState({ ...base, lastError: null });
    useWolf.getState().seedRaces();
    const card = cardFor("dog", fixed, useWolf.getState().games);
    assert.equal(card.status, "open", "gates open at slot start");
    useWolf.getState().placeRaceBet("dog", [card.places[0]!], 100, "win");
    assert.equal(useWolf.getState().lastError, null);
    assert.equal(useWolf.getState().games?.bets.filter((b) => b.status === "open").length, 1);
  });
});
