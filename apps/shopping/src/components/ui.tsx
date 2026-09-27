"use client";

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { Product } from "@/lib/data";
import { cn } from "@/lib/format";
import type { SafetyLevel } from "@/lib/safety";

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="7" fill="var(--accent)" />
        <ellipse cx="16" cy="16" rx="14" ry="5.5" fill="none" stroke="var(--ink)" strokeWidth="1.8" transform="rotate(-24 16 16)" />
      </svg>
      <span className="font-serif text-xl font-semibold tracking-tight">Orbit</span>
    </span>
  );
}

export function Avatar({ name, image, size = 32 }: { name: string; image?: string; size?: number }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} className="rounded-full" referrerPolicy="no-referrer" />;
  }
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span style={{ width: size, height: size }} className="grid place-items-center rounded-full bg-accent text-xs font-semibold text-white">
      {initials || "•"}
    </span>
  );
}

export function ProductArt({ product, className, big }: { product: Product; className?: string; big?: boolean }) {
  return (
    <div
      className={cn("relative grid place-items-center overflow-hidden rounded-2xl", className)}
      style={{ background: `radial-gradient(120% 90% at 30% 20%, ${product.art.from}, ${product.art.to})` }}
    >
      <span className={cn("drop-shadow-[0_12px_18px_rgba(0,0,0,0.18)] select-none", big ? "text-[7rem]" : "text-6xl")}>{product.art.glyph}</span>
      <span className="absolute left-3 top-3 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-700 backdrop-blur">
        {product.brand}
      </span>
    </div>
  );
}

const LEVEL = {
  safe: { icon: ShieldCheck, text: "Trusted", cls: "bg-ok-soft text-ok" },
  caution: { icon: ShieldQuestion, text: "Caution", cls: "bg-warn-soft text-warn" },
  danger: { icon: ShieldAlert, text: "Likely scam", cls: "bg-bad-soft text-bad" },
} as const;

export function TrustBadge({ level, score }: { level: SafetyLevel; score?: number }) {
  const l = LEVEL[level];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", l.cls)}>
      <l.icon size={13} />
      {l.text}
      {score !== undefined && <span className="opacity-70">· {score}</span>}
    </span>
  );
}

export function ScoreRing({ score, level, size = 44 }: { score: number; level: SafetyLevel; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const color = level === "safe" ? "var(--ok)" : level === "caution" ? "var(--warn)" : "var(--bad)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Trust score ${score} of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.3} fontWeight={700} fill="var(--ink)">
        {score}
      </text>
    </svg>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-end justify-between">
      <h2 className="font-serif text-xl font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
