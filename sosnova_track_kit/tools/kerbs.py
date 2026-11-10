"""Red and white kerbs. A kerb stands on the inside of every corner tighter than INSIDE_R, on the outside of the
exit of the tightest corners, and wherever the photo shows a wide edge strip on the real circuit (edges.json).
Gentle bends get none. Kerbs are 1 m wide with a low rounded profile, just outside the white edge line."""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import lap_file  # noqa: E402
from track import Parts, Track, cyclic_runs, grid_tris  # noqa: E402

INSIDE_R = 30.0      # kerb on the inside of corners tighter than this radius (m)
EXIT_R = 15.0        # exit kerb on the outside after corners tighter than this
LEAD = 3             # metres of kerb before and after the bend
PROFILE_E = np.array([0.0, 0.5, 1.0, 1.03])          # distance outwards from the road edge (m)
PROFILE_H = np.array([0.008, 0.045, 0.022, -0.04])   # height above the road plane (m)


def kerb_runs(tr: Track, own=None) -> list[tuple[int, int, int]]:
    """(side, first station, length) of every kerb; side +1 = left of the direction of travel.
    own: for the standard lap, the stations of its own roads; kerbs elsewhere belong to the race lap."""
    n = tr.n
    seen = json.load(open(lap_file("edges", "json", tr.lap_name), encoding="utf-8"))["kerbs"]
    out = []
    for side, is_open in ((1, tr.open_l), (-1, tr.open_r)):
        mask = np.zeros(n, bool)
        for a, ln in cyclic_runs((np.abs(tr.k) > 1.0 / INSIDE_R) & (np.sign(tr.k) == side), 3, 4):       # inside of the bend
            mask[(a - LEAD + np.arange(ln + 2 * LEAD)) % n] = True
        for a, ln in cyclic_runs((np.abs(tr.k) > 1.0 / EXIT_R) & (np.sign(tr.k) == -side), 3, 4):         # outside, at the exit
            mask[(a + ln // 2 + np.arange(ln // 2 + 14)) % n] = True
        for k in seen:                                                                                    # seen in the photo
            if k["side"] == side and k["width"] >= 1.0:
                mask[(k["start"] + np.arange(k["length"])) % n] = True
        mask &= ~is_open                                               # no kerb in the middle of open asphalt
        if side > 0:
            mask &= ~tr.in_pit_stretch()
        if own is not None:
            mask &= own
        out += [(side, int(a), int(ln)) for a, ln in cyclic_runs(mask, 8, 2)]
    return out


def build_kerbs(tr: Track, parts: Parts, own=None) -> dict:
    runs = kerb_runs(tr, own)
    tag = "s" if own is not None else "k"
    for k, (side, a, ln) in enumerate(runs):
        st = a + np.arange(ln + 1)
        taper = np.clip(np.minimum(np.arange(ln + 1), ln - np.arange(ln + 1)) / 2.0, 0.0, 1.0)      # ramps up over 2 m
        w = (tr.wl if side > 0 else tr.wr)[st % tr.n]
        ii = np.repeat(st[:, None], 4, 1).astype(float)
        dd = side * (w[:, None] + PROFILE_E[None, :])
        dy = PROFILE_H[None, :] * np.where(PROFILE_H[None, :] > 0, np.maximum(taper[:, None], 0.18), 1.0)
        pos = tr.world(ii, dd, dy)
        uv = np.stack([np.broadcast_to(PROFILE_E[None, :], ii.shape), ii / 2.0], -1).reshape(-1, 2)   # 1 m red, 1 m white
        parts.surface(f"1KERB_{tag}{k:02d}", "kerb", pos, uv, grid_tris(ln + 1, 4), cast_shadows=False)
    return dict(kerbs=len(runs), kerb_m=int(sum(r[2] for r in runs)))
