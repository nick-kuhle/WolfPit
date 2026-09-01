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
 * FAIL-CLOSED, AND WHY THAT DIFFERS FROM THE RATE LIMITER
 *
 * `rate-limit.server.ts` deliberately fails OPEN: a DB hiccup must not take
 * down live swaps, and the cost is quota. That reasoning does not transfer. If
 * we cannot read the policy table we do not know whether trading is paused, so
 * a store error must reject. An operator who pauses the book during an incident
 * and then gets "store unavailable, request allowed" has been handed the worst
 * possible failure mode. The cost of failing closed is a few seconds of refused
 * orders; the cost of failing open is trading while paused.
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
import { getSql } from "../db";
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
  constructor(code: PolicyBlockedError["code"], message: string) {
    super(message);
    this.name = "PolicyBlockedError";
    this.code = code;
  }
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
  } catch {
    throw new PolicyBlockedError(
      "policy-unavailable",
      "Trading policy unavailable. Orders are refused until it can be read.",
    );
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

/** Read the live policy from the app database. */
export async function getPolicy(): Promise<Policy> {
  return readPolicy(await prodRun());
}

/** Admin write to the app database. */
export async function setPolicy(
  key: PolicyKey,
  value: boolean,
  opts: { reason?: string; by?: string } = {},
): Promise<Policy> {
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
  /** Injected for tests; defaults to the app database. */
  run?: QueryRunner;
}): Promise<GateResult> {
  let policy: Policy;
  try {
    policy = opts.run ? await readPolicy(opts.run) : await getPolicy();
  } catch (err) {
    if (err instanceof PolicyBlockedError) return { ok: false, code: err.code, error: err.message };
    return {
      ok: false,
      code: "policy-unavailable",
      error: "Trading policy unavailable. Orders are refused until it can be read.",
    };
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
export async function assertTradingAllowed(opts: {
  products?: string[];
  headers?: { get(name: string): string | null } | null;
  run?: QueryRunner;
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
