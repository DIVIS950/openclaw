#!/usr/bin/env python3
"""Turn the traced pixel route into a lat/lon centerline.

Mode A (no OSM):  python georef_route.py --scale 0.45 --center 50.6455,14.5600
    north-up image, `--scale` metres per pixel, `--center` lat,lon of the image centre.
Mode B (with OSM): python georef_route.py --osm source/osm_raceway.json
    fits scale + translation (north-up) so the route matches the OpenStreetMap raceway ways as well as possible.
Writes source/centerline.json for build_track.py.
"""
import argparse, json, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); KIT = os.path.dirname(HERE)
ap = argparse.ArgumentParser()
ap.add_argument("--pixels", default=os.path.join(KIT, "source", "trace", "route_pixels.json"))
ap.add_argument("--scale", type=float, default=0.45, help="metres per pixel (mode A)")
ap.add_argument("--center", default="50.6455,14.5600", help="lat,lon of image centre (mode A)")
ap.add_argument("--osm", default=None, help="Overpass JSON with highway=raceway ways (mode B)")
ap.add_argument("--out", default=os.path.join(KIT, "source", "centerline.json"))
a = ap.parse_args()

d = json.load(open(a.pixels)); P = np.array(d["pixels"], float)
from PIL import Image
W, H = Image.open(os.path.join(os.path.dirname(a.pixels), os.path.basename(d["image"]))).size
cx, cy = W / 2.0, H / 2.0
lat0, lon0 = map(float, a.center.split(","))
scale = a.scale

def to_latlon(px, scale, lat0, lon0):
    east = (px[:, 0] - cx) * scale; north = -(px[:, 1] - cy) * scale
    lat = lat0 + north / 110_540.0; lon = lon0 + east / (111_320.0 * math.cos(math.radians(lat0)))
    return np.column_stack([lat, lon])

if a.osm:
    osm = json.load(open(a.osm))
    Q = np.array([(n["lat"], n["lon"]) for e in osm["elements"] if e["type"] == "way" for n in e.get("geometry", [])])
    qlat0, qlon0 = Q.mean(axis=0)
    Qm = np.column_stack([(Q[:, 1] - qlon0) * 111_320 * math.cos(math.radians(qlat0)), (Q[:, 0] - qlat0) * 110_540])
    Pm0 = np.column_stack([P[:, 0] - cx, -(P[:, 1] - cy)])
    # grid search scale, then least-squares translation (nearest-neighbour ICP, north-up so no rotation)
    def cost(s, t):
        X = Pm0 * s + t
        dd = np.sqrt(((X[:, None, :] - Qm[None, :, :]) ** 2).sum(-1)).min(1)
        return np.median(dd), dd
    best = None
    for s in np.arange(0.30, 0.70, 0.01):
        t = Qm.mean(0) - (Pm0 * s).mean(0)
        for _ in range(15):
            X = Pm0 * s + t
            nn = np.argmin(((X[:, None, :] - Qm[None, :, :]) ** 2).sum(-1), axis=1)
            dd = np.linalg.norm(Qm[nn] - X, axis=1); keep = dd < np.percentile(dd, 60)  # ignore parts not in OSM
            t = t + (Qm[nn][keep] - X[keep]).mean(0)
        c, _ = cost(s, t)
        if best is None or c < best[0]: best = (c, s, t)
    c, scale, t = best
    print(f"OSM fit: scale {scale:.3f} m/px, median distance {c:.1f} m")
    lat0 = qlat0 + t[1] / 110_540.0; lon0 = qlon0 + t[0] / (111_320 * math.cos(math.radians(qlat0)))

LL = to_latlon(P, scale, lat0, lon0)
length = np.sum(np.linalg.norm(np.diff(np.vstack([P, P[:1]]), axis=0), axis=1)) * scale
json.dump({"name": "Autodrom Sosnová 14.11.2026 layout", "points": LL.tolist() + [LL[0].tolist()], "closed": True,
           "scale_m_per_px": scale, "image_center": [lat0, lon0], "source": "traced from event layout image"}, open(a.out, "w"), indent=1)
print(f"wrote {a.out}: {len(LL)} points, lap ~{length:.0f} m, scale {scale:.3f} m/px")
