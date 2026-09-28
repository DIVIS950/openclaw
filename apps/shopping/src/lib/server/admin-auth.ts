import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// The admin page is protected by one password (ADMIN_PASSWORD). After login
// the browser holds an httpOnly cookie signed with AUTH_SECRET.
const COOKIE = "orbit_admin";
const MAX_AGE = 60 * 60 * 12;

export const adminConfigured = () => Boolean(process.env.ADMIN_PASSWORD && process.env.AUTH_SECRET);

function sign(value: string) {
  return createHmac("sha256", process.env.AUTH_SECRET!).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(password: string) {
  return adminConfigured() && safeEqual(sign(password), sign(process.env.ADMIN_PASSWORD!));
}

export async function startAdminSession() {
  const expires = Date.now() + MAX_AGE * 1000;
  (await cookies()).set(COOKIE, `${expires}.${sign(`admin.${expires}`)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endAdminSession() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin() {
  if (!adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [expires, sig] = raw.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, sign(`admin.${expires}`));
}
