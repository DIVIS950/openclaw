import path from "node:path";
import type { NextConfig } from "next";

// Strict security headers on every response. The CSP allows Google avatars and
// Google sign-in; everything else is same-origin.
const stripe = "https://js.stripe.com https://*.js.stripe.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${stripe}` + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  // Product photos come from shop sites; avatars from Google.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.stripe.com",
  `frame-src ${stripe} https://hooks.stripe.com`,
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This app lives inside a bigger repo; trace files from here, not the repo root.
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self \"https://js.stripe.com\")" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
