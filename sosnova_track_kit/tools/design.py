"""How the surveyed circuit is finished.

From v6 the photo decides everything along the lap: the edges of the lap are the real asphalt edges
(refine.py), kerbs exist only where the real circuit has a concrete edge strip and sand only where it has a
sand run-off (edgescan.py). The rest of the circuit comes from the hand-traced layout in circuit.py.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from track import Track, cyclic_runs  # noqa: E402

PIT_Z = (-36.0, 74.0)


def _bands(en, widths, n: int, bands: list, keep=None) -> list:
    """Bands from the asphalt edge outwards with the depth measured in the photo, with tapered ends.
    en(stations, lateral offset) gives east/north; widths: (left, right) half widths per station."""
    out = []
    for band in bands:
        side, a, ln = band["side"], band["start"], band["length"]
        if keep is not None and not keep[(a + ln // 2) % n]:
            continue
        st = (a + np.arange(ln)).astype(float)
        full = np.array(band["depth"]) if "depth" in band else np.full(ln, band["width"])
        depth = full * (np.clip(np.minimum(np.arange(ln), ln - 1 - np.arange(ln)) / 4.0, 0.15, 1.0) if "depth" in band else 1.0)
        w = widths[0 if side > 0 else 1][(a + np.arange(ln)) % n]
        p = Polygon(np.vstack([en(st, side * (w - 0.3)), en(st, side * (w + depth))[::-1]])).buffer(0)
        if not p.is_empty:
            out.append(p)
    return out


def _std():
    """The surveyed standard lap: centre line, normals, half widths, and which stations are its own road
    (not shared with the race lap)."""
    import json
    from common import closed_frames, lap_file
    cl = json.load(open(lap_file("centerline", "json", "_std"), encoding="utf-8"))
    c, wl, wr = np.array(cl["en"]), np.array(cl["wl"]), np.array(cl["wr"])
    _, nrm, _, _ = closed_frames(c)
    n = len(c)

    def en(st, d):
        st = np.asarray(st, float)
        a = np.floor(st).astype(int) % n
        f = (st - np.floor(st))[:, None]
        return (c[a] * (1 - f) + c[(a + 1) % n] * f) + (nrm[a] * (1 - f) + nrm[(a + 1) % n] * f) * np.asarray(d, float)[:, None]
    return c, nrm, wl, wr, n, en, json.load(open(lap_file("edges", "json", "_std"), encoding="utf-8"))


def std_branches(tr: Track):
    """The roads of the standard circuit that the race lap does not use, as polygons between their real edges.
    Returns (polygon, mask of the standard lap's stations that lie on them)."""
    from scipy.spatial import cKDTree
    c, nrm, wl, wr, n, _, _ = _std()
    own = cKDTree(tr.c).query(c)[0] > 2.5
    own = np.convolve(np.tile(own, 3), np.ones(29), "same")[n: 2 * n] > 0            # run on into the shared road
    polys = []
    for a, ln in cyclic_runs(own, 5, 5):
        st = (a + np.arange(ln)) % n
        polys.append(Polygon(np.vstack([c[st] + nrm[st] * wl[st, None], (c[st] - nrm[st] * wr[st, None])[::-1]])).buffer(0))
    return unary_union(polys).buffer(0.2).buffer(-0.2), own


def std_surface(tr: Track):
    """The smooth road surface of the standard lap's own roads. Returns (polygon of those roads, points to
    mesh them with, function east/north -> height m a.s.l.)."""
    from scipy.spatial import cKDTree
    from heights import Heights
    c, nrm, wl, wr, n, en, _ = _std()
    poly, own = std_branches(tr)
    H = Heights("_std")
    fine = np.arange(n * 4) / 4.0
    tree = cKDTree(en(fine, np.zeros(len(fine))))

    def height(p: np.ndarray) -> np.ndarray:
        _, k = tree.query(p)
        st = fine[k]
        a = np.floor(st).astype(int) % n
        lat = np.einsum("ij,ij->i", p - en(st, np.zeros(len(st))), nrm[a])
        return H.road(st, lat)
    st = np.where(own)[0][::2].astype(float)
    pts = np.vstack([en(st, f * (wl if f > 0 else wr)[st.astype(int)]) for f in (-0.62, -0.25, 0.25, 0.62)])
    return poly, pts, height


def edge_bands(tr: Track, key: str):
    """Sand run-offs ("sand"), concrete strips ("concrete") or concrete kerbs ("kerbs") along the laps, from
    edges.json. The race lap gives sand and concrete strips (its kerbs are built by kerbs.py); the standard lap
    adds whatever lies along its own roads."""
    import json
    import os
    from common import WORK
    out = []
    if key != "kerbs":
        data = json.load(open(os.path.join(WORK, "edges.json"), encoding="utf-8"))
        out += _bands(tr.en, (tr.wl, tr.wr), tr.n, data.get(key, []))
    c, nrm, wl, wr, n, en, data = _std()
    out += _bands(en, (wl, wr), n, data.get(key, []), keep=std_branches(tr)[1])
    return unary_union(out) if out else Polygon()


def other_asphalt(tr: Track, R: Polygon):
    """The original circuit outside the lap, from the hand-traced layout in tools/circuit.py.

    Every real road is a ribbon of constant width along its own smooth centre line and joins the lap where the
    real road does; paved areas are clean polygons with rounded corners.
    Returns (all asphalt, paved areas, roads [(centre line east/north, width m)], roads polygon, concrete pads)."""
    import circuit
    roads = [(en, w) for _, en, w in circuit.roads()]
    roads_poly = unary_union([std_branches(tr)[0], circuit.roads_polygon()]).buffer(0)
    pads = unary_union([circuit.areas("pad"), edge_bands(tr, "concrete"), edge_bands(tr, "kerbs").difference(roads_poly)]).buffer(0)
    paved = circuit.areas("apron")
    A = unary_union([paved, pads, roads_poly]).buffer(0.3).buffer(-0.3).difference(R)
    A = unary_union([p for p in getattr(A, "geoms", [A]) if p.area > 15.0]).buffer(0).simplify(0.1)
    return A, paved, roads, roads_poly, pads


def gravel(tr: Track, R: Polygon, A, avoid):
    """Real sand and gravel: the run-offs measured in the photo and the pockets traced in circuit.py.
    Kept clear of the asphalt outline so the two outlines never share an edge."""
    import circuit
    g = unary_union([edge_bands(tr, "sand"), circuit.areas("gravel")])
    if g.is_empty:
        return g
    g = g.difference(unary_union([A.buffer(0.35), R.buffer(0.35), avoid.buffer(1.0)])).buffer(-0.3).buffer(0.3).simplify(0.15)
    return unary_union([p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and p.area > 25.0]).buffer(0)
