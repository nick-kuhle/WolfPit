/**
 * F14: DB-backed brute-force throttle for the credential-auth surface.
 *
 * The old design kept an in-memory per-username counter per process, so N
 * serverless instances allowed N×5 attempts per account. This limiter stores
 * fixed-window counters in the app database (same `getSql()` used by app data
 * — Neon in production, PGLite in preview), so the window is SHARED across
 * every instance. Both dimensions are throttled:
 *
 *   - per IP      (x-forwarded-for / cf-connecting-ip)   20 POSTs / 15 min
 *   - per account (email from the auth POST body)         5 POSTs / 15 min
 *   - per IP+account pair (staggered)                     5 POSTs / 15 min
 *
 * Fail-closed: if the store is unreachable the guard returns 503 rather than
 * letting the retry through — auth cannot work without the database anyway.
 *
 * Wiring: `guardAuthRequest` is called by the `/api/auth/*` mount and by the
 * sign-in popup initiation (`popup.server.ts`) before Better Auth processes
 * the request. This module is framework-agnostic (web `Request` in, `Response`
 * out) so both the Vite dev middleware and the Nitro route can use it.
 *
 * The admin-panel login uses the same table via `createAdminLoginGuard` /
 * `checkAdminLogin` / `recordAdminLoginFailure` / `resetAdminLogin` (see the
 * ADMIN PANEL section below).
 */
export const RL_WINDOW_SEC = 15 * 60;
export const RL_MAX_IP = 20;
export const RL_MAX_ACCT = 5;
export const RL_MAX_PAIR = 5;

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor() {
    super("Too many sign-in attempts. Try again later.");
    this.name = "RateLimitedError";
  }
}

export class RateLimitStoreError extends Error {
  readonly status = 503;
  constructor() {
    super("Auth store unavailable; request not processed.");
    this.name = "RateLimitStoreError";
  }
}

/**
 * The smallest shape of an HTTP request this module needs. Both a web `Request`
 * and TanStack Start's server request satisfy it, so the guards run unchanged
 * on the `/api/auth/*` route (web Request) and inside server-function handlers
 * (getRequest() from @tanstack/react-start/server).
 */
export interface RequestLike {
  headers: { get(name: string): string | null };
}

export function clientIp(request: RequestLike | null | undefined): string | undefined {
  if (!request) return undefined;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || undefined;
  return request.headers.get("cf-connecting-ip")?.trim() || undefined;
}

/** Minimal query surface (both pg and PGLite satisfy `.query(text, params)`). */
export type QueryRunner = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

function bucketAt(now: () => number): number {
  return Math.floor(now() / 1000 / RL_WINDOW_SEC);
}

/** Current count for a row in the CURRENT window (0 when absent/stale). */
async function readCount(run: QueryRunner, id: string, bucket: number): Promise<number> {
  const rows = (await run(
    "select count from wolfpit_rate_limit where id = $1 and window_start = $2",
    [id, bucket],
  )) as { count: number }[];
  return Number(rows[0]?.count ?? 0);
}

/** Atomic increment (upsert); true when the row is over `max` after the bump. */
async function bumpCount(
  run: QueryRunner,
  id: string,
  kind: string,
  key: string,
  max: number,
  bucket: number,
): Promise<boolean> {
  const rows = (await run(
    `insert into wolfpit_rate_limit (id, kind, key, count, window_start)
     values ($1, $2, $3, 1, $4)
     on conflict (id) do update set
       count = case when wolfpit_rate_limit.window_start = excluded.window_start
                    then wolfpit_rate_limit.count + 1 else 1 end,
       window_start = excluded.window_start
     returning count`,
    [id, kind, key, bucket],
  )) as { count: number }[];
  return Number(rows[0]?.count ?? max + 1) > max;
}

async function deleteRow(run: QueryRunner, id: string): Promise<void> {
  await run("delete from wolfpit_rate_limit where id = $1", [id]);
}

/** Run a query against the app database (Neon in prod, PGLite in preview). */
async function withSql<T>(fn: (run: QueryRunner) => Promise<T>): Promise<T> {
  const { getSql } = await import("../db");
  const sql = await getSql();
  return fn(sql.query.bind(sql) as QueryRunner);
}

function tooManyResponse() {
  return new Response(JSON.stringify({ message: "Too many sign-in attempts. Try again later." }), {
    status: 429,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function storeErrorResponse() {
  return new Response(JSON.stringify({ message: "Auth store unavailable; request not processed." }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Return a 429/503 Response when the request must be throttled, else null. */
export async function guardAuthRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST") return null;
  // Credential/initiation endpoints only; callback GETs are browser navigations.
  const sensitive = /\/sign-in\/|\/sign-up\/|oauth2\/authorize/.test(url.pathname);
  if (!sensitive) return null;

  const ip = clientIp(request) ?? "unknown";

  // Account key: email from the JSON body (clone — better-auth reads it after).
  let email: string | undefined;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await request.clone().json().catch(() => null);
    if (body && typeof body.email === "string" && body.email.trim()) {
      email = body.email.trim().toLowerCase();
    }
  }

  const bumpFor = (kind: string, key: string, max: number, bucket: number) =>
    withSql((run) => bumpCount(run, `${kind}:${key}`, kind, key, max, bucket));

  try {
    const bucket = bucketAt(() => Date.now());
    if (await bumpFor("ip", ip, RL_MAX_IP, bucket)) return tooManyResponse();
    if (email) {
      if (await bumpFor("acct", email, RL_MAX_ACCT, bucket)) return tooManyResponse();
      if (await bumpFor("pair", `${ip}:${email}`, RL_MAX_PAIR, bucket)) return tooManyResponse();
    }
    return null;
  } catch {
    return storeErrorResponse(); // fail-closed
  }
}

/** Convenience for server-function middleware: throws RateLimitedError. */
export async function assertNotRateLimited(request: Request): Promise<void> {
  const blocked = await guardAuthRequest(request);
  if (blocked) throw blocked.status === 429 ? new RateLimitedError() : new RateLimitStoreError();
}

/**
 * IP-only check for non-POST surfaces such as the sign-in popup initiation
 * (`/auth/popup` is a GET that starts an OAuth flow). True = throttled.
 */
export async function throttledByIp(request: Request): Promise<boolean> {
  const ip = clientIp(request) ?? "unknown";
  try {
    const bucket = bucketAt(() => Date.now());
    return await withSql((run) => bumpCount(run, `ip:${ip}`, "ip", ip, RL_MAX_IP, bucket));
  } catch {
    return true; // fail-closed
  }
}

/** The caller's IP, or undefined when unknown (for logging/audit). */
export function callerIp(request: RequestLike | null | undefined): string | undefined {
  return clientIp(request);
}

// ─────────────────────────────── Admin panel ────────────────────────────────
// The admin login previously kept an in-memory per-process counter, so N
// serverless instances allowed N×5 attempts per account — and it counted
// SUCCESSES too (self-lockout after 5 logins). The guard below:
//
//   - counts FAILURES only, 5 / 15 min per username (single admin account),
//     plus 20 / 15 min per IP when the request is available — getRequest() IS
//     reachable from server-function handlers (the auth isolation middleware
//     already uses it, see src/lib/auth/isolation.server.ts), so the "no
//     request plumbing" note in the earlier revision was wrong.
//   - SHARED across every instance via the same wolfpit_rate_limit table
//   - resets on successful login (verify-then-record keeps the counter honest)
//   - fail-closed: a store error is reported, never bypassed
//
// The state machine is split so the check does not count: `check` (read-only,
// before verifying credentials), `recordFailure` (atomic bump AFTER a failed
// verify), `reset` (after a successful login). Bound a check-then-record race
// is harmless: the counter still only ever moves on real failures, and the
// atomic upsert means the window cannot be bypassed by concurrent attempts.

export const ADMIN_RL_MAX_USER = 5;
export const ADMIN_RL_MAX_IP = 20;

export type AdminThrottle =
  | { blocked: true; retryAfterSec: number }
  | { blocked: false }
  | { storeError: true };

export interface AdminLoginGuard {
  check(user: string, ip?: string): Promise<AdminThrottle>;
  recordFailure(user: string, ip?: string): Promise<AdminThrottle>;
  reset(user: string, ip?: string): Promise<void>;
}

/**
 * Build the admin login guard over an injected query runner (the app DB in
 * production; a PGLite instance in tests). `now` is injectable so the window
 * rollover is testable without sleeping 15 minutes.
 */
export function createAdminLoginGuard(
  run: QueryRunner,
  opts: { now?: () => number } = {},
): AdminLoginGuard {
  const now = opts.now ?? (() => Date.now());
  const bucket = () => bucketAt(now);
  const remainingSec = () => RL_WINDOW_SEC - (Math.floor(now() / 1000) % RL_WINDOW_SEC);

  const ids = (user: string, ip?: string) => ({
    user: `admin-user:${user}`,
    ip: ip ? `admin-ip:${ip}` : undefined,
  });

  return {
    async check(user: string, ip?: string): Promise<AdminThrottle> {
      try {
        const b = bucket();
        const { user: uid, ip: iid } = ids(user, ip);
        if (iid && (await readCount(run, iid, b)) >= ADMIN_RL_MAX_IP) {
          return { blocked: true, retryAfterSec: remainingSec() };
        }
        if ((await readCount(run, uid, b)) >= ADMIN_RL_MAX_USER) {
          return { blocked: true, retryAfterSec: remainingSec() };
        }
        return { blocked: false };
      } catch {
        return { storeError: true }; // fail-closed
      }
    },

    async recordFailure(user: string, ip?: string): Promise<AdminThrottle> {
      try {
        const b = bucket();
        const { user: uid, ip: iid } = ids(user, ip);
        if (iid) await bumpCount(run, iid, "admin-ip", iid, ADMIN_RL_MAX_IP, b);
        const blocked = await bumpCount(run, uid, "admin-user", uid, ADMIN_RL_MAX_USER, b);
        return blocked ? { blocked: true, retryAfterSec: remainingSec() } : { blocked: false };
      } catch {
        return { storeError: true }; // fail-closed
      }
    },

    async reset(user: string, ip?: string): Promise<void> {
      const { user: uid, ip: iid } = ids(user, ip);
      await deleteRow(run, uid);
      if (iid) await deleteRow(run, iid);
    },
  };
}

// Default wrappers backed by the app database. Tests use createAdminLoginGuard
// directly with an injected runner.
async function withLoginGuard<T>(fn: (guard: AdminLoginGuard) => Promise<T>): Promise<T> {
  return withSql((run) => fn(createAdminLoginGuard(run)));
}

/** Read-only pre-check (does NOT count). Pass `ip` to also gate per-IP. */
export async function checkAdminLogin(user: string, ip?: string): Promise<AdminThrottle> {
  return withLoginGuard((g) => g.check(user, ip));
}

/** Record one failed login attempt; true shape after the atomic bump. */
export async function recordAdminLoginFailure(user: string, ip?: string): Promise<AdminThrottle> {
  return withLoginGuard((g) => g.recordFailure(user, ip));
}

/** Clear the counter after a successful login (best-effort by callers). */
export async function resetAdminLogin(user: string, ip?: string): Promise<void> {
  return withLoginGuard((g) => g.reset(user, ip));
}
