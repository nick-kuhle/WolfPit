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
  RL_MAX_ACCT,
  RL_WINDOW_SEC,
  createAdminLoginGuard,
  guardAuthRequest,
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
  const pruneSql = readFileSync(
    join(process.cwd(), "migrations", "0003_rate_limit_prune.sql"),
    "utf8",
  );
  await instance.exec(`drop table if exists wolfpit_rate_limit; ${sql} ${pruneSql}`);
  const run = (async (text: string, params?: unknown[]) => {
    const res = await instance.query(text, params ?? []);
    return res.rows as Record<string, unknown>[];
  }) as unknown as QueryRunner;
  const clock = { value: opts.now ?? Date.now() };
  const guard = createAdminLoginGuard(run, { now: () => clock.value });
  return { guard, clock, run };
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

// ─────────────────────────── /api/auth/* guard (F1) ─────────────────────────
// The auth guard is split into a read-only preflight + a post-dispatch
// `record(res)`: wrong-password attempts are the ONLY thing that consumes the
// window, and a successful auth resets it. Tested against the same PGLite with
// a FIXED clock (the window bucket must not roll over mid-test).

function authReq(email: string | null, ip = "198.51.100.7"): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip };
  return new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers,
    body: email ? JSON.stringify({ email }) : "{}",
  });
}

/** Preflight that must pass; narrows to the branch carrying `record`. */
function preflight(g: Awaited<ReturnType<typeof guardAuthRequest>>) {
  assert.ok(!g.blocked, "expected unblocked preflight");
  return g as Extract<Awaited<ReturnType<typeof guardAuthRequest>>, { blocked: null }>;
}

test("auth guard: preflight is read-only — never counts by itself", async () => {
  const { run, clock } = await makeGuard();
  const g = preflight(await guardAuthRequest(authReq("a@x.com"), { run, now: () => clock.value }));
  const rows = (await run("select count(*)::int as c from wolfpit_rate_limit")) as {
    c: number;
  }[];
  assert.equal(rows[0]!.c, 0, "preflight must not insert rows");
  await g.record(new Response("ok", { status: 200 }));
  const rows2 = (await run("select count(*)::int as c from wolfpit_rate_limit")) as {
    c: number;
  }[];
  assert.equal(rows2[0]!.c, 0, "success must not leave rows");
});

test("auth guard: only failures consume the window; 6th failed attempt blocks", async () => {
  const { run, clock } = await makeGuard();
  const ip = "203.0.113.9";
  for (let i = 0; i < RL_MAX_ACCT; i += 1) {
    const g = preflight(await guardAuthRequest(authReq("victim@x.com", ip), { run, now: () => clock.value }));
    await g.record(new Response("bad credentials", { status: 401 }));
  }
  const blocked = await guardAuthRequest(authReq("victim@x.com", ip), { run, now: () => clock.value });
  assert.ok(blocked.blocked?.status === 429, "6th attempt must be throttled");
});

test("auth guard: a successful login resets the counter (no self-lockout)", async () => {
  const { run, clock } = await makeGuard();
  const ip = "203.0.113.10";
  for (let i = 0; i < 3; i += 1) {
    const g = preflight(await guardAuthRequest(authReq("ok@x.com", ip), { run, now: () => clock.value }));
    await g.record(new Response("wrong", { status: 400 }));
  }
  // Success clears the counters...
  const g2 = preflight(await guardAuthRequest(authReq("ok@x.com", ip), { run, now: () => clock.value }));
  await g2.record(new Response("ok", { status: 200 }));

  // ...so 5 fresh failures are needed again before the 6th attempt blocks.
  for (let i = 0; i < RL_MAX_ACCT; i += 1) {
    const g = preflight(await guardAuthRequest(authReq("ok@x.com", ip), { run, now: () => clock.value }));
    await g.record(new Response("wrong", { status: 400 }));
  }
  const blocked = await guardAuthRequest(authReq("ok@x.com", ip), { run, now: () => clock.value });
  assert.ok(blocked.blocked?.status === 429, "5 failures after the reset must re-block");
});

test("auth guard: wrong-password attempts alone cannot lock a victim out", async () => {
  // Regression for the old design: 5 bare POSTs (never even reaching auth
  // verification) used to lock the account. Now preflight POSTs count nothing.
  const { run, clock } = await makeGuard();
  for (let i = 0; i < 25; i += 1) {
    preflight(await guardAuthRequest(authReq("victim@x.com", `10.1.1.${i}`), { run, now: () => clock.value }));
  }
});

test("auth pruning cannot delete a counter from the different-width swap window", async () => {
  const { run, clock } = await makeGuard();
  await run("insert into wolfpit_rate_limit (id, kind, key, count, window_start) values ($1,$2,$3,$4,$5)", [
    "swap:198.51.100.44",
    "swap",
    "198.51.100.44",
    3,
    0, // swap quota buckets are one minute; this is intentionally old
  ]);
  const g = preflight(await guardAuthRequest(authReq("cross-scale@x.com"), { run, now: () => clock.value }));
  await g.record(new Response("bad", { status: 401 }));
  const rows = (await run("select id from wolfpit_rate_limit where id = 'swap:198.51.100.44'")) as {
    id: string;
  }[];
  assert.equal(rows.length, 1, "auth pruning must not remove swap quota rows");
});

test("auth guard: rows from old windows are pruned (bounded growth)", async () => {
  const { run, clock } = await makeGuard();
  // Seed rows that belong to a long-gone window (older than the previous one).
  await run("insert into wolfpit_rate_limit (id, kind, key, count, window_start) values ($1,$2,$3,$4,$5)", [
    "acct:ancient@x.com",
    "acct",
    "ancient@x.com",
    5,
    1, // epoch bucket 1 ≈ decades ago
  ]);
  // Any bump triggers the prune (window_start index from 0003).
  const g = preflight(await guardAuthRequest(authReq("new@x.com", "198.51.100.9"), { run, now: () => clock.value }));
  await g.record(new Response("bad", { status: 401 }));
  const rows = (await run("select id from wolfpit_rate_limit where id = 'acct:ancient@x.com'")) as {
    id: string;
  }[];
  assert.equal(rows.length, 0, "stale window rows must be deleted");
});

test("auth guard: non-sensitive endpoints never touch the store", async () => {
  const { run, clock } = await makeGuard();
  const g = await guardAuthRequest(
    new Request("http://localhost/api/auth/callback/oauth2", { method: "GET" }),
    { run, now: () => clock.value },
  );
  assert.ok(!g.blocked);
  const rows = (await run("select count(*)::int as c from wolfpit_rate_limit")) as {
    c: number;
  }[];
  assert.equal(rows[0]!.c, 0, "GET callbacks must not write");
});
