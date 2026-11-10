"""The racing surface of the lap: a structured ribbon with an analytic, smooth height. It carries the same
ground photo as the asphalt around it, so no seam shows."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, WORK, site_uv  # noqa: E402
from track import Parts, Track, grid_tris, vertex_normals, wind_up  # noqa: E402

CHUNK = 125                       # stations per road mesh


def columns(tr: Track, i: np.ndarray) -> np.ndarray:
    """Lateral offsets of the 7 road columns at stations i, from the right edge to the left edge."""
    wl, wr = tr.wl[i], tr.wr[i]
    return np.stack([-wr + (wl + wr) * f for f in np.linspace(0, 1, 7)], axis=1)


def build_road(tr: Track, parts: Parts) -> None:
    n = tr.n
    i = np.arange(n + 1) % n
    D = columns(tr, i)                                   # (n+1, 9)
    en = tr.c[i][:, None, :] + tr.nrm[i][:, None, :] * D[..., None]
    hgt = tr.H.z[i][:, None] + tr.H.camber[i][:, None] * D
    pos = tr.fr.world(en.reshape(-1, 2), hgt.ravel())
    cols = D.shape[1]
    # smooth normals from the closed grid (rows 0..n-1), then copied to the duplicate closing row
    tri_all = wind_up(pos, grid_tris(n + 1, cols))
    nrm = vertex_normals(pos, tri_all).reshape(n + 1, cols, 3)
    seam = nrm[0] + nrm[n]
    nrm[0] = nrm[n] = seam / np.linalg.norm(seam, axis=1, keepdims=True)
    nrm = nrm.reshape(-1, 3)
    uv = site_uv(en.reshape(-1, 2))
    for k, a in enumerate(range(0, n, CHUNK)):
        b = min(n, a + CHUNK)
        r = np.arange(a, b)[:, None] * cols + np.arange(cols - 1)[None, :]
        r = r.ravel()
        t = wind_up(pos, np.concatenate([np.stack([r, r + 1, r + cols + 1], -1), np.stack([r, r + cols + 1, r + cols], -1)]))
        ids, inv = np.unique(t, return_inverse=True)
        parts.add(f"1ROAD_trk_{k:02d}", "asph", pos[ids], nrm[ids], uv[ids], inv.reshape(-1, 3), cast_shadows=False)
