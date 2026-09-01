import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: { user: string; pass: string }) => d)
  .handler(async ({ data }) => {
    const { verifyPassword, setAdminCookie, adminAuthStatus } = await import("./session.server");
    const { clientIp, checkAdminLogin, recordAdminLoginFailure, resetAdminLogin } = await import(
      "../auth/rate-limit.server"
    );
    const { getRequest } = await import("@tanstack/react-start/server");
    const user = data.user.trim();

    // Configuration is not a credential failure: say so, rather than throwing
    // and leaving the page silent. Fail closed either way — nobody signs in.
    const configured = adminAuthStatus();
    if (!configured.ok) return { ok: false as const, error: configured.error };

    // Request plumbing: getRequest() IS available from server-function handlers
    // (the auth isolation middleware already relies on it), so the throttle
    // gates BOTH the single admin username (5 / 15 min) and the caller IP
    // (20 / 15 min), shared across all serverless instances via the app DB.
    const ip = clientIp(getRequest());

    // Read-only pre-check — does NOT count (only failures count, below).
    const pre = await checkAdminLogin(user, ip);
    if ("storeError" in pre) {
      return { ok: false as const, error: "Auth store unavailable; request not processed." };
    }
    if (pre.blocked) {
      return {
        ok: false as const,
        error: `Too many attempts. Retry in ${Math.ceil(pre.retryAfterSec / 60)} min.`,
      };
    }

    if (!verifyPassword(user, data.pass)) {
      // Count ONLY failures. A store error here still fails the login closed —
      // the attempt is simply not allowed to proceed uncounted.
      const after = await recordAdminLoginFailure(user, ip);
      if ("storeError" in after) {
        return { ok: false as const, error: "Auth store unavailable; request not processed." };
      }
      // Constant-ish failure latency to blunt user-enumeration timing.
      await new Promise((r) => setTimeout(r, 250));
      return { ok: false as const, error: "Invalid credentials." };
    }

    // Successful login: clear the counter so ops never locks itself out.
    try {
      await resetAdminLogin(user, ip);
    } catch (err) {
      // Best-effort: a lingering counter can only make the throttle stricter,
      // and the login itself already succeeded — report, do not reject.
      console.error("[admin] login throttle reset failed:", err);
    }
    setAdminCookie(user);
    return { ok: true as const, user };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAdminCookie } = await import("./session.server");
  clearAdminCookie();
  return { ok: true as const };
});

export const adminWhoami = createServerFn({ method: "GET" }).handler(async () => {
  const { readAdminUser, adminAuthStatus } = await import("./session.server");
  const user = readAdminUser();
  // `configured` lets the sign-in page tell an operator that no credentials
  // exist on this deployment BEFORE they type a password that cannot work.
  const status = adminAuthStatus();
  return { user, configured: status.ok, configError: status.ok ? null : status.error };
});

/* ------------------------------------------------------------------ *
 * WP-07 / #13 — trading policy (pause + geo-fence), server-owned
 * ------------------------------------------------------------------ */

/**
 * The client used to OWN these flags (Zustand + localStorage), which meant
 * pause applied to one browser and the geo-fence could be lifted from
 * devtools. These functions make the server the owner; the client store
 * mirrors what it reads back.
 */
export const getTradingPolicy = createServerFn({ method: "GET" }).handler(async () => {
  const { policyStatus } = await import("./policy.server");
  // policyStatus never throws: the operator must be able to SEE the state of
  // the control, including "there is no shared store behind it".
  const s = await policyStatus();
  if (s.source === "unavailable") {
    return { ok: false as const, error: s.error ?? "Policy store unavailable.", unavailable: true as const };
  }
  return {
    ok: true as const,
    policy: s.policy,
    source: s.source,
    shared: s.shared,
    writable: s.writable,
    degraded: s.degraded ?? null,
  };
});

export const setTradingPolicy = createServerFn({ method: "POST" })
  .validator(
    (d: { key: "listingsPaused" | "geoFenceUs"; value: boolean; reason?: string }): {
      key: "listingsPaused" | "geoFenceUs";
      value: boolean;
      reason: string;
    } => ({
      key: d.key === "geoFenceUs" ? "geoFenceUs" : "listingsPaused",
      value: Boolean(d.value),
      reason: typeof d.reason === "string" ? d.reason.trim().slice(0, 200) : "",
    }),
  )
  .handler(async ({ data }) => {
    const { readAdminUser } = await import("./session.server");
    const { setPolicy, callerIpForAudit } = await import("./policy.server");
    // Changing the pause switch or a compliance boundary is a privileged write.
    const admin = readAdminUser();
    if (!admin) return { ok: false as const, error: "Admin sign-in required." };
    const by = `${admin}@${await callerIpForAudit()}`;
    try {
      const policy = await setPolicy(data.key, data.value, { reason: data.reason, by });
      return { ok: true as const, policy };
    } catch (err) {
      // Surface WHY: "no shared store" is an operator action item (set
      // DATABASE_URL / use the env kill switch), not a transient blip.
      const detail = err instanceof Error ? err.message : "";
      return {
        ok: false as const,
        error: detail.startsWith("No shared policy store")
          ? detail
          : "Policy store unavailable; change not applied.",
      };
    }
  });
