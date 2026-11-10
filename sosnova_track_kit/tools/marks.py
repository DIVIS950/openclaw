"""Painted markings as sharp geometry: the lines, boxes and kerb stones traced from the photo (paint.py),
laid 2 cm above the asphalt they belong to."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import triangle as tri
from shapely import contains_xy
from shapely.geometry import Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK  # noqa: E402
from track import Parts, SurfaceLookup, Track  # noqa: E402

LIFT = 0.02
MAX_AREA = 40.0        # larger bright patches are surfaces (concrete, sand), not paint: the photo shows those
UP = np.array([0.0, 1.0, 0.0])


EDGE_IN, EDGE_W = 0.22, 0.15    # white edge line of the lap: distance from the asphalt edge and width (m)


def edge_line_runs(tr: Track) -> list[tuple[int, np.ndarray]]:
    """Stations where the lap has its own asphalt edge (grass or gravel beyond it), per side: (side, stations)."""
    from track import cyclic_runs
    out = []
    for side in (1, -1):
        solid = ~(tr.open_l if side > 0 else tr.open_r)
        for a, ln in cyclic_runs(solid, 6, 2):
            out.append((side, a + np.arange(ln + 1)))
    return out


def edge_lines_en(tr: Track) -> list[np.ndarray]:
    return [tr.en(st.astype(float), side * ((tr.wl if side > 0 else tr.wr)[st % tr.n] - EDGE_IN - EDGE_W / 2)) for side, st in edge_line_runs(tr)]


def build_edge_lines(tr: Track, parts: Parts) -> dict:
    """Solid white lines along both edges of the lap, as on the resurfaced circuit."""
    total = 0
    for k, (side, st) in enumerate(edge_line_runs(tr)):
        w = (tr.wl if side > 0 else tr.wr)[st % tr.n]
        i = st.astype(float)
        pos = np.vstack([tr.world(i, side * (w - EDGE_IN), LIFT), tr.world(i, side * (w - EDGE_IN - EDGE_W), LIFT)])
        m = len(st)
        r = np.arange(m - 1)
        uv = np.vstack([np.column_stack([np.full(m, 0.2), i / 2.0]), np.column_stack([np.full(m, 0.8), i / 2.0])])
        parts.surface(f"MARK_edge{k // 12:02d}", "paint", pos, uv, np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)]),
                      hint=UP, cast_shadows=False)
        total += m - 1
    return dict(edge_line_m=total)


def build_marks(tr: Track, parts: Parts, asphalt, keep_out) -> dict:
    """asphalt, keep_out: shapely geometries in east/north."""
    data = json.load(open(os.path.join(WORK, "paint.json"), encoding="utf-8"))
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1APRON", "1GRASS_g"))
    stats = dict(lines=0, line_m=0.0, areas=0)
    from scipy.spatial import cKDTree
    edge_tree = cKDTree(np.vstack(edge_lines_en(tr)))

    def lay(en: np.ndarray) -> np.ndarray:
        pos = tr.fr.world(en, tr.H.ground(en))
        pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT
        return pos

    P, U, T, off = [], [], [], 0
    for line in data["lines"]:
        p = np.array(line["en"], float)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        if cum[-1] < 0.5:
            continue
        m = max(2, int(np.ceil(cum[-1] / 0.6)) + 1)
        s = np.linspace(0, cum[-1], m)
        q = np.column_stack([np.interp(s, cum, p[:, 0]), np.interp(s, cum, p[:, 1])])
        inside = contains_xy(asphalt, q[:, 0], q[:, 1]) & ~contains_xy(keep_out, q[:, 0], q[:, 1])
        if inside.mean() < 0.7 or (edge_tree.query(q)[0] < 1.3).mean() > 0.5:      # off the asphalt, or a copy of an edge line
            continue
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]]) * line["width"] / 2
        pos = np.vstack([lay(q + nrm), lay(q - nrm)])
        r = np.arange(m - 1)
        P.append(pos)
        U.append(np.vstack([np.column_stack([np.full(m, 0.2), s / 2.0]), np.column_stack([np.full(m, 0.8), s / 2.0])]))
        T.append(np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)]) + off)
        off += len(pos)
        stats["lines"] += 1
        stats["line_m"] += float(cum[-1])
    AP, AU, AT, aoff = [], [], [], 0
    for ring in data["areas"]:
        poly = Polygon(ring).buffer(0)
        if poly.is_empty or poly.geom_type != "Polygon" or not (0.15 < poly.area < MAX_AREA):
            continue
        c = poly.representative_point()
        if not asphalt.contains(c) or keep_out.contains(c):
            continue
        xy = np.array(poly.exterior.coords)[:-1]
        k = len(xy)
        if k < 3:
            continue
        try:
            out = tri.triangulate(dict(vertices=xy, segments=np.array([(i, (i + 1) % k) for i in range(k)], np.int32)), "p")
        except Exception:
            continue
        if "triangles" not in out or len(out["triangles"]) == 0:
            continue
        AP.append(lay(out["vertices"]))
        AU.append(out["vertices"] / 3.0)
        AT.append(out["triangles"] + aoff)
        aoff += len(out["vertices"])
        stats["areas"] += 1
    if AP:                                                   # flat concrete kerbs and painted patches
        parts.surface("MARK_kerb", "pad", np.vstack(AP), np.vstack(AU), np.vstack(AT), hint=UP, smooth=False, cast_shadows=False)
    if P:
        pos, tris = np.vstack(P), np.vstack(T)
        cen = pos[tris].mean(1)
        order = np.lexsort((np.floor(cen[:, 2] / 100), np.floor(cen[:, 0] / 100)))
        parts.surface("MARK_paint", "paint", pos, np.vstack(U), tris[order], hint=UP, smooth=False, cast_shadows=False)
    stats["line_m"] = round(stats["line_m"])
    return stats
