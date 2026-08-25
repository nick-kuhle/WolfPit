import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const COOKIE = "wp_admin";
const MAX_AGE = 12 * 60 * 60;

function secret() {
  return process.env.ADMIN_SESSION_SECRET ?? "wolfpit-dev-admin-secret-not-for-prod";
}

export function adminCredentials() {
  return {
    user: process.env.ADMIN_USER ?? "admin",
    pass: process.env.ADMIN_PASS ?? "admin",
  };
}

function hmac(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function eq(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
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
