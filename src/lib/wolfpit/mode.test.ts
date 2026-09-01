import test from "node:test";
import assert from "node:assert/strict";
import { MODES, MODE_CHAIN, MODE_COPY, availableModes, modeStatuses, normalizeMode } from "./mode-config";

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

test("the toggle always lists all three modes, ready or not", () => {
  // This is the regression that matters: the selector used to hide modes it
  // could not serve, so a deployment with no Sepolia contracts collapsed to
  // one entry and the toggle rendered NOTHING on every page.
  const nothingDeployed = modeStatuses({});
  assert.deepEqual(nothingDeployed.map((s) => s.mode), ["sim", "testnet", "live"]);
  assert.equal(nothingDeployed.length, MODES.length, "never fewer tabs than modes");
});

test("sim and live are ready with no contracts configured at all", () => {
  const s = modeStatuses({});
  // Live spot runs through the aggregator behind spotQuote and has never
  // needed a vault address. Gating it on VITE_VAULT disabled a working path.
  assert.equal(s.find((x) => x.mode === "live")?.ready, true, "live needs no vault");
  assert.equal(s.find((x) => x.mode === "sim")?.ready, true, "sim needs nothing");
});

test("testnet is shown but not selectable until Sepolia is deployed", () => {
  const before = modeStatuses({}).find((x) => x.mode === "testnet");
  assert.equal(before?.ready, false);
  assert.match(before?.reason ?? "", /not deployed/i, "the reason is legible to a human");

  const V = "0x1234567890abcdef1234567890abcdef12345678";
  const after = modeStatuses({ testnetVault: V }).find((x) => x.mode === "testnet");
  assert.equal(after?.ready, true, "configuring the vault opens the tab");
  assert.equal(after?.reason, undefined);

  // Junk in the env must not open a tab that cannot work.
  assert.equal(modeStatuses({ testnetVault: "not-an-address" }).find((x) => x.mode === "testnet")?.ready, false);
  assert.equal(modeStatuses({ testnetVault: "0x123" }).find((x) => x.mode === "testnet")?.ready, false);
});

test("availableModes lists only what a user may switch into", () => {
  const V = "0x1234567890abcdef1234567890abcdef12345678";
  assert.deepEqual(availableModes({}), ["sim", "live"]);
  assert.deepEqual(availableModes({ testnetVault: V }), ["sim", "testnet", "live"]);
});

test("retiring the testnet is a one-line change", () => {
  // MODES is the single list the UI, the storage restore and the types all
  // read. This test documents the contract so the removal stays trivial.
  assert.deepEqual([...MODES], ["sim", "testnet", "live"]);
  const afterRetirement = MODES.filter((m) => m !== "testnet");
  assert.deepEqual(afterRetirement, ["sim", "live"]);
});
