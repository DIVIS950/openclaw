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


COLS = 27                          # road columns: about 0.4 m apart, fine enough to carry the racing line
GROOVE_SIGMA = 1.15                # half width of the rubbered line (m)


def columns(tr: Track, i: np.ndarray) -> np.ndarray:
    """Lateral offsets of the road columns at stations i, from the right edge to the left edge."""
    wl, wr = tr.wl[i], tr.wr[i]
    return np.stack([-wr + (wl + wr) * f for f in np.linspace(0, 1, COLS)], axis=1)


def build_road(tr: Track, parts: Parts, line_offset: np.ndarray) -> None:
    """line_offset: lateral position of the racing line per station (m, + = left). Where the cars run the
    asphalt is darker, in three gentle steps, as rubber builds up on a real circuit."""
    n = tr.n
    i = np.arange(n + 1) % n
    D = columns(tr, i)
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
    uv = pos[:, [0, 2]] / TILE_M["road"]
    mid = (D[:-1, :-1] + D[:-1, 1:] + D[1:, :-1] + D[1:, 1:]) / 4                      # lateral centre of every quad
    off = (line_offset[i[:-1]] + line_offset[i[1:]]) / 2
    busy = 0.8 + 0.2 * np.clip(np.abs(tr.k[i[:-1]]) * 40.0, 0, 1)                      # more rubber in the corners
    rubber = np.exp(-0.5 * ((mid - off[:, None]) / GROOVE_SIGMA) ** 2) * busy[:, None]
    level = np.digitize(rubber, [0.25, 0.5, 0.75])                                     # 0 = clean .. 3 = darkest
    for k, a in enumerate(range(0, n, CHUNK)):
        b = min(n, a + CHUNK)
        r = (np.arange(a, b)[:, None] * cols + np.arange(cols - 1)[None, :]).ravel()
        lv = level[a:b].ravel()
        for g in range(4):
            q = r[lv == g]
            if len(q) == 0:
                continue
            t = wind_up(pos, np.concatenate([np.stack([q, q + 1, q + cols + 1], -1), np.stack([q, q + cols + 1, q + cols], -1)]))
            ids, inv = np.unique(t, return_inverse=True)
            parts.add(f"1ROAD_trk_{k:02d}_{g}", "road" if g == 0 else f"road_g{g}", pos[ids], nrm[ids], uv[ids], inv.reshape(-1, 3), cast_shadows=False)
