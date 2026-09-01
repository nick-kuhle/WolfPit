/**
 * WP-07 / #13 — server-side trading policy (pause + geo-fence).
 *
 * WHY THIS EXISTS
 *
 * Both flags used to live in the admin's browser: Zustand state persisted to
 * localStorage under `wolfpit-admin-v1`, read only in client code
 * (`src/lib/wolfpit/store.ts`). That made them not controls:
 *
 *   - pause paused trading for the one operator who clicked it. Every other
 *     session kept trading. This is the switch you reach for during an
 *     incident, and it did nothing.
 *   - the geo-fence was lifted by any user who opened devtools. A compliance
 *     boundary enforced in client-side JavaScript is not a boundary.
 *
 * The flags now live in `wolfpit_policy` (migration 0004), shared across every
 * serverless instance, and are enforced HERE — in the server functions that
 * accept orders — rather than in the client. The client store keeps its flags
 * for display and to avoid round-trips on obvious cases, but it is a mirror,
 * never the source of truth.
 *
 * FAIL-CLOSED, AND WHERE THAT RULE STOPS
 *
 * `rate-limit.server.ts` deliberately fails OPEN: a DB hiccup must not take
 * down live swaps, and the cost is quota. That reasoning does not transfer. If
 * we cannot read the policy table we do not know whether trading is paused, so
 * a store error must reject. An operator who pauses the book during an incident
 * and then gets "store unavailable, request allowed" has been handed the worst
 * possible failure mode. The cost of failing closed is a few seconds of refused
 * orders; the cost of failing open is trading while paused.
 *
 * That rule has a precondition this module originally missed, and it cost the
 * live desk an outage (2026-09-01): **failing closed only protects a switch
 * that exists.** With no `DATABASE_URL` the app falls back to PGLite, an
 * in-process Postgres whose `.wasm`/`.data` assets are NOT emitted into the
 * Vercel function bundle. Reproduced against `.vercel/output`:
 *
 *   [db] PGLite bootstrap failed: Error: ENOENT: no such file or directory,
 *        open '.../__server.func/_libs/pglite.data'
 *
 * So every `getPolicy()` threw, every quote was refused, and the desk showed
 * "Trading policy unavailable" to every visitor — while protecting a pause that
 * no one could ever have set, because there was no shared store to set it in.
 *
 * The rule is therefore scoped to a DECLARED store:
 *
 *   - `DATABASE_URL` set (or a runner injected by the caller) → a shared store
 *     exists. An unreadable store REFUSES orders. Unchanged.
 *   - the table does not exist yet (SQLSTATE 42P01) → the migration has not
 *     run, so no policy has ever been written. Nothing to protect: fall back to
 *     the env policy and log loudly.
 *   - no `DATABASE_URL` → there is no shared policy store at all. Policy comes
 *     from the environment (below). A PGLite failure degrades to that instead
 *     of refusing every order.
 *
 * ENV KILL SWITCH (works with zero database)
 *
 *   WOLFPIT_TRADING_PAUSED=1          pause everything
 *   WOLFPIT_TRADING_PAUSED_REASON=…   shown to customers after "Trading is paused."
 *   WOLFPIT_GEOFENCE_US=1             gate futures / options / race betting
 *
 * Env and database compose as a UNION of restrictions: either source can
 * impose a pause, neither can lift the other's. A deploy-time env pause cannot
 * be cleared by someone with database access, and a database pause cannot be
 * cleared by a redeploy.
 *
 * GEO DETERMINATION
 *
 * Country comes from `cf-ipcountry`, set by Cloudflare and not client-spoofable
 * the way a body field or localStorage entry is. When the header is absent we
 * CANNOT determine the country, and with the fence ON that is treated as
 * blocked — a compliance control that admits "unknown" is not a control.
 * Practical consequence, stated plainly: do not enable `geoFenceUs` behind a
 * proxy that does not set `cf-ipcountry`, or every request will be refused.
 * That is the intended direction of failure.
 */
import { getSql, hasSharedDatabase } from "../db";
import { clientIp, type QueryRunner } from "../auth/rate-limit.server";

/** Re-exported so callers (and tests) can name the injected runner type. */
export type { QueryRunner };

export type PolicyKey = "listingsPaused" | "geoFenceUs";

export type Policy = {
  listingsPaused: boolean;
  geoFenceUs: boolean;
  /** Per-key detail for the admin UI. */
  detail: Record<PolicyKey, { reason: string; updatedBy: string; updatedAt: string }>;
};

const EMPTY_DETAIL = {
  reason: "",
  updatedBy: "",
  updatedAt: "",
};

/** Thrown when a request must be refused by policy. Carries a user-safe message. */
export class PolicyBlockedError extends Error {
  readonly code: "paused" | "geo" | "policy-unavailable";
  /** Underlying store error, kept so callers can classify it (e.g. 42P01). */
  readonly reason?: unknown;
  constructor(code: PolicyBlockedError["code"], message: string, reason?: unknown) {
    super(message);
    this.name = "PolicyBlockedError";
    this.code = code;
    this.reason = reason;
  }
}

const UNAVAILABLE_MSG = "Trading policy unavailable. Orders are refused until it can be read.";

/* ------------------------------------------------------------------ *
 * Environment policy — the kill switch that needs no database
 * ------------------------------------------------------------------ */

function envValue(name: string): string | undefined {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v && v.trim() ? v.trim() : undefined;
}

function envFlag(name: string): boolean {
  const v = envValue(name)?.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type EnvPolicy = { listingsPaused: boolean; geoFenceUs: boolean; reason: string };

/**
 * Policy imposed by the deployment environment. Read on every call rather than
 * memoized: a serverless instance can be recycled with new env, and this is
 * cheap.
 */
export function envPolicy(): EnvPolicy {
  return {
    listingsPaused: envFlag("WOLFPIT_TRADING_PAUSED"),
    geoFenceUs: envFlag("WOLFPIT_GEOFENCE_US"),
    reason: envValue("WOLFPIT_TRADING_PAUSED_REASON") ?? "",
  };
}

/**
 * Postgres `undefined_table` (42P01): the migration has not been applied, so
 * no policy row can exist. Distinct from "the store is down", which is the
 * case that must refuse orders.
 */
export function isMissingTableError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { code?: unknown; message?: unknown; reason?: unknown; cause?: unknown };
    if (e.code === "42P01") return true;
    if (typeof e.message === "string" && /relation .*wolfpit_policy.* does not exist/i.test(e.message)) return true;
    cur = e.reason ?? e.cause;
  }
  return false;
}

/**
 * Read the live policy from an explicit runner. Split out from `getPolicy` so
 * the SQL semantics can be tested against a real embedded Postgres with the
 * shipped migration applied — the same pattern as `createAdminLoginGuard`.
 *
 * Throws PolicyBlockedError("policy-unavailable") when the store cannot be
 * read; callers must NOT treat that as "unpaused".
 */
export async function readPolicy(run: QueryRunner): Promise<Policy> {
  let rows: { key: string; value: boolean; reason: string; updated_by: string; updated_at: unknown }[];
  try {
    rows = (await run(
      "select key, value, reason, updated_by, updated_at from wolfpit_policy where key = any($1)",
      [["listingsPaused", "geoFenceUs"]],
    )) as never;
  } catch (err) {
    // Keep the underlying error: the caller distinguishes "table not created
    // yet" (nothing to protect) from "store is down" (refuse orders).
    throw new PolicyBlockedError("policy-unavailable", UNAVAILABLE_MSG, err);
  }
  const detail: Policy["detail"] = {
    listingsPaused: { ...EMPTY_DETAIL },
    geoFenceUs: { ...EMPTY_DETAIL },
  };
  let listingsPaused = false;
  let geoFenceUs = false;
  for (const r of rows ?? []) {
    const on = r.value === true || r.value === ("t" as unknown as boolean);
    const d = {
      reason: typeof r.reason === "string" ? r.reason : "",
      updatedBy: typeof r.updated_by === "string" ? r.updated_by : "",
      updatedAt: r.updated_at ? new Date(r.updated_at as string | number).toISOString() : "",
    };
    if (r.key === "listingsPaused") {
      listingsPaused = on;
      detail.listingsPaused = d;
    } else if (r.key === "geoFenceUs") {
      geoFenceUs = on;
      detail.geoFenceUs = d;
    }
  }
  return { listingsPaused, geoFenceUs, detail };
}

/** Admin write against an explicit runner. Returns the policy as it now stands. */
export async function writePolicy(
  run: QueryRunner,
  key: PolicyKey,
  value: boolean,
  opts: { reason?: string; by?: string } = {},
): Promise<Policy> {
  await run(
    `insert into wolfpit_policy (key, value, reason, updated_by, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (key) do update set
       value = excluded.value,
       reason = excluded.reason,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [key, value, (opts.reason ?? "").slice(0, 200), (opts.by ?? "").slice(0, 64)],
  );
  return readPolicy(run);
}

/** Production query runner, resolved lazily so this module stays import-safe. */
async function prodRun(): Promise<QueryRunner> {
  const sql = await getSql();
  // `Sql.query` already resolves to the row array (see src/lib/db.ts), unlike
  // pg's raw client which wraps it in `{ rows }`.
  return (async <T,>(text: string, params?: unknown[]) =>
    sql.query<T>(text, params)) as QueryRunner;
}

/** Read the live policy from the app database. Throws when it cannot be read. */
/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export async function getPolicy(): Promise<Policy> {
  return readPolicy(await prodRun());
}

/* ------------------------------------------------------------------ *
 * Resolution — database ∪ environment, with a scoped fail-closed rule
 * ------------------------------------------------------------------ */

export type PolicyResolution = {
  policy: Policy;
  /** Where the answer came from. */
  source: "database" | "env" | "default";
  /**
   * Present when a store read failed but the request was still answerable —
   * i.e. there was no declared shared store, or its table does not exist yet.
   * Never present when a declared, existing store simply failed: that refuses.
   */
  degraded?: { code: "no-store" | "missing-table"; detail: string };
};

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(message);
}

function envDetail(reason: string) {
  return { reason, updatedBy: "env", updatedAt: "" };
}

function describe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.split("\n")[0]!.slice(0, 200);
}

/**
 * Resolve the effective policy.
 *
 * @param opts.run            Injected runner (tests, or a caller that owns the
 *                            connection). Supplying one DECLARES a store, so
 *                            its failures fail closed.
 * @param opts.storeDeclared  Override the "is there a shared store" answer.
 *                            Defaults to `run != null || DATABASE_URL is set`.
 */
export async function resolvePolicy(
  opts: { run?: QueryRunner; storeDeclared?: boolean; env?: EnvPolicy } = {},
): Promise<PolicyResolution> {
  const env = opts.env ?? envPolicy();
  const declared = opts.storeDeclared ?? (Boolean(opts.run) || hasSharedDatabase());

  let stored: Policy | null = null;
  let degraded: PolicyResolution["degraded"];
  try {
    stored = await readPolicy(opts.run ?? (await prodRun()));
  } catch (err) {
    const missingTable = isMissingTableError(err);
    if (declared && !missingTable) {
      // A shared store exists and is unreadable: we cannot prove trading is
      // allowed, so we do not allow it.
      throw err instanceof PolicyBlockedError
        ? err
        : new PolicyBlockedError("policy-unavailable", UNAVAILABLE_MSG, err);
    }
    degraded = { code: missingTable ? "missing-table" : "no-store", detail: describe(err) };
    warnOnce(
      degraded.code,
      missingTable
        ? `[policy] wolfpit_policy is missing — run migrations/0004_wolfpit_policy.sql. ` +
            `Falling back to the environment policy. (${degraded.detail})`
        : `[policy] no shared policy store (DATABASE_URL unset) and the local fallback is ` +
            `unavailable. Using the environment policy; set DATABASE_URL to make the admin ` +
            `pause switch binding. (${degraded.detail})`,
    );
  }

  // Union of restrictions: either source can impose, neither can lift.
  const listingsPaused = (stored?.listingsPaused ?? false) || env.listingsPaused;
  const geoFenceUs = (stored?.geoFenceUs ?? false) || env.geoFenceUs;
  const detail: Policy["detail"] = {
    listingsPaused:
      env.listingsPaused && !stored?.listingsPaused
        ? envDetail(env.reason)
        : (stored?.detail.listingsPaused ?? { ...EMPTY_DETAIL }),
    geoFenceUs:
      env.geoFenceUs && !stored?.geoFenceUs
        ? envDetail("")
        : (stored?.detail.geoFenceUs ?? { ...EMPTY_DETAIL }),
  };

  const source: PolicyResolution["source"] = stored
    ? "database"
    : env.listingsPaused || env.geoFenceUs
      ? "env"
      : "default";
  return { policy: { listingsPaused, geoFenceUs, detail }, source, degraded };
}

/**
 * Operator-facing status for the admin page. Never throws: an admin must be
 * able to SEE that the switch is not backed by a shared store — the whole
 * point of WP-07 was that a control nobody can rely on is not a control.
 */
export async function policyStatus(): Promise<{
  policy: Policy;
  source: PolicyResolution["source"] | "unavailable";
  degraded?: PolicyResolution["degraded"];
  /** True when a pause written here would bind every serverless instance. */
  shared: boolean;
  /** True when the admin toggle can persist a change. */
  writable: boolean;
  error?: string;
}> {
  const shared = hasSharedDatabase();
  try {
    const r = await resolvePolicy();
    return { ...r, shared, writable: shared || !isProduction() };
  } catch (err) {
    const env = envPolicy();
    return {
      policy: {
        listingsPaused: env.listingsPaused,
        geoFenceUs: env.geoFenceUs,
        detail: { listingsPaused: envDetail(env.reason), geoFenceUs: envDetail("") },
      },
      source: "unavailable",
      shared,
      writable: shared || !isProduction(),
      error: err instanceof Error ? err.message : UNAVAILABLE_MSG,
    };
  }
}

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
}

/**
 * Admin write to the app database.
 *
 * Refuses in production when no shared store is declared: writing to the
 * per-instance PGLite fallback would report success, bind one lambda, and
 * evaporate — exactly the "pause that paused nothing" failure WP-07 exists to
 * prevent. Better to tell the operator the truth and point at the env switch.
 */
export async function setPolicy(
  key: PolicyKey,
  value: boolean,
  opts: { reason?: string; by?: string } = {},
): Promise<Policy> {
  if (!hasSharedDatabase() && isProduction()) {
    throw new Error(
      "No shared policy store: set DATABASE_URL so a pause binds every instance. " +
        "Until then use WOLFPIT_TRADING_PAUSED=1 (env) as the kill switch.",
    );
  }
  return writePolicy(await prodRun(), key, value, opts);
}

/**
 * Country for the current request, from a header the client cannot set.
 * Returns undefined when the platform does not supply one.
 */
export function requestCountry(headers: { get(name: string): string | null }): string | undefined {
  const c = headers.get("cf-ipcountry")?.trim().toUpperCase();
  // ISO-3166 alpha-2, or Cloudflare's "XX"/"T1" for unknown/tor. Treat those as
  // unknown rather than as a real country.
  if (!c || c.length !== 2 || c === "XX" || c === "T1") return undefined;
  return c;
}

export type GateResult =
  | { ok: true }
  | { ok: false; code: PolicyBlockedError["code"]; error: string };

/**
 * The single chokepoint every order-accepting server function calls.
 *
 * @param opts.products  Products this request would trade. The geo-fence gates
 *                       futures and options (and race betting, which the client
 *                       already treats the same way); pause gates everything.
 */
export async function checkTradingAllowed(opts: {
  products?: string[];
  headers?: { get(name: string): string | null } | null;
  /** Injected for tests; supplying one declares a store (see resolvePolicy). */
  run?: QueryRunner;
  /** Override the store-declared decision (tests / callers that know better). */
  storeDeclared?: boolean;
}): Promise<GateResult> {
  let policy: Policy;
  try {
    policy = (await resolvePolicy({ run: opts.run, storeDeclared: opts.storeDeclared })).policy;
  } catch (err) {
    if (err instanceof PolicyBlockedError) return { ok: false, code: err.code, error: err.message };
    return { ok: false, code: "policy-unavailable", error: UNAVAILABLE_MSG };
  }
  if (policy.listingsPaused) {
    return {
      ok: false,
      code: "paused",
      error: `Trading is paused.${policy.detail.listingsPaused.reason ? ` ${policy.detail.listingsPaused.reason}` : ""}`.trim(),
    };
  }
  const gated = (opts.products ?? []).some((p) =>
    ["future", "option", "race"].includes(String(p).toLowerCase()),
  );
  if (policy.geoFenceUs && gated) {
    const headers = opts.headers ?? (await currentHeaders());
    const country = headers ? requestCountry(headers) : undefined;
    // Absent or US => refused. Unknown is not allowed through: see the module
    // header for why a compliance control must not admit "I don't know".
    if (!country || country === "US") {
      return {
        ok: false,
        code: "geo",
        error: country
          ? "This product is not available in your jurisdiction."
          : "Your jurisdiction could not be verified, so this product is unavailable.",
      };
    }
  }
  return { ok: true };
}

/** Convenience wrapper that throws instead of returning a result. */
/** @public — intentional module API (kept for tests/callers outside knip's reach graph). */
export async function assertTradingAllowed(opts: {
  products?: string[];
  headers?: { get(name: string): string | null } | null;
  run?: QueryRunner;
  storeDeclared?: boolean;
}): Promise<void> {
  const r = await checkTradingAllowed(opts);
  if (!r.ok) throw new PolicyBlockedError(r.code, r.error);
}

async function currentHeaders(): Promise<{ get(name: string): string | null } | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    return req ? { get: (n: string) => req.headers.get(n) } : null;
  } catch {
    return null;
  }
}

/** Caller IP for audit logging on policy changes. */
export async function callerIpForAudit(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    return clientIp(getRequest()) ?? "unknown";
  } catch {
    return "unknown";
  }
}
