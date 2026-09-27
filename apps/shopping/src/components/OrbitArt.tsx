"use client";

import { motion } from "motion/react";

/** Hero illustration: parcels orbiting a little planet. Decorative only. */
export function OrbitArt() {
  return (
    <div className="pointer-events-none relative mx-auto hidden aspect-square w-full max-w-[340px] md:block" aria-hidden>
      <svg viewBox="0 0 300 300" className="h-full w-full">
        <defs>
          <radialGradient id="planet" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.95" />
            <stop offset="1" stopColor="var(--accent-ink)" />
          </radialGradient>
        </defs>
        <circle cx="150" cy="150" r="118" fill="none" stroke="var(--line)" strokeDasharray="3 7" />
        <ellipse cx="150" cy="150" rx="140" ry="52" fill="none" stroke="var(--ink)" strokeOpacity="0.8" strokeWidth="2" transform="rotate(-22 150 150)" />
        <circle cx="150" cy="150" r="54" fill="url(#planet)" />
        <path d="M112 138 q20 -14 38 -2 t40 4" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" />
        <path d="M118 168 q18 10 34 2 t32 -2" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="5" strokeLinecap="round" />
      </svg>
      {[
        { glyph: "📦", dur: 14, delay: 0, r: 118 },
        { glyph: "✈️", dur: 10, delay: -4, r: 118 },
        { glyph: "🛍️", dur: 18, delay: -9, r: 118 },
      ].map((o) => (
        <motion.div
          key={o.glyph}
          className="absolute left-1/2 top-1/2 h-0 w-0"
          animate={{ rotate: 360 }}
          transition={{ duration: o.dur, repeat: Infinity, ease: "linear", delay: o.delay }}
        >
          <motion.span
            className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-xl shadow-[0_8px_20px_-10px_rgba(0,0,0,0.4)]"
            style={{ left: 0, top: -(o.r / 300) * 340 }}
            animate={{ rotate: -360 }}
            transition={{ duration: o.dur, repeat: Infinity, ease: "linear", delay: o.delay }}
          >
            {o.glyph}
          </motion.span>
        </motion.div>
      ))}
    </div>
  );
}
