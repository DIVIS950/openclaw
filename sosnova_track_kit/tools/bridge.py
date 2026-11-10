"""The bridge in the middle of the circuit: an open arch with green side panels and mesh railings, as on the
circuit's own photos. The deck is drivable; the lower road passes underneath."""
from __future__ import annotations

import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter1d

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge_geom as bg  # noqa: E402
from track import Parts, Track, grid_tris  # noqa: E402

RAIL_H = 1.1
UP = np.array([0.0, 1.0, 0.0])


def build_bridge(tr: Track, parts: Parts, under_road) -> dict:
    """under_road: shapely geometry (east/north) of the road that passes below, for the clearance figure."""
    from shapely import contains_xy
    t = np.unique(np.concatenate([np.arange(0.0, bg.LENGTH, 1.0), [bg.LENGTH]]))
    axis = bg.point(t, np.zeros_like(t))
    base = gaussian_filter1d(tr.H.ground(axis), 3.0, mode="nearest")           # the ground the arch stands on
    top = base + bg.height(t) + np.where((t > 0.2) & (t < bg.LENGTH - 0.2), 0.03, -0.04)
    soffit = np.maximum(top - bg.FASCIA, base - 0.3)                           # underside of the arch
    half = bg.WIDTH / 2
    m = len(t)

    def line(s, h):
        return tr.fr.world(bg.point(t, np.full_like(t, s)), h)

    cols = np.array([-half, 0.0, half])
    pos = np.vstack([line(s, top) for s in cols]).reshape(len(cols), m, 3).transpose(1, 0, 2).reshape(-1, 3)
    uv = pos[:, [0, 2]] / 8.0
    parts.surface("1ROAD_bridge", "apron", pos, uv, grid_tris(m, len(cols)), hint=UP)
    r = np.arange(m - 1)
    strip = np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)])

    def band(group, material, a, b, hint, va=0.0, vb=1.0, scale=8.0, sel=None, **kw):
        tris = strip if sel is None else strip[np.concatenate([sel, sel])]
        uvb = np.vstack([np.column_stack([t / scale, np.full(m, va)]), np.column_stack([t / scale, np.full(m, vb)])])
        parts.surface(group, material, np.vstack([a, b]), uvb, tris, hint=hint, smooth=False, **kw)

    raised = (top - soffit)[:-1] > 0.05
    for side in (1, -1):
        n_out = tr.fr.vec((bg.LEFT * side)[None, :])[0]
        hint = np.array([n_out[0], 0.0, n_out[1]])
        edge = side * (half + 0.06)
        band("1WALL_bridge_arch", "arch", line(edge, soffit), line(edge, top), hint, sel=raised)                 # green panel
        band("1WALL_bridge_rail", "fence", line(side * half, top), line(side * half, top + RAIL_H), hint,
             scale=2.0, sel=raised, double_sided=True, cast_shadows=False)
    open_below = (soffit - base)[:-1] > 0.2
    band("BRIDGE_soffit", "concrete", line(-half - 0.06, soffit), line(half + 0.06, soffit), -UP, scale=3.0, vb=1.3, sel=open_below)
    under = contains_xy(under_road, axis[:, 0], axis[:, 1])
    return dict(length=bg.LENGTH, peak=float(bg.height(t).max()),
                clearance=float((soffit - base)[under].min()) if under.any() else None,
                max_grade=float(np.abs(np.diff(top) / np.diff(t))[2:-2].max()))
