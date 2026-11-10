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


def edge_bands(tr: Track, key: str):
    """Sand run-offs ("sand") or concrete strips ("concrete") along the lap, from source/work/edges.json:
    a band from the asphalt edge outwards with the depth measured in the photo, with tapered ends."""
    import json
    import os
    from common import WORK
    out = []
    for band in json.load(open(os.path.join(WORK, "edges.json"), encoding="utf-8")).get(key, []):
        side, a, ln = band["side"], band["start"], band["length"]
        st = (a + np.arange(ln)).astype(float)
        depth = np.array(band["depth"]) * np.clip(np.minimum(np.arange(ln), ln - 1 - np.arange(ln)) / 4.0, 0.15, 1.0)
        w = (tr.wl if side > 0 else tr.wr)[(a + np.arange(ln)) % tr.n]
        inner, outer = tr.en(st, side * (w - 0.3)), tr.en(st, side * (w + depth))
        p = Polygon(np.vstack([inner, outer[::-1]])).buffer(0)
        if not p.is_empty:
            out.append(p)
    return unary_union(out) if out else Polygon()


def other_asphalt(tr: Track, R: Polygon):
    """The original circuit outside the lap, from the hand-traced layout in tools/circuit.py.

    Every real road is a ribbon of constant width along its own smooth centre line and joins the lap where the
    real road does; paved areas are clean polygons with rounded corners.
    Returns (all asphalt, paved areas, roads [(centre line east/north, width m)], roads polygon, concrete pads)."""
    import circuit
    roads = [(en, w) for _, en, w in circuit.roads()]
    roads_poly = circuit.roads_polygon()
    pads = circuit.areas("pad")
    pads = unary_union([pads, edge_bands(tr, "concrete")]).buffer(0)
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
