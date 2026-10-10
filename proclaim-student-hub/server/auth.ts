// Only signed-in students may use the AI endpoints (they cost money), so each
// request carries the user's Google access token, which we check with Google.

interface TokenInfo {
  aud?: string;
  azp?: string;
  email?: string;
  email_verified?: string | boolean;
  expires_in?: string | number;
  error_description?: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

const cache = new Map<string, { email: string; until: number }>();
const CACHE_MS = 5 * 60 * 1000;

/**
 * allowList entries are full emails ("student@school.org") or domains
 * ("@school.org"). An empty list lets any Google account in.
 */
export function isAllowed(email: string, allowList: string[]): boolean {
  if (allowList.length === 0) {
    return true;
  }
  const lower = email.toLowerCase();
  return allowList.some((entry) =>
    entry.startsWith("@") ? lower.endsWith(entry) : lower === entry,
  );
}

export async function verifyGoogleToken(
  token: string,
  clientId: string,
  allowList: string[],
): Promise<string> {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.until > now) {
    return hit.email;
  }

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
  );
  const info = (await res.json()) as TokenInfo;
  if (!res.ok) {
    throw new AuthError("Your Google sign-in has expired. Please sign in again.", 401);
  }
  // The token must have been issued to this app, not some other app.
  if (info.aud !== clientId && info.azp !== clientId) {
    throw new AuthError("This sign-in belongs to a different app.", 401);
  }
  const verified = info.email_verified === true || info.email_verified === "true";
  if (!info.email || !verified) {
    throw new AuthError("Couldn't confirm your Google email address.", 401);
  }
  if (!isAllowed(info.email, allowList)) {
    throw new AuthError("This Google account isn't allowed to use the AI in this app.", 403);
  }

  const expiresMs = Number(info.expires_in ?? 0) * 1000;
  cache.set(token, { email: info.email, until: now + Math.min(CACHE_MS, expiresMs) });
  if (cache.size > 500) {
    for (const [key, value] of cache) {
      if (value.until <= now) {
        cache.delete(key);
      }
    }
  }
  return info.email;
}

/** Simple fixed-window limiter: at most `limit` AI calls per user per minute. */
export function createRateLimiter(limit: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now - w.start > 60_000) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= limit;
  };
}
