"""The concrete overpass: a drivable deck on two solid ramps with an opening for the lower road."""
from __future__ import annotations

import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter1d

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge_geom as bg  # noqa: E402
from track import Parts, Track, grid_tris  # noqa: E402

PARAPET_W, PARAPET_H = 0.25, 0.55
UP = np.array([0.0, 1.0, 0.0])


def build_bridge(tr: Track, parts: Parts) -> dict:
    t = np.unique(np.concatenate([np.arange(0.0, bg.LENGTH, 1.0), [bg.LENGTH, *bg.SPAN]]))
    base = tr.H.ground(bg.point(t, np.zeros_like(t)))
    base = gaussian_filter1d(base, 3.0, mode="nearest")               # the ground the ramps stand on
    top = base + bg.height(t) + np.where((t > 0.2) & (t < bg.LENGTH - 0.2), 0.03, -0.04)
    half = bg.WIDTH / 2
    out = half + PARAPET_W

    def line(s, h):
        return tr.fr.world(bg.point(t, np.full_like(t, s)), h)

    # deck
    cols = np.array([-half, 0.0, half])
    pos = np.vstack([line(s, top) for s in cols]).reshape(len(cols), len(t), 3).transpose(1, 0, 2).reshape(-1, 3)
    uv = np.stack([np.tile(cols / bg.WIDTH + 0.5, len(t)), np.repeat(t / 4.0, len(cols))], -1)
    parts.surface("1ROAD_bridge", "deck", pos, uv, grid_tris(len(t), len(cols)), hint=UP)
    m = len(t)
    r = np.arange(m - 1)
    strip = np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)])

    def band(group, material, a, b, hint, va=0.0, vb=1.0, sel=None, scale=3.0):
        tris = strip if sel is None else strip[np.concatenate([sel, sel])]
        if len(tris):
            uvb = np.vstack([np.column_stack([t / scale, np.full(m, va)]), np.column_stack([t / scale, np.full(m, vb)])])
            parts.surface(group, material, np.vstack([a, b]), uvb, tris, hint=hint, smooth=False)

    walk = (t[:-1] >= 1.0) & (t[1:] <= bg.LENGTH - 1.0)                # where the deck is clear of the ground
    solid = (t[1:] <= bg.SPAN[0] + 1e-6) | (t[:-1] >= bg.SPAN[1] - 1e-6)
    for side in (1, -1):
        n_out = tr.fr.vec((bg.LEFT * side)[None, :])[0]
        hint = np.array([n_out[0], 0.0, n_out[1]])
        # parapet: inner face, top, outer face
        band("1WALL_bridge_parapet", "concrete", line(side * half, top), line(side * half, top + PARAPET_H), -hint, sel=walk)
        band("1WALL_bridge_parapet", "concrete", line(side * half, top + PARAPET_H), line(side * out, top + PARAPET_H), UP, sel=walk)
        band("1WALL_bridge_parapet", "concrete", line(side * out, top + PARAPET_H), line(side * out, top), hint, sel=walk)
        # ramp walls down to the ground, and the edge of the slab over the opening
        band("1WALL_bridge_ramp", "concrete", line(side * out, base - 0.8), line(side * out, top), hint, vb=2.0, sel=solid)
        band("BRIDGE_slab", "concrete", line(side * out, top - bg.SLAB), line(side * out, top), hint, vb=0.3, sel=~solid)
    band("BRIDGE_slab", "concrete", line(-out, top - bg.SLAB), line(out, top - bg.SLAB), -UP, sel=~solid)
    for ts, facing in ((bg.SPAN[0], 1.0), (bg.SPAN[1], -1.0)):          # the two faces of the opening
        k = int(np.argmin(np.abs(t - ts)))
        lo = tr.fr.world(bg.point(np.array([ts, ts]), np.array([-out, out])), base[k] - 0.8)
        hi = tr.fr.world(bg.point(np.array([ts, ts]), np.array([-out, out])), top[k] - bg.SLAB)
        ax = tr.fr.vec(bg.AXIS[None, :])[0] * facing
        parts.quad("1WALL_bridge_ramp", "concrete", [lo[0], lo[1], hi[1], hi[0]], (0, 0, 2.5, 2.0), hint=(ax[0], 0.0, ax[1]), smooth=False)
    k0, k1 = int(np.argmin(np.abs(t - bg.SPAN[0]))), int(np.argmin(np.abs(t - bg.SPAN[1])))
    return dict(length=bg.LENGTH, peak=float(bg.height(t).max()), clearance=float((top - bg.SLAB - base)[k0:k1 + 1].min()),
                max_grade=float(np.abs(np.diff(top) / np.diff(t))[2:-2].max()))
