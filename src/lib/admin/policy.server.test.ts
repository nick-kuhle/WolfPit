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
  envPolicy,
  isMissingTableError,
  readPolicy,
  requestCountry,
  resolvePolicy,
  writePolicy,
  type QueryRunner,
} from "./policy.server";

/** No environment policy — the default deployment shape. */
const NO_ENV = { listingsPaused: false, geoFenceUs: false, reason: "" };

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

/* ------------------------------------------------------------------ *
 * 2026-09-01 outage: the fail-closed rule needs a store to protect
 *
 * With no DATABASE_URL the app falls back to PGLite, whose .wasm/.data assets
 * are not emitted into the Vercel function bundle. Reproduced against
 * .vercel/output:
 *   [db] PGLite bootstrap failed: ENOENT ... '_libs/pglite.data'
 * Every getPolicy() threw, so the gate refused every quote — guarding a pause
 * that could not exist, because there was no shared store to set it in.
 * ------------------------------------------------------------------ */

/** A runner whose table has never been created (migration not applied). */
const missingTableRun = (async () => {
  const err = new Error('relation "wolfpit_policy" does not exist') as Error & { code: string };
  err.code = "42P01";
  throw err;
}) as unknown as QueryRunner;

test("no declared store + dead fallback: trade, do not refuse", async () => {
  const r = await checkTradingAllowed({ products: ["spot"], run: brokenRun, storeDeclared: false });
  assert.equal(r.ok, true, "nothing to protect: no store means no pause could have been set");
  const res = await resolvePolicy({ run: brokenRun, storeDeclared: false, env: NO_ENV });
  assert.equal(res.degraded?.code, "no-store");
  assert.equal(res.source, "default");
  assert.equal(res.policy.listingsPaused, false);
});

test("a declared store that is DOWN still refuses (rule unchanged)", async () => {
  const r = await checkTradingAllowed({ products: ["spot"], run: brokenRun, storeDeclared: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "policy-unavailable");
});

test("a declared store whose table does not exist yet degrades, not refuses", async () => {
  // 42P01 is unambiguous: the migration has not run, so no policy row exists.
  assert.equal(isMissingTableError(await capture(() => readPolicy(missingTableRun))), true);
  const r = await checkTradingAllowed({ products: ["spot"], run: missingTableRun, storeDeclared: true });
  assert.equal(r.ok, true);
  const res = await resolvePolicy({ run: missingTableRun, storeDeclared: true, env: NO_ENV });
  assert.equal(res.degraded?.code, "missing-table");
});

test("the env kill switch pauses with no database at all", async () => {
  const env = { listingsPaused: true, geoFenceUs: false, reason: "incident 42" };
  const res = await resolvePolicy({ run: brokenRun, storeDeclared: false, env });
  assert.equal(res.policy.listingsPaused, true);
  assert.equal(res.source, "env");
  assert.equal(res.policy.detail.listingsPaused.updatedBy, "env");
  assert.equal(res.policy.detail.listingsPaused.reason, "incident 42");
});

test("env and database compose as a union of restrictions", async () => {
  const run = await makeRun();
  // Database says trade; env says paused → paused. A DB write cannot lift an
  // env pause…
  await writePolicy(run, "listingsPaused", false, { reason: "resumed" });
  let res = await resolvePolicy({
    run,
    storeDeclared: true,
    env: { listingsPaused: true, geoFenceUs: false, reason: "deploy freeze" },
  });
  assert.equal(res.policy.listingsPaused, true, "env pause survives a DB 'false'");
  // …and an unset env cannot lift a DB pause.
  await writePolicy(run, "listingsPaused", true, { reason: "oracle outage" });
  res = await resolvePolicy({ run, storeDeclared: true, env: NO_ENV });
  assert.equal(res.policy.listingsPaused, true, "DB pause survives an unset env");
  assert.equal(res.source, "database");
  // The geo-fence composes the same way.
  res = await resolvePolicy({
    run,
    storeDeclared: true,
    env: { listingsPaused: false, geoFenceUs: true, reason: "" },
  });
  assert.equal(res.policy.geoFenceUs, true);
});

test("envPolicy reads the documented variables", async () => {
  const prev = { ...process.env };
  try {
    process.env.WOLFPIT_TRADING_PAUSED = "1";
    process.env.WOLFPIT_TRADING_PAUSED_REASON = "maintenance window";
    process.env.WOLFPIT_GEOFENCE_US = "true";
    let e = envPolicy();
    assert.equal(e.listingsPaused, true);
    assert.equal(e.geoFenceUs, true);
    assert.equal(e.reason, "maintenance window");
    process.env.WOLFPIT_TRADING_PAUSED = "0";
    process.env.WOLFPIT_GEOFENCE_US = "";
    e = envPolicy();
    assert.equal(e.listingsPaused, false, "0 is off, not 'a non-empty string'");
    assert.equal(e.geoFenceUs, false);
  } finally {
    process.env = prev;
  }
});

test("isMissingTableError does not swallow real outages", () => {
  assert.equal(isMissingTableError(new Error("connection refused")), false);
  assert.equal(isMissingTableError(new Error("timeout")), false);
  const permission = new Error("permission denied for table wolfpit_policy") as Error & { code: string };
  permission.code = "42501";
  assert.equal(isMissingTableError(permission), false, "permission denied must still fail closed");
});

/** Run `fn`, returning whatever it threw (for classifying wrapped errors). */
async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}
