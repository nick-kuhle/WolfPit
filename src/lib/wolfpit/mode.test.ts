import test from "node:test";
import assert from "node:assert/strict";
import { MODES, MODE_CHAIN, MODE_COPY, availableModes, normalizeMode } from "./mode-config";

/*
 * The mode selector decides which chain a user's money goes to, so its rules
 * are tested rather than eyeballed.
 */

test("every mode declares a chain and honest copy", () => {
  for (const m of MODES) {
    assert.ok(MODE_CHAIN[m], `${m} has a chain entry`);
    assert.ok(MODE_COPY[m].tab.length > 0, `${m} has a tab label`);
    assert.ok(MODE_COPY[m].banner.length > 0, `${m} has a banner`);
  }
  // The banners must not misdescribe what is at stake.
  assert.match(MODE_COPY.sim.banner, /paper|play/i);
  assert.match(MODE_COPY.testnet.banner, /test/i);
  assert.match(MODE_COPY.testnet.banner, /no real value/i);
  assert.match(MODE_COPY.live.banner, /real funds/i);
  assert.equal(MODE_CHAIN.sim.chainId, null, "sim touches no chain");
  assert.equal(MODE_CHAIN.testnet.chainId, 84532, "Base Sepolia");
  assert.equal(MODE_CHAIN.live.chainId, 8453, "Base mainnet — never L1");
});

test("normalizeMode refuses anything it does not know", () => {
  assert.equal(normalizeMode("live"), "live");
  assert.equal(normalizeMode("testnet"), "testnet");
  assert.equal(normalizeMode("sim"), "sim");
  for (const junk of ["mainnet", "LIVE", "", null, undefined, 1, {}]) {
    assert.equal(normalizeMode(junk), undefined, String(junk));
  }
});

test("a mode whose contracts are not configured is not offered", () => {
  const V = "0x1234567890abcdef1234567890abcdef12345678";
  assert.deepEqual(availableModes({}), ["sim"], "nothing deployed: sim only");
  assert.deepEqual(availableModes({ testnetVault: V }), ["sim", "testnet"]);
  assert.deepEqual(availableModes({ liveVault: V }), ["sim", "live"]);
  assert.deepEqual(availableModes({ testnetVault: V, liveVault: V }), ["sim", "testnet", "live"]);
  // Junk in the env must not open a tab that cannot work.
  assert.deepEqual(availableModes({ testnetVault: "not-an-address" }), ["sim"]);
  assert.deepEqual(availableModes({ liveVault: "0x123" }), ["sim"]);
});

test("retiring the testnet is a one-line change", () => {
  // MODES is the single list the UI, the storage restore and the types all
  // read. This test documents the contract so the removal stays trivial.
  assert.deepEqual([...MODES], ["sim", "testnet", "live"]);
  const afterRetirement = MODES.filter((m) => m !== "testnet");
  assert.deepEqual(afterRetirement, ["sim", "live"]);
});
