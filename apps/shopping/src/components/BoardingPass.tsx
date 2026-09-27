"use client";

import { Plane } from "lucide-react";
import { motion } from "motion/react";
import type { Parcel } from "@/lib/parcels";

const fmtTime = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Barcode bars derived from the tracking number so each pass looks unique. */
function Barcode({ code, vertical }: { code: string; vertical?: boolean }) {
  let h = 2166136261;
  const bars: number[] = [];
  for (let i = 0; i < 46; i++) {
    h ^= code.charCodeAt(i % code.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    bars.push(1 + (h % 3));
  }
  let x = 0;
  const rects = bars.map((w, i) => {
    const r = i % 2 === 0 ? <rect key={i} x={x} y={0} width={w} height={40} fill="currentColor" /> : null;
    x += w;
    return r;
  });
  return (
    <svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" className={vertical ? "h-full w-10 -rotate-90 origin-center" : "h-12 w-full"} aria-hidden>
      {rects}
    </svg>
  );
}

export function BoardingPass({ parcel, progress, eta }: { parcel: Parcel; progress: number; eta: number }) {
  const f = parcel.flight ?? { number: "OR 101", gate: "A1", seat: "1A" };
  return (
    <motion.div
      initial={{ y: 30, rotateX: 25 }}
      animate={{ y: 0, rotateX: 0 }}
      transition={{ type: "spring", damping: 18, stiffness: 120, delay: 0.2 }}
      whileHover={{ y: -3, rotate: -0.4 }}
      style={{ transformPerspective: 900 }}
      className="relative flex flex-col overflow-hidden rounded-[26px] bg-surface shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] ring-1 ring-line sm:flex-row"
    >
      <div className="flex-1">
        <div className="flex items-center justify-between bg-accent px-5 py-3 text-white">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em]">Orbit Air · Boarding pass</div>
          <Plane size={18} />
        </div>

        <div className="px-5 pt-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="font-serif text-5xl font-semibold leading-none tracking-tight">{parcel.from.iata}</div>
              <div className="mt-1 text-xs text-muted">{parcel.from.city}</div>
            </div>
            <div className="relative mb-5 h-6 flex-1">
              <div className="absolute inset-x-1 top-1/2 border-t-2 border-dashed border-line" />
              <div className="absolute left-1 top-1/2 h-0.5 -translate-y-px bg-accent" style={{ width: `calc(${progress * 100}% - 8px)` }} />
              <motion.div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent" initial={{ left: "0%" }} animate={{ left: `${Math.max(4, Math.min(96, progress * 100))}%` }} transition={{ duration: 2.5, ease: "easeInOut" }}>
                <Plane size={20} fill="currentColor" className="rotate-45" />
              </motion.div>
            </div>
            <div className="text-right">
              <div className="font-serif text-5xl font-semibold leading-none tracking-tight">{parcel.to.iata}</div>
              <div className="mt-1 text-xs text-muted">{parcel.to.city}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-3 pb-5">
            <Field label="Passenger" value={parcel.title} span />
            <Field label="Flight" value={f.number} />
            <Field label="Gate" value={f.gate} />
            <Field label="Seat" value={f.seat} />
            <Field label="Class" value="Parcel" />
            <Field label="Departed" value={fmtTime(parcel.shippedAt)} span />
            <Field label="Arrives (AI)" value={fmtTime(eta)} span accent />
          </div>
        </div>
      </div>

      {/* perforation */}
      <div className="relative sm:w-0">
        <div className="mx-5 border-t-2 border-dashed border-line sm:mx-0 sm:my-5 sm:h-[calc(100%-2.5rem)] sm:border-l-2 sm:border-t-0" />
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-bg sm:-left-3 sm:-top-3" />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-bg sm:-bottom-3 sm:-left-3 sm:right-auto sm:top-auto" />
      </div>

      <div className="flex items-center gap-4 px-5 py-4 sm:w-44 sm:flex-col sm:justify-center sm:py-5">
        <div className="flex-1 sm:flex-none">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{parcel.carrier.split(" ")[0]}</div>
          <div className="font-mono text-sm font-semibold">{f.number}</div>
          <div className="text-xs text-muted">Seat {f.seat}</div>
        </div>
        <div className="w-40 text-ink sm:w-full">
          <Barcode code={parcel.trackingNumber} />
          <div className="mt-1 text-center font-mono text-[10px] tracking-widest text-muted">{parcel.trackingNumber}</div>
        </div>
      </div>
    </motion.div>
  );
}

function Field({ label, value, span, accent }: { label: string; value: string; span?: boolean; accent?: boolean }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>
      <div className={`truncate text-sm font-semibold ${accent ? "text-accent-ink" : ""}`}>{value}</div>
    </div>
  );
}
