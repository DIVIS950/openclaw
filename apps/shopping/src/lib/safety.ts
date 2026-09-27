import type { Store } from "./data";

export type SafetyLevel = "safe" | "caution" | "danger";

export type SafetyReport = {
  score: number; // 0-100
  level: SafetyLevel;
  checks: { label: string; ok: boolean }[];
  flags: string[];
};

/**
 * Heuristic trust score. Mirrors what the AI check looks at (domain age, TLS,
 * review volume/quality, return policy, price anomaly) so demo mode and the
 * Claude-backed check agree on the obvious cases.
 */
export function assessStore(store: Store, price?: number, typicalPrice?: number): SafetyReport {
  const priceRatio = price && typicalPrice ? price / typicalPrice : 1;
  const checks = [
    { label: "Secure connection (HTTPS)", ok: store.https },
    { label: `Domain age ${store.domainAgeYears >= 1 ? `${Math.round(store.domainAgeYears)} yrs` : "< 1 yr"}`, ok: store.domainAgeYears >= 2 },
    { label: `${store.rating.toFixed(1)}★ from ${compact(store.reviews)} reviews`, ok: store.rating >= 4 && store.reviews >= 1000 },
    { label: store.returnsDays ? `${store.returnsDays}-day returns` : "No return policy", ok: store.returnsDays >= 14 },
    { label: priceRatio < 0.6 ? "Price far below market" : "Price in normal range", ok: priceRatio >= 0.6 },
  ];

  let score = 100;
  if (!store.https) score -= 40;
  if (store.domainAgeYears < 1) score -= 30;
  else if (store.domainAgeYears < 2) score -= 10;
  if (store.reviews < 1000) score -= 20;
  score -= Math.max(0, (4.5 - store.rating) * 12);
  if (store.returnsDays < 14) score -= 10;
  if (priceRatio < 0.6) score -= 25;
  score -= store.flags.length * 3;
  score = Math.max(1, Math.min(99, Math.round(score)));

  const level: SafetyLevel = score >= 75 ? "safe" : score >= 50 ? "caution" : "danger";
  return { score, level, checks, flags: store.flags };
}

function compact(n: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}
