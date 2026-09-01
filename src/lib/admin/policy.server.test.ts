/**
 * WP-07 / #13 — server-side trading policy.
 *
 * Runs against a REAL embedded Postgres (PGLite) with the shipped
 * migrations/0004_wolfpit_policy.sql applied, so the SQL under test is the SQL
 * production runs. Same pattern as rate-limit.server.test.ts.
 *
 * The point of these tests is not that a boolean round-trips. It is the four
 * properties the issue says were missing:
 *
 *   1. pause applies to EVERY caller, not the one who clicked it;
 *   2. editing your own localStorage cannot lift the geo-fence, because the
 *      decision never reads client state;
 *   3. the gate FAILS CLOSED when the policy store is unreadable;
 *   4. the decision is made server-side from a header the client cannot set.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  PolicyBlockedError,
  checkTradingAllowed,
  readPolicy,
  requestCountry,
  writePolicy,
  type QueryRunner,
} from "./policy.server";

let pg: PGlite | null = null;
async function getPg(): Promise<PGlite> {
  pg ??= new PGlite();
  await pg.waitReady;
  return pg;
}

after(async () => {
  await pg?.close();
});

/** A runner over PGLite with the policy table applied fresh. */
async function makeRun(): Promise<QueryRunner> {
  const instance = await getPg();
  const sql = readFileSync(join(process.cwd(), "migrations", "0004_wolfpit_policy.sql"), "utf8");
  await instance.exec(`drop table if exists wolfpit_policy; ${sql}`);
  return (async (text: string, params?: unknown[]) => {
    const res = await instance.query(text, params ?? []);
    return res.rows as Record<string, unknown>[];
  }) as unknown as QueryRunner;
}

/** A runner that always throws — stands in for an unavailable store. */
const brokenRun = (async () => {
  throw new Error("connection refused");
}) as unknown as QueryRunner;

function headers(pairs: Record<string, string>) {
  return { get: (n: string) => pairs[n.toLowerCase()] ?? null };
}

test("defaults to unpaused with no geo-fence on a fresh store", async () => {
  const run = await makeRun();
  const p = await readPolicy(run);
  assert.equal(p.listingsPaused, false);
  assert.equal(p.geoFenceUs, false);
});

test("a pause set by one caller binds every caller (not per-browser)", async () => {
  const run = await makeRun();
  await writePolicy(run, "listingsPaused", true, { reason: "incident 42", by: "ops@1.2.3.4" });

  // Any caller, any header, any product: refused. This is the property the
  // localStorage version could not provide — it only paused one browser.
  for (const products of [["spot"], ["future"], ["option"], ["race"], undefined]) {
    const r = await checkTradingAllowed({ products, run, headers: headers({}) });
    assert.equal(r.ok, false, `products=${JSON.stringify(products)} must be refused while paused`);
    if (!r.ok) {
      assert.equal(r.code, "paused");
      assert.match(r.error, /incident 42/, "the operator's reason is surfaced");
    }
  }
});

test("lifting the pause is visible to every caller immediately", async () => {
  const run = await makeRun();
  await writePolicy(run, "listingsPaused", true, {});
  assert.equal((await checkTradingAllowed({ products: ["spot"], run })).ok, false);
  await writePolicy(run, "listingsPaused", false, {});
  assert.equal((await checkTradingAllowed({ products: ["spot"], run })).ok, true);
});

test("the geo-fence decision never reads client state", async () => {
  const run = await makeRun();
  await writePolicy(run, "geoFenceUs", true, {});

  // A US caller is refused on a gated product.
  const us = await checkTradingAllowed({
    products: ["future"],
    run,
    headers: headers({ "cf-ipcountry": "US" }),
  });
  assert.equal(us.ok, false);
  if (!us.ok) assert.equal(us.code, "geo");

  // A non-US caller is allowed through the same gate.
  const de = await checkTradingAllowed({
    products: ["future"],
    run,
    headers: headers({ "cf-ipcountry": "DE" }),
  });
  assert.equal(de.ok, true);
});

test("an unknown country is refused, not waved through", async () => {
  const run = await makeRun();
  await writePolicy(run, "geoFenceUs", true, {});
  // The crux of the fix: a compliance control that admits "I don't know" is not
  // a control. Missing header, Cloudflare's XX/T1 sentinels — all refused.
  for (const value of [undefined, "XX", "T1", ""]) {
    const r = await checkTradingAllowed({
      products: ["option"],
      run,
      headers: headers(value ? { "cf-ipcountry": value } : {}),
    });
    assert.equal(r.ok, false, `cf-ipcountry=${JSON.stringify(value)} must be refused`);
  }
});

test("the geo-fence does not gate ungated products", async () => {
  const run = await makeRun();
  await writePolicy(run, "geoFenceUs", true, {});
  const r = await checkTradingAllowed({
    products: ["spot"],
    run,
    headers: headers({ "cf-ipcountry": "US" }),
  });
  assert.equal(r.ok, true, "spot is not a gated product");
});

test("an unreadable policy store refuses orders (fails closed)", async () => {
  // The deliberate difference from rate-limit.server, which fails OPEN. An
  // operator who pauses the book must never see "store down, allowed".
  const r = await checkTradingAllowed({ products: ["spot"], run: brokenRun });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "policy-unavailable");
    assert.match(r.error, /refused/);
  }
});

test("readPolicy raises PolicyBlockedError rather than returning unpaused", async () => {
  await assert.rejects(() => readPolicy(brokenRun), (err: unknown) => {
    assert.ok(err instanceof PolicyBlockedError);
    assert.equal(err.code, "policy-unavailable");
    return true;
  });
});

test("requestCountry ignores values a client cannot be trusted to supply", () => {
  assert.equal(requestCountry(headers({ "cf-ipcountry": "US" })), "US");
  assert.equal(requestCountry(headers({ "cf-ipcountry": "de" })), "DE", "normalised to upper");
  assert.equal(requestCountry(headers({ "cf-ipcountry": "XX" })), undefined);
  assert.equal(requestCountry(headers({ "cf-ipcountry": "T1" })), undefined);
  assert.equal(requestCountry(headers({})), undefined);
  // A bogus length is not a country.
  assert.equal(requestCountry(headers({ "cf-ipcountry": "USA" })), undefined);
});

test("a policy write records who made it and when", async () => {
  const run = await makeRun();
  const p = await writePolicy(run, "listingsPaused", true, {
    reason: "oracle outage",
    by: "ops@9.9.9.9",
  });
  assert.equal(p.listingsPaused, true);
  assert.equal(p.detail.listingsPaused.reason, "oracle outage");
  assert.equal(p.detail.listingsPaused.updatedBy, "ops@9.9.9.9");
  assert.ok(p.detail.listingsPaused.updatedAt.length > 0, "timestamp recorded");
});

test("a write upserts rather than inserting a second row", async () => {
  const run = await makeRun();
  await writePolicy(run, "geoFenceUs", true, { reason: "first" });
  await writePolicy(run, "geoFenceUs", false, { reason: "second" });
  const p = await readPolicy(run);
  assert.equal(p.geoFenceUs, false, "latest write wins");
  assert.equal(p.detail.geoFenceUs.reason, "second");
});
