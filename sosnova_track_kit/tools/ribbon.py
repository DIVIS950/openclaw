"""The racing surface of the lap: a structured ribbon with an analytic, smooth height, in the dark asphalt of
the resurfaced circuit. Textures are laid in plan so they join the asphalt around it without a seam."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from textures import TILE_M  # noqa: E402
from track import Parts, Track, grid_tris, vertex_normals, wind_up  # noqa: E402

CHUNK = 125                       # stations per road mesh


COLS = 33                          # road columns: 0.3 to 0.6 m apart on the real widths
GROOVE_SIGMA = 1.15                # half width of the rubbered line (m)


def columns(tr: Track, i: np.ndarray) -> np.ndarray:
    """Lateral offsets of the road columns at stations i, from the right edge to the left edge."""
    wl, wr = tr.wl[i], tr.wr[i]
    return np.stack([-wr + (wl + wr) * f for f in np.linspace(0, 1, COLS)], axis=1)


def build_road(tr: Track, parts: Parts, line_offset: np.ndarray):
    """The lap, cut into pieces of 28 m. Each piece carries its own texture, baked from the aerial photo of
    exactly that piece of road (realtex.lap_textures). Returns (textures, material names)."""
    import realtex
    n = tr.n
    i = np.arange(n + 1) % n
    D = columns(tr, i)
    en = tr.c[i][:, None, :] + tr.nrm[i][:, None, :] * D[..., None]
    hgt = tr.H.z[i][:, None] + tr.H.camber[i][:, None] * D
    pos = tr.fr.world(en.reshape(-1, 2), hgt.ravel())
    cols = D.shape[1]
    tri_all = wind_up(pos, grid_tris(n + 1, cols))
    nrm = vertex_normals(pos, tri_all).reshape(n + 1, cols, 3)
    seam = nrm[0] + nrm[n]
    nrm[0] = nrm[n] = seam / np.linalg.norm(seam, axis=1, keepdims=True)
    nrm = nrm.reshape(-1, 3)
    tex, chunks = realtex.lap_textures(tr, line_offset)
    for k, (a, b, name, half) in enumerate(chunks):
        rows = np.arange(a, b + 1)                                   # station b is row b (row n duplicates row 0)
        ids = (rows[:, None] * cols + np.arange(cols)[None, :]).ravel()
        uv = realtex.lap_uv(a, b, half, np.repeat(rows.astype(float), cols), D[rows].ravel())
        t = wind_up(pos[ids], grid_tris(len(rows), cols))
        parts.add(f"1ROAD_trk_{k:02d}", name, pos[ids], nrm[ids], uv, t, cast_shadows=False)
    return tex, [c[2] for c in chunks]
