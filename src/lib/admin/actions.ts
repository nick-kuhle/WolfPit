import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: { user: string; pass: string }) => d)
  .handler(async ({ data }) => {
    const { verifyPassword, setAdminCookie, loginBlocked, recordLogin } = await import("./session.server");
    const user = data.user.trim();
    // Throttle key: username (single admin account — this server-fn has no
    // request plumbing in this TanStack Start version; per-user is the unit
    // that matters against credential brute force).
    const key = `user|${user}`;
    const wait = loginBlocked(key);
    if (wait > 0) {
      return { ok: false as const, error: `Too many attempts. Retry in ${Math.ceil(wait / 60)} min.` };
    }
    if (!verifyPassword(user, data.pass)) {
      recordLogin(key, false);
      // Constant-ish failure latency to blunt user-enumeration timing.
      await new Promise((r) => setTimeout(r, 250));
      return { ok: false as const, error: "Invalid credentials." };
    }
    recordLogin(key, true);
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
