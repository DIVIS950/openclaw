"""The racetrack design laid over the survey: what makes the place read as a circuit rather than a survey.

  * the lap has one constant width, so both white lines run parallel all the way round
  * a grass verge of one width runs along both sides of the lap (except at the pit apron)
  * gravel traps of one depth sit on the outside of every real corner
  * the pit apron is a clean slab beside the start straight
  * the long service roads of the complex are rebuilt with constant widths from their own centre lines
"""
from __future__ import annotations

import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from skimage.morphology import skeletonize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N  # noqa: E402
from track import Track, cyclic_runs  # noqa: E402

GSD = 0.25
LAP_HALF = 4.5          # half width of the lap (m): 9 m of asphalt everywhere
VERGE = 4.0             # grass strip along both sides of the lap (m)
TRAP_R = 45.0           # corners tighter than this get a gravel trap on the outside
TRAP_DEPTH = 11.0       # depth of a gravel trap (m)
WIDE = 6.5              # asphalt broader than twice this is an apron, narrower is a road
REACH = 75.0            # other asphalt is modelled up to this distance from the lap
ROAD_MIN = 60.0         # shorter pieces of road beside the lap are left out
PIT_DEPTH = 20.0        # depth of the pit apron beside the start straight (m)


def _raster(geom, shape) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    for p in getattr(geom, "geoms", [geom]):
        if p.is_empty:
            continue
        rings = [p.exterior, *p.interiors]
        pts = [np.round(np.column_stack([(np.array(r.coords)[:, 0] + HALF_E) / GSD, (HALF_N - np.array(r.coords)[:, 1]) / GSD])).astype(np.int32) for r in rings]
        cv2.fillPoly(m, pts[:1], 1)
        if len(pts) > 1:
            cv2.fillPoly(m, pts[1:], 0)
    return m.astype(bool)


def verge(tr: Track, R: Polygon):
    """Grass strip beside the lap; left open where the pit apron joins the start straight."""
    v = R.buffer(VERGE).difference(R)
    st = np.where(tr.in_pit_stretch())[0]
    st = np.where(st > tr.n / 2, st - tr.n, st)
    s = np.arange(st.min() + 3, st.max() - 2).astype(float)
    inner, outer = tr.en(s, np.full_like(s, LAP_HALF - 0.05)), tr.en(s, np.full_like(s, LAP_HALF + VERGE + 0.5))
    return v.difference(Polygon(np.vstack([inner, outer[::-1]])))


def pit_apron(tr: Track) -> Polygon:
    """The pit apron: a clean slab beside the start straight, with rounded corners."""
    st = np.where(tr.in_pit_stretch())[0]
    st = np.where(st > tr.n / 2, st - tr.n, st)
    s = np.arange(st.min(), st.max() + 1).astype(float)
    inner, outer = tr.en(s, np.full_like(s, LAP_HALF)), tr.en(s, np.full_like(s, LAP_HALF + PIT_DEPTH))
    p = Polygon(np.vstack([inner, outer[::-1]]))
    cut = Polygon(np.vstack([tr.en(s, np.full_like(s, LAP_HALF - 2.0)), tr.en(s, np.full_like(s, LAP_HALF + 3.0))[::-1]]))
    return unary_union([p.buffer(-3.0).buffer(3.0), p.intersection(cut)]).buffer(0)       # round only the far corners


def other_asphalt(tr: Track, R: Polygon, clear, mask: np.ndarray):
    """Asphalt outside the lap, regularised. mask: surveyed drivable surface (0.25 m raster).
    Returns (all asphalt polygon, the pit apron, roads as [(centre line east/north, width m)])."""
    from paint import smooth_line, trace
    m = mask & _raster(R.buffer(REACH), mask.shape) & ~_raster(unary_union([R, clear]).buffer(0.2), mask.shape)
    m = ndi.binary_opening(m, iterations=3)
    dist = ndi.distance_transform_edt(m) * GSD
    core = dist > WIDE
    wide = (ndi.distance_transform_edt(~core) * GSD <= WIDE + 0.3) & m             # opening with a 6.5 m disc
    lab, n = ndi.label(m & ~wide)
    area = ndi.sum(np.ones_like(lab), lab, np.arange(1, n + 1)) * GSD ** 2
    narrow = np.concatenate([[False], area > 40.0])[lab]
    roads = []
    for p in trace(skeletonize(narrow)):
        ln = float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) * GSD
        if ln < 14.0:
            continue
        ix, iy = p[:, 0].astype(int), p[:, 1].astype(int)
        w = float(np.clip(np.round((2 * np.median(dist[iy, ix]) + 0.3) * 2) / 2, 4.5, 9.0))
        q = smooth_line(p, 16.0)                                                    # 4 m: a road, not a pixel trail
        en = np.column_stack([(q[:, 0] + 0.5) * GSD - HALF_E, HALF_N - (q[:, 1] + 0.5) * GSD])
        en = np.array(LineString(en).simplify(0.1).coords)
        for end, a, b in ((0, 0, 1), (-1, -1, -2)):                                 # run on into the apron or junction
            d = en[a] - en[b]
            en[a] = en[a] + d / max(np.linalg.norm(d), 1e-6) * (w * 0.6)
        roads.append((en, w))
    roads = [(en, w) for en, w in roads if LineString(en).length >= ROAD_MIN]       # long service roads only, no stubs
    aprons = pit_apron(tr)
    A = unary_union([aprons, *[LineString(en).buffer(w / 2, cap_style="round", join_style="round", quad_segs=5) for en, w in roads]])
    A = A.buffer(0.4).buffer(-0.4).difference(unary_union([R, clear]))
    A = unary_union([p for p in getattr(A, "geoms", [A]) if p.area > 40.0]).buffer(0).simplify(0.15)
    return A, aprons, roads


def gravel_traps(tr: Track, R: Polygon, avoid):
    """One gravel trap on the outside of every corner, behind the verge. avoid: asphalt, buildings."""
    traps = []
    for a, ln in cyclic_runs(np.abs(tr.k) > 1.0 / TRAP_R, 5, 8):
        side = -int(np.sign(tr.k[(a + ln // 2) % tr.n]))
        st = np.arange(a - 6, a + ln + 16).astype(float)
        m = len(st)
        ramp = np.clip(np.minimum(np.arange(m), m - 1 - np.arange(m)) / 9.0, 0, 1)
        depth = TRAP_DEPTH * ramp * ramp * (3 - 2 * ramp)
        ok = depth > 0.8
        if ok.sum() < 6:
            continue
        inner = tr.en(st[ok], np.full(ok.sum(), side * (LAP_HALF + VERGE)))
        outer = tr.en(st[ok], side * (LAP_HALF + VERGE + depth[ok]))
        p = Polygon(np.vstack([inner, outer[::-1]])).buffer(0)
        if not p.is_empty:
            traps.append(p)
    G = unary_union(traps).difference(unary_union([avoid.buffer(1.2), R.buffer(VERGE - 0.01)]))
    G = G.buffer(-0.8).buffer(1.6).buffer(-0.8).difference(unary_union([avoid.buffer(1.0), R.buffer(VERGE - 0.01)])).simplify(0.2)
    return unary_union([p for p in getattr(G, "geoms", [G]) if p.geom_type == "Polygon" and p.area > 60.0]).buffer(0)


def trap_barriers(tr: Track, G) -> list[dict]:
    """A padded barrier along the back of every gravel trap (east/north polylines)."""
    out = []
    for a, ln in cyclic_runs(np.abs(tr.k) > 1.0 / TRAP_R, 5, 8):
        side = -int(np.sign(tr.k[(a + ln // 2) % tr.n]))
        st = np.arange(a - 6, a + ln + 16).astype(float)
        m = len(st)
        ramp = np.clip(np.minimum(np.arange(m), m - 1 - np.arange(m)) / 9.0, 0, 1)
        depth = TRAP_DEPTH * ramp * ramp * (3 - 2 * ramp)
        ok = depth > 4.0
        if ok.sum() < 8:
            continue
        line = tr.en(st[ok], side * (LAP_HALF + VERGE + depth[ok] + 0.7))
        from shapely import contains_xy
        back = tr.en(st[ok], side * (LAP_HALF + VERGE + depth[ok] - 1.5))
        if contains_xy(G, back[:, 0], back[:, 1]).mean() > 0.7:                 # only where the trap was really built
            out.append(dict(en=line.round(2).tolist(), width=0.8, height=0.95))
    return out
