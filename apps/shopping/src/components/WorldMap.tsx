"use client";

import { geoDistance, geoGraticule10, geoInterpolate, geoMercator, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { LngLat } from "@/lib/geo";
import type { Parcel } from "@/lib/parcels";

const W = 800;
const H = 520;

const cache = new Map<string, Promise<FeatureCollection>>();
function loadCountries(url: string) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then((r) => r.json())
        .then((topo: Topology) => feature(topo, topo.objects.countries) as unknown as FeatureCollection),
    );
  }
  return cache.get(url)!;
}

/** Deterministic "road" between two points: a straight line with gentle bends. */
function roadPoints(a: LngLat, b: LngLat, n = 48): LngLat[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const amp = len * 0.07;
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n;
    const off = Math.sin(f * Math.PI) * (Math.sin(f * Math.PI * 3) * amp + Math.sin(f * Math.PI * 7) * amp * 0.25);
    return [a[0] + dx * f + nx * off, a[1] + dy * f + ny * off];
  });
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Animates from 0 to `target` on mount / replay, then tracks `target`. */
function useIntro(target: number, replayKey: number) {
  const [t, setT] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    done.current = false;
    const start = performance.now();
    const dur = 3200;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      setT(ease(k) * target);
      if (k < 1) raf = requestAnimationFrame(tick);
      else done.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);
  useEffect(() => {
    if (done.current) setT(target);
  }, [target]);
  return t;
}

export function WorldMap({ parcel, progress }: { parcel: Parcel; progress: number }) {
  const air = parcel.mode === "air";
  const [countries, setCountries] = useState<Feature<Geometry>[]>([]);
  const [replay, setReplay] = useState(0);
  const t = useIntro(progress, replay);
  const from = parcel.from.coords;
  const to = parcel.to.coords;

  useEffect(() => {
    let alive = true;
    loadCountries(air ? "/countries-110m.json" : "/countries-50m.json").then((fc) => alive && setCountries(fc.features));
    return () => {
      alive = false;
    };
  }, [air]);

  const road = useMemo(() => roadPoints(from, to), [from, to]);

  const projection: GeoProjection = useMemo(() => {
    if (air) {
      const mid = geoInterpolate(from, to)(0.5);
      const p = geoOrthographic().rotate([-mid[0], -mid[1] + 8]).clipAngle(90);
      p.fitExtent([[20, 20], [W - 20, H - 20]], { type: "Sphere" });
      const base = p.scale();
      // Zoom in for shorter flights so the route fills the frame.
      const ang = geoDistance(from, to);
      p.scale(base * Math.min(3.2, Math.max(1, 1.6 / Math.max(ang, 0.2)))).translate([W / 2, H / 2 + 20]);
      return p;
    }
    return geoMercator().fitExtent(
      [[90, 70], [W - 90, H - 70]],
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: road } },
    );
  }, [air, from, to, road]);

  const path = useMemo(() => geoPath(projection), [projection]);
  const land = useMemo(() => countries.map((c) => path(c) ?? "").join(""), [countries, path]);
  const sphere = useMemo(() => (air ? path({ type: "Sphere" }) ?? "" : ""), [air, path]);
  const graticule = useMemo(() => (air ? path(geoGraticule10()) ?? "" : ""), [air, path]);

  // Vehicle position + heading.
  let pos: [number, number];
  let angle: number;
  let traveled: string;
  let remaining: string;
  if (air) {
    const interp = geoInterpolate(from, to);
    const here = interp(t);
    const ahead = interp(Math.min(1, t + 0.01));
    const back = interp(Math.max(0, t - 0.01));
    pos = projection(here) ?? [W / 2, H / 2];
    const a = projection(t < 0.99 ? ahead : here) ?? pos;
    const b = projection(t < 0.99 ? here : back) ?? pos;
    angle = (Math.atan2(a[1] - b[1], a[0] - b[0]) * 180) / Math.PI;
    traveled = path({ type: "LineString", coordinates: [from, here] }) ?? "";
    remaining = path({ type: "LineString", coordinates: [here, to] }) ?? "";
  } else {
    const pts = road.map((c) => projection(c) ?? [0, 0]);
    const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const total = seg.reduce((s, x) => s + x, 0);
    let dist = t * total;
    let i = 0;
    while (i < seg.length - 1 && dist > seg[i]) dist -= seg[i++];
    const f = seg[i] ? dist / seg[i] : 0;
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    pos = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    const d = (p: number[][]) => "M" + p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("L");
    traveled = d([...pts.slice(0, i + 1), pos]);
    remaining = d([pos, ...pts.slice(i + 1)]);
  }

  const A = projection(from) ?? [0, 0];
  const B = projection(to) ?? [0, 0];
  const labelFrom = air ? parcel.from.iata : parcel.from.city;
  const labelTo = air ? parcel.to.iata : parcel.to.city;

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-line" style={{ background: air ? "radial-gradient(90% 80% at 50% 40%, var(--surface), var(--bg))" : "var(--ocean)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Map of parcel route from ${parcel.from.city} to ${parcel.to.city}`}>
        <defs>
          <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="6" stdDeviation="5" floodOpacity="0.25" />
          </filter>
          <radialGradient id="globe-shade" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.12" />
          </radialGradient>
        </defs>

        {air && <path d={sphere} fill="var(--ocean)" stroke="var(--line)" />}
        {air && <path d={graticule} fill="none" stroke="var(--line)" strokeWidth={0.6} />}
        <path d={land} fill="var(--land)" stroke="var(--land-line)" strokeWidth={air ? 0.5 : 0.8} strokeLinejoin="round" />
        {air && <path d={sphere} fill="url(#globe-shade)" pointerEvents="none" />}

        {/* route */}
        {air ? (
          <>
            <path d={remaining} fill="none" stroke="var(--muted)" strokeWidth={3} strokeDasharray="2 9" strokeLinecap="round" opacity={0.8} />
            <path d={traveled} fill="none" stroke="var(--accent)" strokeWidth={4} strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d={traveled + remaining.replace(/^M/, "L")} fill="none" stroke="var(--surface)" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
            <path d={remaining} fill="none" stroke="var(--muted)" strokeOpacity={0.45} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
            <path d={traveled} fill="none" stroke="var(--accent)" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
            <path d={remaining} fill="none" stroke="var(--surface)" strokeWidth={1.4} strokeDasharray="6 6" style={{ animation: "road-dash 1.2s linear infinite" }} />
          </>
        )}

        {/* endpoints */}
        <Pin x={A[0]} y={A[1]} label={labelFrom} sub={air ? parcel.from.city : "Warehouse"} />
        <Pin x={B[0]} y={B[1]} label={labelTo} sub={air ? parcel.to.city : "You"} home />

        {/* vehicle */}
        {/* Both glyphs are top-down views, so rotating by the heading is enough. */}
        <g transform={`translate(${pos[0]},${pos[1]}) rotate(${angle})`} filter="url(#soft)">
          <g style={{ animation: "bob 0.9s ease-in-out infinite" }}>{air ? <PlaneGlyph /> : <CarGlyph />}</g>
        </g>
      </svg>

      <button onClick={() => setReplay((r) => r + 1)} className="btn btn-ghost absolute right-3 top-3 h-9 gap-1.5 px-3 text-xs" aria-label="Replay journey">
        <RotateCcw size={14} /> Replay
      </button>
      <div className="absolute bottom-3 left-3 rounded-full bg-surface/85 px-3 py-1 text-xs font-semibold backdrop-blur">
        {Math.round(t * 100)}% of the way
      </div>
    </div>
  );
}

function Pin({ x, y, label, sub, home }: { x: number; y: number; label: string; sub: string; home?: boolean }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {home && <circle r={6} fill="none" stroke="var(--accent)" strokeWidth={2} style={{ animation: "pulse-ring 1.8s ease-out infinite" }} />}
      <circle r={8} fill={home ? "var(--accent)" : "var(--ink)"} stroke="var(--surface)" strokeWidth={3} />
      {/* Sized for phones: the 800px viewBox is often shown at ~360px wide. */}
      <g transform="translate(0,-20)">
        <rect x={-58} y={-44} width={116} height={50} rx={16} fill="var(--surface)" stroke="var(--line)" filter="url(#soft)" />
        <text textAnchor="middle" y={-18} fontSize={21} fontWeight={700} fill="var(--ink)">
          {label.length > 10 ? label.slice(0, 9) + "…" : label}
        </text>
        <text textAnchor="middle" y={-1} fontSize={13} fill="var(--muted)">
          {sub.length > 12 ? sub.slice(0, 11) + "…" : sub}
        </text>
      </g>
    </g>
  );
}

function PlaneGlyph() {
  return (
    <g transform="scale(1.9)">
      <path d="M13 0 L4 -2 L-2 -11 L-5.5 -11 L-1.5 -2 L-8 -2 L-11 -6 L-13.5 -6 L-11.5 0 L-13.5 6 L-11 6 L-8 2 L-1.5 2 L-5.5 11 L-2 11 L4 2 Z" fill="var(--ink)" stroke="var(--surface)" strokeWidth={1.2} strokeLinejoin="round" />
      <circle cx={8.5} cy={0} r={1.2} fill="var(--accent)" />
    </g>
  );
}

function CarGlyph() {
  return (
    <g transform="scale(1.5)">
      <rect x={-15} y={-8} width={30} height={16} rx={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
      <rect x={1} y={-6.2} width={7} height={12.4} rx={2} fill="#2b2a26" opacity={0.85} />
      <rect x={-11} y={-5.5} width={5} height={11} rx={1.5} fill="#2b2a26" opacity={0.7} />
      <rect x={-5} y={-6} width={5.5} height={12} rx={1} fill="#fff" opacity={0.25} />
      <circle cx={14} cy={-5} r={1.6} fill="#ffe7a3" />
      <circle cx={14} cy={5} r={1.6} fill="#ffe7a3" />
    </g>
  );
}
