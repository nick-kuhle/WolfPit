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

export function adminCredentials() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (isProd()) {
    if (!user || !pass) {
      throw new Error("ADMIN_USER and ADMIN_PASS must be set when NODE_ENV=production.");
    }
    return { user, pass };
  }
  if (!user || !pass) {
    // Dev convenience only — never reachable in production.
    console.warn("[admin] ADMIN_USER/ADMIN_PASS unset in dev — using admin/admin.");
    return { user: user ?? "admin", pass: pass ?? "admin" };
  }
  return { user, pass };
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

export function mintAdminToken(user: string) {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = `${user}.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

export function readAdminUser(): string | null {
  const raw = getCookie(COOKIE);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [user, expStr, sig] = parts;
  if (!user || !expStr || !sig) return null;
  const payload = `${user}.${expStr}`;
  if (!eq(sig, hmac(payload))) return null;
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
