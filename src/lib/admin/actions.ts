import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: { user: string; pass: string }) => d)
  .handler(async ({ data }) => {
    const { verifyPassword, setAdminCookie } = await import("./session.server");
    const { clientIp, checkAdminLogin, recordAdminLoginFailure, resetAdminLogin } = await import(
      "../auth/rate-limit.server"
    );
    const { getRequest } = await import("@tanstack/react-start/server");
    const user = data.user.trim();

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
  const { readAdminUser } = await import("./session.server");
  const user = readAdminUser();
  return { user };
});
