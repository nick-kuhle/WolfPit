import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  buildApprove,
  buildMint,
  buildPoolAdd,
  buildSetPrice,
  devControlsAvailable,
  parseAmount,
} from "./dev-controls";

const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const DEV = "0x3333333333333333333333333333333333333333";
const ORACLE = "0x4444444444444444444444444444444444444444";

/*
 * These builders produce calldata that mints money. The point of keeping them
 * pure is that the dangerous decisions - which chain, which selector, which
 * decimals - can be asserted here rather than discovered in a wallet popup.
 */

test("dev controls do not exist on mainnet", () => {
  assert.equal(devControlsAvailable(BASE_MAINNET), false);
  assert.equal(devControlsAvailable(1), false, "not on L1 either");
  assert.equal(devControlsAvailable(null), false);
  assert.equal(devControlsAvailable(undefined), false);
  assert.equal(devControlsAvailable(BASE_SEPOLIA), true);
});

test("every builder refuses on mainnet, by name", () => {
  const onMainnet = [
    buildMint({ chainId: BASE_MAINNET, token: TOKEN, to: DEV, amount: "100", decimals: 6, symbol: "USDC" }),
    buildApprove({ chainId: BASE_MAINNET, token: TOKEN, spender: POOL, amount: "100", decimals: 6, symbol: "USDC" }),
    buildPoolAdd({ chainId: BASE_MAINNET, pool: POOL, amount0: "1", amount1: "1", decimals0: 18, decimals1: 6, nowSec: 1_800_000_000 }),
    buildSetPrice({ chainId: BASE_MAINNET, oracle: ORACLE, usdPerEth: "4000" }),
  ];
  for (const r of onMainnet) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /mainnet/i, "the refusal says why");
  }
});

test("mint encodes the right selector, recipient and decimals", () => {
  const r = buildMint({ chainId: BASE_SEPOLIA, token: TOKEN, to: DEV, amount: "1000.5", decimals: 6, symbol: "tUSDC" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.call.to, TOKEN);
  // mint(address,uint256)
  assert.equal(r.call.data.slice(0, 10), "0x40c10f19");
  assert.ok(r.call.data.toLowerCase().includes(DEV.slice(2).toLowerCase()), "recipient is in the calldata");
  // 1000.5 * 1e6 = 1_000_500_000 = 0x3BA26B20
  assert.ok(r.call.data.endsWith("3ba26b20"), `amount uses 6 decimals: ${r.call.data}`);
});

test("the same amount encodes differently for 18-decimal tokens", () => {
  const six = buildMint({ chainId: BASE_SEPOLIA, token: TOKEN, to: DEV, amount: "1", decimals: 6, symbol: "tUSDC" });
  const eighteen = buildMint({ chainId: BASE_SEPOLIA, token: TOKEN, to: DEV, amount: "1", decimals: 18, symbol: "tWETH" });
  assert.equal(six.ok && eighteen.ok, true);
  if (!six.ok || !eighteen.ok) return;
  assert.notEqual(six.call.data, eighteen.call.data, "decimals are not assumed");
});

test("amounts a human typed wrong never become calldata", () => {
  const bad = ["", "  ", "-5", "1e9", "abc", "0", "0.0", "1.2.3", "999999999999"];
  for (const amount of bad) {
    const r = buildMint({ chainId: BASE_SEPOLIA, token: TOKEN, to: DEV, amount, decimals: 6, symbol: "tUSDC" });
    assert.equal(r.ok, false, `rejected: ${JSON.stringify(amount)}`);
  }
  // More decimals than the token has would silently truncate value.
  const tooPrecise = parseAmount("1.1234567", 6);
  assert.equal(tooPrecise.ok, false);
  if (!tooPrecise.ok) assert.match(tooPrecise.error, /6 decimals/);
});

test("an unconfigured contract address is refused, not encoded", () => {
  for (const token of [undefined, "", "0x0", "not-an-address"]) {
    const r = buildMint({ chainId: BASE_SEPOLIA, token, to: DEV, amount: "1", decimals: 6, symbol: "tUSDC" });
    assert.equal(r.ok, false, String(token));
    if (!r.ok) assert.match(r.error, /not configured/i);
  }
  const badTo = buildMint({ chainId: BASE_SEPOLIA, token: TOKEN, to: "0xdead", amount: "1", decimals: 6, symbol: "tUSDC" });
  assert.equal(badTo.ok, false, "a malformed recipient is refused too");
});

test("approvals are bounded to the amount, never unlimited", () => {
  const r = buildApprove({ chainId: BASE_SEPOLIA, token: TOKEN, spender: POOL, amount: "250", decimals: 6, symbol: "tUSDC" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.call.data.slice(0, 10), "0x095ea7b3", "approve(address,uint256)");
  const MAX_UINT = "f".repeat(64);
  assert.ok(!r.call.data.toLowerCase().includes(MAX_UINT), "no type(uint256).max allowance");
  // 250 * 1e6 = 250_000_000 = 0xEE6B280
  assert.ok(r.call.data.endsWith("0ee6b280"), r.call.data);
});

test("pool adds carry a real deadline", () => {
  const now = 1_800_000_000;
  const r = buildPoolAdd({ chainId: BASE_SEPOLIA, pool: POOL, amount0: "1", amount1: "4000", decimals0: 18, decimals1: 6, nowSec: now });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const deadlineWord = r.call.data.slice(-64);
  const deadline = BigInt("0x" + deadlineWord);
  assert.equal(deadline, BigInt(now + 900), "default 15 minute ttl");
  assert.notEqual(deadlineWord, "f".repeat(64), "never type(uint256).max");
  const custom = buildPoolAdd({ chainId: BASE_SEPOLIA, pool: POOL, amount0: "1", amount1: "1", decimals0: 18, decimals1: 6, nowSec: now, ttlSec: 60 });
  assert.equal(custom.ok, true);
  if (custom.ok) assert.equal(BigInt("0x" + custom.call.data.slice(-64)), BigInt(now + 60));
});

test("oracle price is bounded on both sides", () => {
  const ok = buildSetPrice({ chainId: BASE_SEPOLIA, oracle: ORACLE, usdPerEth: "4000" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.call.data.slice(0, 10), "0x91b7f5ed", "setPrice(uint256)");
    // 4000 * 1e6 = 4_000_000_000 = 0xEE6B2800
    assert.ok(ok.call.data.endsWith("ee6b2800"), ok.call.data);
  }
  for (const p of ["0", "0.5", "2000000", "-1", ""]) {
    assert.equal(buildSetPrice({ chainId: BASE_SEPOLIA, oracle: ORACLE, usdPerEth: p }).ok, false, p);
  }
});

test("every built call is labelled for the confirmation prompt", () => {
  const r = buildMint({ chainId: BASE_SEPOLIA, token: TOKEN, to: DEV, amount: "500", decimals: 18, symbol: "WPIT" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.call.label, "Mint 500 WPIT", "the operator sees what they are signing");
});
