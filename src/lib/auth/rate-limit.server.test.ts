/**
 * A4: state-machine tests for the DB-backed admin login throttle.
 *
 * Runs against a REAL embedded Postgres (PGLite) with the actual
 * migrations/0002_wolfpit_rate_limit.sql applied, so the SQL semantics under
 * test are the ones production ships. The guard is injected with the PGLite
 * runner + a mutable fake clock (no sleeps, no 15-minute waits).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  ADMIN_RL_MAX_IP,
  ADMIN_RL_MAX_USER,
  RL_WINDOW_SEC,
  createAdminLoginGuard,
  type AdminThrottle,
  type QueryRunner,
} from "./rate-limit.server";

let pg: PGlite | null = null;
async function getPg(): Promise<PGlite> {
  pg ??= new PGlite();
  await pg.waitReady;
  return pg;
}

after(async () => {
  await pg?.close();
});

/** A guard over PGLite with the throttle table applied, plus a mutable clock.
 *  The table is dropped + re-created so every test starts from a clean slate
 *  (the PGLite instance is shared across tests in this file). */
async function makeGuard(opts: { now?: number } = {}) {
  const instance = await getPg();
  const sql = readFileSync(
    join(process.cwd(), "migrations", "0002_wolfpit_rate_limit.sql"),
    "utf8",
  );
  await instance.exec(`drop table if exists wolfpit_rate_limit; ${sql}`);
  const run = (async (text: string, params?: unknown[]) => {
    const res = await instance.query(text, params ?? []);
    return res.rows as Record<string, unknown>[];
  }) as unknown as QueryRunner;
  const clock = { value: opts.now ?? Date.now() };
  const guard = createAdminLoginGuard(run, { now: () => clock.value });
  return { guard, clock };
}

/** Narrow a throttle result to its `blocked` flag, failing on store errors. */
function isBlocked(t: AdminThrottle): boolean {
  assert.ok(!("storeError" in t), "unexpected store error");
  return t.blocked;
}

test("five recorded failures block the sixth (per user)", async () => {
  const { guard } = await makeGuard();
  for (let i = 0; i < ADMIN_RL_MAX_USER; i += 1) {
    const after = await guard.recordFailure("ops");
    assert.ok(!isBlocked(after), `failure ${i + 1} should not yet block`);
  }
  const next = await guard.check("ops");
  assert.ok(!("storeError" in next), "store error on healthy PGlite");
  assert.ok(next.blocked, "6th attempt must be blocked");
  assert.ok(next.retryAfterSec > 0 && next.retryAfterSec <= RL_WINDOW_SEC);
  const sixth = await guard.recordFailure("ops");
  assert.ok(isBlocked(sixth), "record after limit stays blocked");
});

test("users are isolated (one admin username does not block another)", async () => {
  const { guard } = await makeGuard();
  for (let i = 0; i < ADMIN_RL_MAX_USER; i += 1) {
    await guard.recordFailure("ops");
  }
  assert.ok(isBlocked(await guard.check("ops")));
  assert.ok(!isBlocked(await guard.check("ops2")), "different username must be unaffected");
});

test("reset on success clears the counter", async () => {
  const { guard } = await makeGuard();
  for (let i = 0; i < ADMIN_RL_MAX_USER; i += 1) {
    await guard.recordFailure("ops");
  }
  assert.ok(isBlocked(await guard.check("ops")));
  await guard.reset("ops");
  assert.ok(!isBlocked(await guard.check("ops")), "reset must unblock");
  // And failures count again from a clean slate.
  for (let i = 0; i < ADMIN_RL_MAX_USER - 1; i += 1) {
    await guard.recordFailure("ops");
  }
  assert.ok(!isBlocked(await guard.check("ops")));
  await guard.recordFailure("ops");
  assert.ok(isBlocked(await guard.check("ops")));
});

test("IP dimension: many usernames from one IP eventually block that IP", async () => {
  const { guard } = await makeGuard();
  // One failure per distinct username from the SAME source IP: per-user counters
  // stay at 1, only the per-IP counter grows.
  for (let i = 0; i < ADMIN_RL_MAX_IP; i += 1) {
    await guard.recordFailure(`user-${i}`, "10.0.0.1");
  }
  assert.ok(
    isBlocked(await guard.check("fresh-user", "10.0.0.1")),
    "IP with 20 failures must block a fresh username",
  );
  assert.ok(
    !isBlocked(await guard.check("fresh-user", "10.0.0.2")),
    "a different IP must be unaffected",
  );
});

test("stale window resets: after 15 min the counter no longer blocks", async () => {
  const { guard, clock } = await makeGuard();
  for (let i = 0; i < ADMIN_RL_MAX_USER; i += 1) {
    await guard.recordFailure("ops");
  }
  assert.ok(isBlocked(await guard.check("ops")));

  // Same DB, clock advanced past the window: the old row is stale and the new
  // window starts unblocked.
  clock.value += (RL_WINDOW_SEC + 1) * 1000;
  const fresh = await guard.check("ops");
  assert.ok(!("storeError" in fresh), "clock must not error");
  assert.ok(!fresh.blocked, "a new window must start unblocked");
});

test("fail-closed: a store error is reported, never bypassed", async () => {
  const broken: QueryRunner = async () => {
    throw new Error("store down");
  };
  const guard = createAdminLoginGuard(broken);
  const check = await guard.check("ops");
  assert.ok("storeError" in check, "check must fail closed");
  const record = await guard.recordFailure("ops");
  assert.ok("storeError" in record, "record must fail closed");
});

test("check is read-only: it never changes counters", async () => {
  const { guard } = await makeGuard();
  await guard.check("ops");
  await guard.check("ops", "10.0.0.9");
  assert.ok(!isBlocked(await guard.check("ops")), "checking must not count");
  assert.ok(!isBlocked(await guard.check("ops", "10.0.0.9")), "checking must not count IPs");
});
