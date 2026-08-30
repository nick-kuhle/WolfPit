import assert from "node:assert/strict";
import { test } from "node:test";
import { runPreSignInSignOut, runSignOut } from "./sign-out-plan.mjs";

function harness() {
  const calls = [];
  return {
    calls,
    requestSignOut: async () => {
      calls.push("request");
    },
    clearToken: () => {
      calls.push("clear");
    },
    redirect: () => {
      calls.push("redirect");
    },
  };
}

test("deployed sign-out waits for server confirm, clears, then redirects", async () => {
  const h = harness();
  await runSignOut({ livePreview: false, hasBearer: true, ...h });
  assert.deepEqual(h.calls, ["request", "clear", "redirect"]);
});

test("deployed sign-out rejects and never redirects when the server refuses", async () => {
  const h = harness();
  const requestSignOut = async () => {
    throw new Error("no confirm");
  };
  await assert.rejects(
    runSignOut({ livePreview: false, hasBearer: true, ...h, requestSignOut }),
  );
  assert.deepEqual(h.calls, []);
});

test("preview sign-out always resolves: clear then redirect, request best-effort", async () => {
  const h = harness();
  const requestSignOut = () => new Promise(() => {}); // never settles
  await runSignOut({ livePreview: true, hasBearer: true, ...h, requestSignOut });
  assert.ok(h.calls.includes("clear"));
  assert.equal(h.calls[h.calls.length - 1], "redirect");
});

test("preview pre-sign-in cleanout is bounded even when the request hangs", async () => {
  const h = harness();
  const requestSignOut = () => new Promise(() => {}); // never settles
  const started = Date.now();
  await runPreSignInSignOut({ livePreview: true, hasBearer: true, ...h, requestSignOut });
  assert.ok(Date.now() - started < 5_000, "bounded");
  assert.deepEqual(h.calls, ["clear"]);
});

test("deployed pre-sign-in cleanout is unbounded and propagates failures", async () => {
  const h = harness();
  const requestSignOut = async () => {
    throw new Error("server down");
  };
  await assert.rejects(
    runPreSignInSignOut({ livePreview: false, hasBearer: true, ...h, requestSignOut }),
  );
  assert.deepEqual(h.calls, []);
});

test("token is not touched when there is no bearer", async () => {
  const h = harness();
  await runSignOut({ livePreview: false, hasBearer: false, ...h });
  assert.deepEqual(h.calls, ["request", "redirect"]);
});
