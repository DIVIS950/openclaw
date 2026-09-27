"use client";

import { Flag, Gauge, MapPin, Truck } from "lucide-react";
import { motion } from "motion/react";
import { distanceKm } from "@/lib/geo";
import type { Parcel } from "@/lib/parcels";

/** Side-view driving scene: the van stays centred while the world scrolls past. */
export function RoadTrip({ parcel, progress, eta }: { parcel: Parcel; progress: number; eta: number }) {
  const km = distanceKm(parcel.from.coords, parcel.to.coords) * 1.25; // roads are longer than straight lines
  const left = Math.max(0, Math.round(km * (1 - progress)));
  const delivered = progress >= 1;
  const hoursLeft = Math.max(0, (eta - Date.now()) / 36e5);

  return (
    <motion.div initial={{ y: 24 }} animate={{ y: 0 }} transition={{ delay: 0.2 }} className="card overflow-hidden rounded-[26px]">
      <div className="flex items-center justify-between bg-ink px-5 py-3 text-bg">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]">
          <Truck size={16} /> On the road
        </div>
        <div className="font-mono text-xs opacity-70">{parcel.trackingNumber}</div>
      </div>

      <svg viewBox="0 0 600 150" className="block w-full" aria-hidden>
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent-soft)" />
            <stop offset="1" stopColor="var(--surface)" />
          </linearGradient>
        </defs>
        <rect width="600" height="150" fill="url(#sky)" />
        <circle cx="500" cy="38" r="16" fill="var(--accent)" opacity="0.5" />
        {/* hills + trees scroll at different speeds for parallax */}
        <g style={{ animation: delivered ? undefined : "scroll-slow 14s linear infinite" }}>
          {[0, 600].map((o) => (
            <path key={o} transform={`translate(${o},0)`} d="M0 100 Q60 60 130 92 T260 88 T400 80 T520 94 T600 100 V110 H0Z" fill="var(--land)" />
          ))}
        </g>
        <g style={{ animation: delivered ? undefined : "scroll-fast 4s linear infinite" }}>
          {[0, 600].map((o) =>
            [40, 150, 230, 370, 480].map((x) => (
              <g key={o + x} transform={`translate(${o + x},96)`}>
                <rect x={-1.5} y={-2} width={3} height={10} fill="var(--muted)" opacity={0.6} />
                <circle cy={-10} r={9} fill="var(--ok)" opacity={0.55} />
              </g>
            )),
          )}
        </g>
        <rect y="108" width="600" height="42" fill="var(--muted)" opacity="0.28" />
        <line x1="0" x2="600" y1="129" y2="129" stroke="var(--surface)" strokeWidth="3" strokeDasharray="24 24" style={{ animation: delivered ? undefined : "road-dash 0.5s linear infinite" }} />
        {/* van */}
        {/* CSS animations override the SVG transform attribute, so they go on inner groups. */}
        <g transform="translate(250,90)">
        <g style={{ animation: delivered ? undefined : "bob 0.5s ease-in-out infinite" }}>
          <rect x="0" y="0" width="74" height="34" rx="6" fill="var(--accent)" />
          <path d="M74 8 H92 L104 22 V34 H74Z" fill="var(--accent-ink)" />
          <path d="M78 11 H90 L99 22 H78Z" fill="#2b2a26" opacity="0.75" />
          <rect x="8" y="9" width="38" height="12" rx="3" fill="#fff" opacity="0.9" />
          <text x="27" y="18.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="var(--accent-ink)">ORBIT</text>
          {[18, 84].map((cx) => (
            <g key={cx} transform={`translate(${cx},36)`}>
              <circle r="9" fill="#2b2a26" />
              <g style={{ animation: delivered ? undefined : "spin 0.6s linear infinite", transformBox: "fill-box", transformOrigin: "center" }}>
                <circle r="4" fill="var(--surface)" />
                <rect x="-1" y="-4" width="2" height="8" fill="#2b2a26" />
              </g>
            </g>
          ))}
          <circle cx="104" cy="28" r="2.5" fill="#ffe7a3" />
        </g>
        </g>
        {/* destination flag slides in near the end */}
        <g transform={`translate(${Math.max(390, 600 - progress * 180)},70)`}>
          <line x1="0" x2="0" y1="0" y2="40" stroke="var(--ink)" strokeWidth="2" />
          <path d="M0 0 H22 L16 7 L22 14 H0Z" fill="var(--accent)" />
        </g>
      </svg>

      <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
        <Stat icon={<MapPin size={14} />} label="Left" value={delivered ? "Arrived" : `${left} km`} />
        <Stat icon={<Gauge size={14} />} label="Speed" value={delivered ? "—" : "~78 km/h"} />
        <Stat icon={<Flag size={14} />} label="In" value={delivered ? "Delivered" : hoursLeft < 1 ? "< 1 h" : hoursLeft < 24 ? `${Math.round(hoursLeft)} h` : `${Math.round(hoursLeft / 24)} d`} />
      </div>
      <style>{`
        @keyframes scroll-slow { to { transform: translateX(-600px); } }
        @keyframes scroll-fast { to { transform: translateX(-600px); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </motion.div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
