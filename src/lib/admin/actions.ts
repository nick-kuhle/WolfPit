import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: { user: string; pass: string }) => d)
  .handler(async ({ data }) => {
    const { verifyPassword, setAdminCookie } = await import("./session.server");
    if (!verifyPassword(data.user.trim(), data.pass)) {
      return { ok: false as const, error: "Invalid credentials." };
    }
    setAdminCookie(data.user.trim());
    return { ok: true as const, user: data.user.trim() };
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
