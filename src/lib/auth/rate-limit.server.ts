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

function clientIp(request: Request): string | undefined {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || undefined;
  return request.headers.get("cf-connecting-ip")?.trim() || undefined;
}

async function bump(id: string, kind: "ip" | "acct" | "pair", key: string, max: number) {
  const { getSql } = await import("../db");
  const sql = await getSql();
  const bucket = Math.floor(Date.now() / 1000 / RL_WINDOW_SEC);
  const rows = (await sql.query(
    `insert into wolfpit_rate_limit (id, kind, key, count, window_start)
     values ($1, $2, $3, 1, $4)
     on conflict (id) do update set
       count = case when wolfpit_rate_limit.window_start = excluded.window_start
                    then wolfpit_rate_limit.count + 1 else 1 end,
       window_start = excluded.window_start
     returning count`,
    [`${kind}:${key}`, kind, key, bucket],
  )) as { count: number }[];
  return Number(rows[0]?.count ?? max + 1) > max;
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

  try {
    if (await bump(`ip`, "ip", ip, RL_MAX_IP)) return tooManyResponse();
    if (email) {
      if (await bump(`acct`, "acct", email, RL_MAX_ACCT)) return tooManyResponse();
      if (await bump(`pair`, "pair", `${ip}:${email}`, RL_MAX_PAIR)) return tooManyResponse();
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
    return await bump("ip", "ip", ip, RL_MAX_IP);
  } catch {
    return true; // fail-closed
  }
}

/** The caller's IP, or null when unknown (for logging/audit). */
export function callerIp(request: Request): string | undefined {
  return clientIp(request);
}
