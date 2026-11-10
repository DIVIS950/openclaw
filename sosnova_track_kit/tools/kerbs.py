"""Kerbs of the lap. Sosnova has no red and white kerbs: some corners have a flat strip of pale concrete along
the asphalt edge. They are built only where the photo shows one (source/work/edges.json, from edgescan.py),
with the width measured there."""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK  # noqa: E402
from track import Parts, Track, grid_tris  # noqa: E402

PROFILE_E = np.array([0.0, 0.5, 1.0, 1.03])          # across the strip, as a share of its width (the last step is the skirt)
PROFILE_H = np.array([0.004, 0.022, 0.012, -0.04])   # height above the road plane (m): nearly flat


def kerb_runs(tr: Track) -> list[tuple[int, int, int, float]]:
    """(side, first station, length, width) of every kerb; side +1 = left of the direction of travel."""
    data = json.load(open(os.path.join(WORK, "edges.json"), encoding="utf-8"))["kerbs"]
    return [(int(k["side"]), int(k["start"]), int(k["length"]), float(k["width"])) for k in data]


def kerb_lines_en(tr: Track) -> list[np.ndarray]:
    """Centre lines of the kerbs in east/north, for keeping other markings off them."""
    return [tr.en((a + np.arange(ln + 1)).astype(float), side * ((tr.wl if side > 0 else tr.wr)[(a + np.arange(ln + 1)) % tr.n] + wd / 2))
            for side, a, ln, wd in kerb_runs(tr)]


def build_kerbs(tr: Track, parts: Parts) -> dict:
    runs = kerb_runs(tr)
    for k, (side, a, ln, wd) in enumerate(runs):
        st = a + np.arange(ln + 1)
        taper = np.clip(np.minimum(np.arange(ln + 1), ln - np.arange(ln + 1)) / 2.0, 0.0, 1.0)      # ramps up over 2 m
        w = (tr.wl if side > 0 else tr.wr)[st % tr.n]
        prof = np.array([0.0, 0.5 * wd, wd, wd + 0.03])
        ii = np.repeat(st[:, None], 4, 1).astype(float)
        dd = side * (w[:, None] + prof[None, :])
        dy = PROFILE_H[None, :] * np.where(PROFILE_H[None, :] > 0, np.maximum(taper[:, None], 0.3), 1.0)
        pos = tr.world(ii, dd, dy)
        uv = np.stack([np.broadcast_to(prof[None, :] / 2.0, ii.shape), ii / 2.0], -1).reshape(-1, 2)
        parts.surface(f"1KERB_k{k:02d}", "kerbc", pos, uv, grid_tris(ln + 1, 4), cast_shadows=False)
    return dict(kerbs=len(runs), kerb_m=int(sum(r[2] for r in runs)))
