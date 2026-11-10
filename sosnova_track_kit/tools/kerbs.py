"""Red and white kerbs: along the inside of every corner, and on the outside of the exit of tight corners.
They stand on the verge just outside the white edge line, 1 m wide, with a low rounded profile."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from track import Parts, Track, cyclic_runs, grid_tris  # noqa: E402

INSIDE_R = 60.0      # kerb on the inside of corners tighter than this radius (m)
EXIT_R = 28.0        # exit kerb on the outside after corners tighter than this
LEAD = 5             # metres of kerb before and after the bend
PROFILE_E = np.array([0.0, 0.5, 1.0, 1.03])          # distance outwards from the road edge (m)
PROFILE_H = np.array([0.008, 0.045, 0.022, -0.04])   # height above the road plane (m)


def kerb_runs(tr: Track) -> list[tuple[int, int, int]]:
    """(side, first station, length) of every kerb; side +1 = left of the direction of travel."""
    n = tr.n
    out = []
    for side in (1, -1):
        blocked = tr.open_l if side > 0 else tr.open_r
        mask = np.zeros(n, bool)
        for a, ln in cyclic_runs((np.abs(tr.k) > 1.0 / INSIDE_R) & (np.sign(tr.k) == side), 3, 4):       # inside of the bend
            mask[(a - LEAD + np.arange(ln + 2 * LEAD)) % n] = True
        for a, ln in cyclic_runs((np.abs(tr.k) > 1.0 / EXIT_R) & (np.sign(tr.k) == -side), 3, 4):         # outside, at the exit
            mask[(a + ln // 2 + np.arange(ln // 2 + 18)) % n] = True
        mask &= ~blocked
        out += [(side, int(a), int(ln)) for a, ln in cyclic_runs(mask, 8, 2)]
    return out


def kerb_lines_en(tr: Track) -> list[np.ndarray]:
    """Centre lines of the kerbs in east/north, for keeping other markings off them."""
    return [tr.en((a + np.arange(ln + 1)).astype(float), side * ((tr.wl if side > 0 else tr.wr)[(a + np.arange(ln + 1)) % tr.n] + 0.5))
            for side, a, ln in kerb_runs(tr)]


def build_kerbs(tr: Track, parts: Parts) -> dict:
    runs = kerb_runs(tr)
    for k, (side, a, ln) in enumerate(runs):
        st = a + np.arange(ln + 1)
        taper = np.clip(np.minimum(np.arange(ln + 1), ln - np.arange(ln + 1)) / 2.0, 0.0, 1.0)      # ramps up over 2 m
        w = (tr.wl if side > 0 else tr.wr)[st % tr.n]
        ii = np.repeat(st[:, None], 4, 1).astype(float)
        dd = side * (w[:, None] + PROFILE_E[None, :])
        dy = PROFILE_H[None, :] * np.where(PROFILE_H[None, :] > 0, np.maximum(taper[:, None], 0.18), 1.0)
        pos = tr.world(ii, dd, dy)
        uv = np.stack([np.broadcast_to(PROFILE_E[None, :], ii.shape), ii / 2.0], -1).reshape(-1, 2)   # 1 m red, 1 m white
        parts.surface(f"1KERB_k{k:02d}", "kerb", pos, uv, grid_tris(ln + 1, 4), cast_shadows=False)
    return dict(kerbs=len(runs), kerb_m=int(sum(r[2] for r in runs)))
