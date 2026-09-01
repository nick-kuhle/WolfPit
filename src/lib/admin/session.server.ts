import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const COOKIE = "wp_admin";
const MAX_AGE = 12 * 60 * 60;
const SECRET_MIN_LEN = 32;
const DEV_SECRET = "wolfpit-dev-admin-secret-not-for-prod";

const isProd = () => process.env.NODE_ENV === "production";

/**
 * Session signing secret. Fail-closed in production: the env var must be set,
 * ≥32 chars, and must not be the shipped dev default. In dev an ephemeral
 * per-process random secret is used (admin sessions reset on restart) so a
 * forgotten env var can never mint forgeable tokens in prod.
 */
let devSecret: string | null = null;
function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (s && s.length >= SECRET_MIN_LEN && s !== DEV_SECRET) return s;
  if (isProd()) {
    throw new Error(
      "ADMIN_SESSION_SECRET must be set (>= 32 chars, not the dev default) when NODE_ENV=production.",
    );
  }
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

function adminCredentials() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (isProd()) {
    if (!user || !pass) {
      throw new Error("ADMIN_USER and ADMIN_PASS must be set when NODE_ENV=production.");
    }
    return { user, pass };
  }
  if (!user || !pass) {
    // Dev convenience only — never reachable in production, and never when
    // auth is explicitly enabled (VITE_AUTH_ENABLED=true): a deployed box
    // with a live sign-in page must NOT ship a known admin/admin backdoor.
    const authOn = process.env.VITE_AUTH_ENABLED !== "false";
    if (authOn) {
      throw new Error("ADMIN_USER and ADMIN_PASS must be set when auth is enabled.");
    }
    console.warn("[admin] ADMIN_USER/ADMIN_PASS unset in dev (auth off) — using admin/admin.");
    return { user: "admin", pass: "admin" };
  }
  return { user, pass };
}

/**
 * Is admin sign-in usable on this deployment? Same rules as `secret()` and
 * `adminCredentials()`, but as a QUESTION rather than a throw.
 *
 * 2026-08-31: the login form called `adminLogin()` with no `.catch`, so when
 * these env vars were missing in production the handler threw, the promise
 * rejected, and the page did NOTHING — no error, no sign-in, just a button
 * that flickered. A control that fails silently is worse than one that fails
 * loudly: the operator cannot tell "wrong password" from "this deployment has
 * no admin configured". Callers now ask first and report the reason.
 */
export function adminAuthStatus(): { ok: true } | { ok: false; error: string } {
  const missing: string[] = [];
  const s = process.env.ADMIN_SESSION_SECRET;
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (isProd() || process.env.VITE_AUTH_ENABLED !== "false") {
    if (!user) missing.push("ADMIN_USER");
    if (!pass) missing.push("ADMIN_PASS");
  }
  if (isProd() && !(s && s.length >= SECRET_MIN_LEN && s !== DEV_SECRET)) {
    missing.push(
      s ? "ADMIN_SESSION_SECRET (must be >= 32 chars and not the dev default)" : "ADMIN_SESSION_SECRET",
    );
  }
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    error: `Admin sign-in is not configured on this deployment. Missing: ${missing.join(", ")}.`,
  };
}

function hmac(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Constant-time equality of sha256 digests (length-independent). */
function eq(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyPassword(user: string, pass: string) {
  const c = adminCredentials();
  return eq(user, c.user) && eq(pass, c.pass);
}

/** Exported for tests: mint a token the way `setAdminCookie` does. */
/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export function mintAdminToken(user: string) {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = `${user}.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

export function readAdminUser(): string | null {
  return verifyAdminToken(getCookie(COOKIE));
}

/**
 * Verify a presented session token. Pure: no request context, so it is unit
 * testable — which is how the "unverifiable cookie must be null, not a throw"
 * rule is now held by a test rather than by hope.
 */
/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export function verifyAdminToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [user, expStr, sig] = parts;
  if (!user || !expStr || !sig) return null;
  const payload = `${user}.${expStr}`;
  // `hmac()` throws when the signing secret is missing in production. A
  // presented cookie that cannot be verified is simply NOT a session — resolve
  // it to null instead of rejecting the caller's promise, which is how the
  // admin page ended up rendering nothing at all.
  let expected: string;
  try {
    expected = hmac(payload);
  } catch {
    return null;
  }
  if (!eq(sig, expected)) return null;
  if (Number(expStr) < Date.now()) return null;
  return user;
}

export function setAdminCookie(user: string) {
  const https = process.env.NODE_ENV === "production";
  setCookie(COOKIE, mintAdminToken(user), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    maxAge: MAX_AGE,
  });
}

export function clearAdminCookie() {
  setCookie(COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
}

// ---------------------------------------------------------------- rate limit
// The login throttle is DB-backed and shared across instances: see
// `checkAdminLogin` / `recordAdminLoginFailure` / `resetAdminLogin` in
// ../auth/rate-limit.server.ts (same wolfpit_rate_limit table as the
// /api/auth/* guard). Failures-only counters, reset on success, fail-closed on
// store errors. The previous in-memory per-process counter allowed N×5
// attempts across N serverless instances and lived here; it was removed.
