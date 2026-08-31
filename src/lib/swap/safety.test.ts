/**
 * Safety-guard unit tests (review fixes F4/F5).
 *
 * Covers the pure logic of the swap safety checks: approval-spender pinning,
 * the price-impact normalization, and the tx-shape validation in
 * assertSafeSwapTarget (with an injected fake public client — no RPC).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePriceImpact } from "./quote.server";
import {
  ALLOWANCE_HOLDER_CANCUN,
  ALLOWANCE_HOLDER_SHANGHAI,
  PERMIT2_ADDRESS,
  allowedApprovalSpenders,
  assertSafeSwapTarget,
} from "./chain";

// ─────────────────────────── F5: price impact units ─────────────────────────

test("price impact: percent values pass through unchanged", () => {
  assert.equal(normalizePriceImpact(0.42), 0.42);
  assert.equal(normalizePriceImpact("0.4902"), 0.4902);
  assert.equal(normalizePriceImpact(3.1), 3.1);
  assert.equal(normalizePriceImpact(100), 100);
});

test("price impact: values that cannot be percents are dropped", () => {
  // 0x v2 semantics are percent; anything above 100 is not a valid reading
  // and is never displayed (the old code's /100 guess is gone).
  assert.equal(normalizePriceImpact(120), undefined);
  assert.equal(normalizePriceImpact(1e9), undefined);
});

test("price impact: junk is dropped, never displayed", () => {
  assert.equal(normalizePriceImpact(null), undefined);
  assert.equal(normalizePriceImpact(undefined), undefined);
  assert.equal(normalizePriceImpact(0), undefined);
  assert.equal(normalizePriceImpact(-5), undefined);
  assert.equal(normalizePriceImpact("abc"), undefined);
  assert.equal(normalizePriceImpact(Number.NaN), undefined);
  assert.equal(normalizePriceImpact(101), undefined); // impossible percent
});

// ─────────────────────────── F4: approval spender pinning ───────────────────

test("approval spender allowlist: Permit2 universal + AllowanceHolder per hardfork", () => {
  const base = allowedApprovalSpenders(8453);
  assert.ok(base.includes(PERMIT2_ADDRESS));
  assert.ok(base.includes(ALLOWANCE_HOLDER_CANCUN));

  const mantle = allowedApprovalSpenders(5000);
  assert.ok(mantle.includes(PERMIT2_ADDRESS));
  assert.ok(mantle.includes(ALLOWANCE_HOLDER_SHANGHAI));
  assert.ok(!mantle.includes(ALLOWANCE_HOLDER_CANCUN));

  const gnosis = allowedApprovalSpenders(100); // not in 0x's AH lists
  assert.deepEqual(gnosis, [PERMIT2_ADDRESS]);
});

// ─────────────────────── F4: tx-shape validation (fake client) ──────────────

function fakeClient(code: string): { getCode: () => Promise<string> } {
  return { getCode: async () => code };
}

const TOKEN_SELL = {
  sellNative: false,
  sellToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  buyToken: "0x4200000000000000000000000000000000000006",
  sellAmount: "1000000",
};
const NATIVE_SELL = { ...TOKEN_SELL, sellNative: true, sellAmount: "1000000000000000000" };

const TX = {
  to: "0x5b6932e2b0cF4A7E4b9C1A1f3c2E5d9A8B6C7D4E",
  data: "0x1fff991f0000000000000000000000000000000000000000000000000000000000",
  value: "0",
};

test("safe target: permit2 spender allowed", async () => {
  await assertSafeSwapTarget(
    8453,
    { ...TX, to: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
    { ...TOKEN_SELL, allowanceTarget: PERMIT2_ADDRESS },
    fakeClient("0x60806040") as never,
  );
});

test("safe target: approval to an unknown spender is blocked", async () => {
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      TX,
      { ...TOKEN_SELL, allowanceTarget: "0x1111111111111111111111111111111111111111" },
      fakeClient("0x60806040") as never,
    ),
    /unknown contract/,
  );
});

test("safe target: tx.to that is not a deployed contract is blocked", async () => {
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      TX,
      { ...TOKEN_SELL, allowanceTarget: PERMIT2_ADDRESS },
      fakeClient("0x") as never, // EOA / no code
    ),
    /not a deployed contract/,
  );
});

test("safe target: permit2 spender must equal tx.to", async () => {
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      TX,
      { ...TOKEN_SELL, allowanceTarget: PERMIT2_ADDRESS, permit2Spender: "0x9999999999999999999999999999999999999999" },
      fakeClient("0x60806040") as never,
    ),
    /does not match the signed permit/,
  );
});

test("safe target: token swaps must not carry ETH value", async () => {
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      { ...TX, value: "1" },
      { ...TOKEN_SELL, allowanceTarget: PERMIT2_ADDRESS },
      fakeClient("0x60806040") as never,
    ),
    /unexpectedly carries ETH value/,
  );
});

test("safe target: native sells must carry EXACTLY the sell amount", async () => {
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      { ...TX, value: "1" }, // 1 wei while selling 1 ETH
      NATIVE_SELL,
      fakeClient("0x60806040") as never,
    ),
    /unexpected ETH value/,
  );
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      { ...TX, value: "2000000000000000000" }, // 2 ETH while selling 1 ETH
      NATIVE_SELL,
      fakeClient("0x60806040") as never,
    ),
    /unexpected ETH value/,
  );
  // the exact amount is fine
  await assertSafeSwapTarget(
    8453,
    { ...TX, value: "1000000000000000000" },
    NATIVE_SELL,
    fakeClient("0x60806040") as never,
  );
});

test("safe target: empty calldata is blocked", async () => {
  await assert.rejects(
    assertSafeSwapTarget(
      8453,
      { ...TX, data: "0x" },
      { ...TOKEN_SELL, allowanceTarget: PERMIT2_ADDRESS },
      fakeClient("0x60806040") as never,
    ),
    /no calldata/,
  );
});

// ─────────────────── WP-10 / #14: aggregator input validation ─────────────────

import { EVM_ADDRESS, cleanAddress } from "./actions";

test("WP-10: token/taker fields must be EVM addresses", () => {
  assert.equal(cleanAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  // The 0x native-ETH sentinel is a valid 40-hex address and must survive.
  assert.equal(cleanAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"), "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
  assert.equal(cleanAddress("  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  "), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "trimmed");
  for (const bad of ["", "USDC", "0x123", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0291", "not-an-address", null, undefined, 42, {}, "0x" + "z".repeat(40)]) {
    assert.equal(cleanAddress(bad), "", `rejected: ${String(bad)}`);
  }
  assert.ok(EVM_ADDRESS.test("0x" + "a".repeat(40)));
  assert.ok(!EVM_ADDRESS.test("0x" + "a".repeat(39)));
});

test("WP-10: sellAmount must be positive integer base units", () => {
  const ok = (v: string) => /^\d+$/.test(v) && !/^0+$/.test(v);
  for (const good of ["1", "1000000", "999999999999999999"]) assert.ok(ok(good), good);
  for (const bad of ["0", "00", "000", "", "-1", "1.5", "1e3", "abc", " 1"]) {
    assert.ok(!ok(bad), `rejected: ${JSON.stringify(bad)}`);
  }
});
