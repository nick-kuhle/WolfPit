import test from "node:test";
import assert from "node:assert/strict";
import { isStaleChunkError, shouldReload } from "./stale-chunk";

/*
 * 2026-08-31: an operator opened /admin in a tab that predated a redeploy and
 * got a full-screen "Something went wrong — Importing a module script failed."
 * The old chunk (/assets/admin-CznGl7bW.js) had 404'd; the new deployment
 * serves /assets/admin-BxdQFtU4.js. Reload fixes it, so the app should do that
 * itself — but ONLY for this signature, and never in a loop.
 */

test("recognises the stale-chunk signatures browsers actually emit", () => {
  const real = [
    new Error("Importing a module script failed."), // Safari / iOS
    new Error("Failed to fetch dynamically imported module: https://x/assets/admin-CznGl7bW.js"), // Chrome
    new Error("error loading dynamically imported module"), // Firefox
    new Error(
      "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
    ),
  ];
  for (const err of real) assert.equal(isStaleChunkError(err), true, err.message);
});

test("does NOT swallow real application errors", () => {
  const notStale = [
    new Error("Cannot read properties of undefined (reading 'map')"),
    new Error("Trading policy unavailable. Orders are refused until it can be read."),
    new Error("NetworkError when attempting to fetch resource."),
    new Error("Failed to fetch"),
    new Error(""),
    null,
    undefined,
    42,
  ];
  // A reload must never be able to hide a bug or an outage behind a refresh.
  for (const err of notStale) assert.equal(isStaleChunkError(err), false, String(err));
});

/** Minimal storage double. */
function store() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

test("reloads at most twice, then gives up and shows the error", () => {
  const s = store();
  assert.equal(shouldReload(s, 1000), true, "first recovery attempt");
  assert.equal(shouldReload(s, 2000), true, "second");
  assert.equal(shouldReload(s, 3000), false, "a broken deploy must not loop");
});

test("the budget refreshes once the window has passed", () => {
  const s = store();
  shouldReload(s, 1000);
  shouldReload(s, 2000);
  assert.equal(shouldReload(s, 3000), false);
  // A later deploy, long after: the tab is allowed to recover again.
  assert.equal(shouldReload(s, 1000 + 61_000), true);
});

test("survives corrupt or unwritable storage", () => {
  const corrupt = { getItem: () => "not json", setItem: () => {} };
  assert.equal(shouldReload(corrupt, 1), true);
  const readOnly = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  // Private browsing must not break recovery.
  assert.equal(shouldReload(readOnly, 1), true);
});
