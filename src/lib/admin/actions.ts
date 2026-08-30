import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: { user: string; pass: string }) => d)
  .handler(async ({ data }) => {
    const { verifyPassword, setAdminCookie } = await import("./session.server");
    const { guardAdminLogin } = await import("../auth/rate-limit.server");
    const user = data.user.trim();
    // Shared DB-backed throttle (same wolfpit_rate_limit table as /api/auth):
    // 5 attempts / 15 min per username ACROSS all instances, fail-closed when
    // the store is unreachable. No IP dimension on this surface (no request
    // plumbing in this TanStack Start version) — brute-forcing the single
    // admin account is the threat the per-user window bounds.
    const throttle = await guardAdminLogin(user);
    if ("storeError" in throttle) {
      return { ok: false as const, error: "Auth store unavailable; request not processed." };
    }
    if (throttle.blocked) {
      return {
        ok: false as const,
        error: `Too many attempts. Retry in ${Math.ceil(throttle.retryAfterSec / 60)} min.`,
      };
    }
    if (!verifyPassword(user, data.pass)) {
      // Constant-ish failure latency to blunt user-enumeration timing.
      await new Promise((r) => setTimeout(r, 250));
      return { ok: false as const, error: "Invalid credentials." };
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
