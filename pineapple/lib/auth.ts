import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { SESSION_COOKIE, SESSION_DAYS } from "./session-cookie";

const MAX_FAILED_TRIES = 5;
const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;
const MIN_PASSWORD_LENGTH = 10;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

async function clearSessionCookie(): Promise<void> {
  // Re-set with the same attributes (a __Host- cookie is only replaced when Secure is present).
  (await cookies()).set(SESSION_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison of SHA-256 hashes, so timing does not leak the password. */
function passwordMatches(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(input), sha256(expected));
}

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; lockedUntil?: string };

function lockMessage(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Too many wrong tries. Locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`;
}

export async function login(password: string): Promise<LoginResult> {
  const expected = process.env.APP_PASSWORD ?? "";
  if (expected.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `APP_PASSWORD is missing or shorter than ${MIN_PASSWORD_LENGTH} characters. Set it in Vercel.` };
  }

  const [state] = await sql<{ locked_until: Date | null }>`SELECT locked_until FROM auth_state WHERE id = 1`;
  if (state?.locked_until && state.locked_until.getTime() > Date.now()) {
    // While locked, the password is not even checked, so guesses are useless.
    return { ok: false, error: lockMessage(state.locked_until), lockedUntil: state.locked_until.toISOString() };
  }

  if (!passwordMatches(password, expected)) {
    // Every 5th consecutive failure locks the login; each new lock doubles (15 min, 30 min, ... max 24 h).
    const [after] = await sql<{ failed_count: number; locked_until: Date | null }>`
      UPDATE auth_state SET
        failed_count = failed_count + 1,
        locked_until = CASE
          WHEN (failed_count + 1) % ${MAX_FAILED_TRIES} = 0
          THEN now() + make_interval(mins => LEAST(${MAX_LOCK_MINUTES}::int,
                 ${BASE_LOCK_MINUTES}::int * power(2, (failed_count + 1) / ${MAX_FAILED_TRIES} - 1)::int))
          ELSE locked_until
        END
      WHERE id = 1
      RETURNING failed_count, locked_until`;
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (after?.locked_until && after.locked_until.getTime() > Date.now()) {
      return { ok: false, error: lockMessage(after.locked_until), lockedUntil: after.locked_until.toISOString() };
    }
    const left = MAX_FAILED_TRIES - ((after?.failed_count ?? 0) % MAX_FAILED_TRIES);
    return { ok: false, error: `Wrong password. ${left} ${left === 1 ? "try" : "tries"} left before lockout.` };
  }

  await sql`UPDATE auth_state SET failed_count = 0, locked_until = NULL WHERE id = 1`;
  await sql`DELETE FROM sessions WHERE expires_at < now()`;

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  // Only a hash of the token is stored, so a database leak cannot be replayed as a cookie.
  await sql`INSERT INTO sessions (token_hash, expires_at) VALUES (${sha256(token).toString("hex")}, ${expires})`;

  (await cookies()).set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, expires });
  return { ok: true };
}

export async function hasValidSession(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return false;
  const rows = await sql`
    SELECT 1 FROM sessions WHERE token_hash = ${sha256(token).toString("hex")} AND expires_at > now()`;
  return rows.length === 1;
}

/** For pages and server actions: sends anyone without a valid session to /login. */
export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) redirect("/login");
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token).toString("hex")}`;
  await clearSessionCookie();
}

/** Signs out every device (used from Settings). */
export async function logoutEverywhere(): Promise<void> {
  await sql`DELETE FROM sessions`;
  await clearSessionCookie();
}
