/**
 * Small flat-earth helpers. A circuit is a couple of km across, so an
 * equirectangular projection around a fixed origin is accurate to centimetres.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

export interface XY {
  x: number;
  y: number;
}

const M_PER_DEG = 111_320;
const DEG = Math.PI / 180;

/** Lat/lon → metres east (x) / north (y) of `origin`. */
export function toLocal(origin: LatLon, lat: number, lon: number): XY {
  return {
    x: (lon - origin.lon) * M_PER_DEG * Math.cos(origin.lat * DEG),
    y: (lat - origin.lat) * M_PER_DEG,
  };
}

/** Metres east/north of `origin` → lat/lon. */
export function fromLocal(origin: LatLon, x: number, y: number): LatLon {
  return {
    lat: origin.lat + y / M_PER_DEG,
    lon: origin.lon + x / (M_PER_DEG * Math.cos(origin.lat * DEG)),
  };
}

/** Distance in metres between two nearby points. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dx = (b.lon - a.lon) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * DEG);
  const dy = (b.lat - a.lat) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/**
 * Intersection of segment p1→p2 with segment q1→q2.
 * Returns `t` (0..1 along p) and `u` (0..1 along q), or null if they do not cross.
 */
export function segmentIntersection(p1: XY, p2: XY, q1: XY, q2: XY): { t: number; u: number } | null {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const qpx = q1.x - p1.x;
  const qpy = q1.y - p1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Heading in degrees (0 = north, clockwise) → unit vector in local x/y. */
export function headingVector(headingDeg: number): XY {
  return { x: Math.sin(headingDeg * DEG), y: Math.cos(headingDeg * DEG) };
}
