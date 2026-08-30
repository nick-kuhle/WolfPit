import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  advanceClock,
  buyOption,
  closeFuture,
  expiries,
  initialState,
  setMark,
  spreadBps,
  tradeFuture,
} from "./engine.ts";
import type { EngineState } from "./types.ts";

const outDir = new URL("../../../docs/drills/", import.meta.url);

function writeReport(name: string, body: string) {
  mkdirSync(outDir, { recursive: true });
  // Stamp every report so staleness is detectable: these files are generator
  // output, re-written by each `npm run test:engine` run.
  const stamp = `> Generated ${new Date().toISOString().slice(0, 10)} by \`npm run test:engine\`. Re-run to refresh after engine changes.\n\n`;
  writeFileSync(new URL(name, outDir), body.replace("\n\n", `\n\n${stamp}`));
}

function expOf(s: EngineState) {
  return expiries(s.clock)[0]!.at;
}

function asState(r: EngineState | string, ctx: string): EngineState {
  assert.equal(typeof r, "object", `${ctx}: ${String(r)}`);
  return r as EngineState;
}

describe("W1-03 recorded drills", () => {
  it("D1 −20% / 1h, delayed keepers 2 min", () => {
    let s = initialState();
    const startUsdc = s.vault.usdc;
    s = asState(tradeFuture(s, "long", 20, expOf(s)), "open long 2 ETH");
    s = setMark(s, s.eth * 0.8, { settle: false });
    assert.equal(s.futures.length, 1, "keepers delayed: still open");
    s = advanceClock(s, 2 * 60_000);
    assert.ok(s.liquidations >= 1);
    assert.equal(s.futures.length, 0);
    assert.ok(s.insuranceUsdc >= 0);
    assert.ok(s.vault.eth >= s.vault.reservedEth);
    const drop = startUsdc - s.vault.usdc;
    writeReport(
      "D1.md",
      `# D1 −20% / delayed keepers\n\n- Longs liquidated: ${s.liquidations}\n- Insurance: ${s.insuranceUsdc.toFixed(2)}\n- Reserved ETH: ${s.vault.reservedEth}\n- Vault USDC change: ${drop.toFixed(2)} (cover / hedge, not a piggy bank)\n- Pass\n`,
    );
  });

  it("D2 +40% no naked call", () => {
    let s = initialState();
    const k = Math.round(s.eth / 100) * 100;
    s = asState(buyOption(s, "call", k, expOf(s), 2), "2 ATM calls");
    const reserved = s.vault.reservedEth;
    s = setMark(s, s.eth * 1.4);
    assert.ok(s.vault.eth + 1e-9 >= s.vault.reservedEth);
    const naked = buyOption(s, "call", k, expOf(s), 500);
    assert.equal(typeof naked, "string");
    writeReport(
      "D2.md",
      `# D2 +40%\n\n- Reserved ETH after melt-up: ${s.vault.reservedEth} (was ${reserved})\n- Vault ETH: ${s.vault.eth}\n- Naked 50 ETH call: ${String(naked)}\n- Cover holds. Pass\n`,
    );
  });

  it("D3 witching 80% OI ITM", () => {
    let s = initialState();
    const k = Math.round(s.eth / 100) * 100 - 200;
    s = asState(buyOption(s, "call", k, expOf(s), 8), "ITM calls");
    assert.ok(s.vault.reservedEth > 0);
    s = setMark(s, s.eth * 1.1, { settle: false });
    s = advanceClock(s, expOf(s) - s.clock + 1000);
    assert.equal(s.options.length, 0);
    assert.ok(s.vault.reservedEth < 1e-9);
    writeReport(
      "D3.md",
      `# D3 witching\n\n- Options after expiry: ${s.options.length}\n- Reserved ETH: ${s.vault.reservedEth}\n- Realized: ${s.account.realized.toFixed(2)}\n- Cover released. Pass\n`,
    );
  });

  it("D4 A shorts, B longs, the book nets", () => {
    let s = initialState();
    const e = expOf(s);
    s = asState(tradeFuture(s, "short", 10, e), "A short 1 ETH");
    assert.equal(s.futures.length, 1);
    s = setMark(s, 3000, { settle: false });
    const usdc0 = s.account.usdc;
    s = asState(tradeFuture(s, "long", 10, e), "B long flattens A");
    assert.equal(s.futures.length, 0, "same-account opposite side must net, not double the book");
    assert.ok(s.account.usdc > usdc0, "short from 4000 to 3000 credits the account");
    assert.ok(s.vault.eth + 1e-9 >= s.vault.reservedEth);
    writeReport(
      "D4.md",
      `# D4 netted book\n\n- Opposite 1 ETH mini on the same expiry flattened the short\n- USDC ${usdc0.toFixed(2)} → ${s.account.usdc.toFixed(2)}\n- Futures left: ${s.futures.length}\n- Vault ETH ${s.vault.eth} ≥ reserved ${s.vault.reservedEth}\n- Cover restored. Pass\n`,
    );
  });

  it("D5 util → α, next order rejected, spread widens", () => {
    let s = initialState();
    const e = expOf(s);
    const spread0 = spreadBps(s);
    let last = "";
    for (let i = 0; i < 500; i++) {
      const r = tradeFuture(s, "long", 1, e);
      if (typeof r === "string") {
        last = r;
        break;
      }
      s = r;
    }
    assert.ok(last);
    const spread1 = spreadBps(s);
    assert.ok(spread1 >= spread0);
    writeReport(
      "D5.md",
      `# D5 util cap\n\n- Reject: ${last}\n- Util: ${((s.vault.reservedEth / s.vault.eth) * 100).toFixed(1)}%\n- Spread ${spread0.toFixed(1)} → ${spread1.toFixed(1)} bps\n- Pass\n`,
    );
  });
});
