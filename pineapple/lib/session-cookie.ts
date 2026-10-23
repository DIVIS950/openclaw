// Shared by lib/auth.ts and proxy.ts. `__Host-` forces Secure + Path=/ + no Domain in browsers.
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-pineapple_session" : "pineapple_session";
export const SESSION_DAYS = 30;
