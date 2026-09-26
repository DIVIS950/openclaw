import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from "hono/cookie";
import type { Me } from "../shared/types.ts";
import { getUser, listUsers, reassignListings, sessionSecret, upsertUser, userForExtensionToken, type User } from "./store.ts";

/**
 * Sign-in with Google (OAuth 2.0 / OpenID Connect, authorization-code flow).
 * Without GOOGLE_CLIENT_ID the app runs in local mode with a single built-in user.
 */
const SESSION_COOKIE = "ss_session";
const STATE_COOKIE = "ss_oauth_state";
const SESSION_DAYS = 30;
export const LOCAL_USER = "local@snapsell";

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Running on a public cloud host: never allow the no-login local mode there. */
export const onCloud = () => Boolean(process.env.RENDER || process.env.SNAPSELL_CLOUD);

/** Public origin of the app, used for OAuth redirects. */
export function publicUrl(c: Context) {
  // Render sets RENDER_EXTERNAL_URL to the service's https://….onrender.com address.
  const configured = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

const isSecure = (c: Context) => publicUrl(c).startsWith("https://");

function allowed(email: string, isFirstUser: boolean) {
  const list = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // No list configured: the first Google account to sign in becomes the owner, nobody else gets in.
  return list.length ? list.includes(email) : isFirstUser;
}

export type Env = { Variables: { user: User } };

export async function startSession(c: Context, email: string) {
  await setSignedCookie(c, SESSION_COOKIE, email, await sessionSecret(), {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

/** Requires a signed-in user (or a paired Chrome extension token) for everything behind it. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const bearer = c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (bearer) {
    const u = await userForExtensionToken(bearer);
    if (!u) return c.json({ error: "Extension not paired. Pair it again from Connections." }, 401);
    c.set("user", u);
    return next();
  }
  if (!googleEnabled()) {
    // On the internet without Google login anyone could use it: stay locked until set up.
    if (onCloud()) return c.json({ error: "SnapSell isn't set up yet", setup: true }, 403);
    c.set("user", (await getUser(LOCAL_USER)) ?? (await upsertUser(LOCAL_USER, { name: "You" })));
    return next();
  }
  const email = await getSignedCookie(c, await sessionSecret(), SESSION_COOKIE);
  const user = email ? await getUser(email) : undefined;
  if (!user) return c.json({ error: "Please sign in" }, 401);
  c.set("user", user);
  return next();
};

export function me(user: User): Me {
  return { email: user.email, name: user.name, picture: user.picture, authEnabled: googleEnabled() };
}

export async function googleStart(c: Context) {
  if (!googleEnabled()) return c.redirect("/");
  const state = randomBytes(16).toString("hex");
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: isSecure(c), sameSite: "Lax", path: "/", maxAge: 600 });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${publicUrl(c)}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export async function googleCallback(c: Context) {
  const { code, state, error } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  if (error || !code || !state || state !== expected) return c.redirect("/#/?login=failed");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${publicUrl(c)}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await res.json()) as { id_token?: string };
  if (!res.ok || !tokens.id_token) return c.redirect("/#/?login=failed");

  // The ID token came straight from Google's token endpoint over TLS, so its claims can be
  // read without re-verifying the signature (OpenID Connect Core 3.1.3.7).
  const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    aud?: string;
  };
  const email = claims.email?.toLowerCase();
  if (!email || !claims.email_verified || claims.aud !== process.env.GOOGLE_CLIENT_ID) {
    return c.redirect("/#/?login=failed");
  }
  const existing = await getUser(email);
  const firstUser = !(await listUsers()).some((u) => u.email !== LOCAL_USER);
  if (!existing && !allowed(email, firstUser)) return c.redirect("/#/?login=denied");

  const local = firstUser ? await getUser(LOCAL_USER) : undefined;
  await upsertUser(email, { ...(local ? { settings: local.settings, ebay: local.ebay } : {}), name: claims.name ?? email, picture: claims.picture });
  if (firstUser) await reassignListings(LOCAL_USER, email);
  await startSession(c, email);
  return c.redirect("/");
}

export function logout(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
}
