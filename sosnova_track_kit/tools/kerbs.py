"""Red and white kerbs: along the inside of every corner, and on the outside of the exit of tight corners.
They stand on the verge just outside the white edge line, 1 m wide, with a low rounded profile."""
from __future__ import annotations

import os
import sys

import numpy as np
from shapely import contains_xy
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import circuit  # noqa: E402
from track import Parts, SurfaceLookup, Track, cyclic_runs, grid_tris  # noqa: E402

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
        blocked = tr.in_pit_stretch() if side > 0 else np.zeros(n, bool)       # the pit exit stays free
        mask = np.zeros(n, bool)
        for a, ln in cyclic_runs((np.abs(tr.k) > 1.0 / INSIDE_R) & (np.sign(tr.k) == side), 3, 4):       # inside of the bend
            mask[(a - LEAD + np.arange(ln + 2 * LEAD)) % n] = True
        for a, ln in cyclic_runs((np.abs(tr.k) > 1.0 / EXIT_R) & (np.sign(tr.k) == -side), 3, 4):         # outside, at the exit
            mask[(a + ln // 2 + np.arange(ln // 2 + 18)) % n] = True
        mask &= ~blocked
        # no kerb across the mouth of a road that joins the lap
        w = tr.wl if side > 0 else tr.wr
        mid = tr.en(np.arange(n).astype(float), side * (w + 0.5))
        mask &= ~contains_xy(unary_union([circuit.roads_polygon(), circuit.areas("road")]).buffer(0.4), mid[:, 0], mid[:, 1])
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


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return list(zip(np.where(d == 1)[0].tolist(), (np.where(d == -1)[0] - np.where(d == 1)[0]).tolist()))


def build_road_kerbs(tr: Track, parts: Parts, asphalt) -> dict:
    """The same raised red and white kerbs on the other roads of the circuit, by the same rule as on the lap:
    inside of every bend tighter than INSIDE_R, outside of the exit of bends tighter than EXIT_R. They stand on
    the built ground. asphalt: the lap and all other asphalt; no kerb where it would lie on asphalt."""
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1APRON", "1GRASS_g", "1SAND"))
    count, total = 0, 0.0
    for road in circuit.road_frames():
        q, nrm, half, k = road["en"], road["nrm"], road["half"], road["k"]
        m = len(q)
        lead = 2 * LEAD
        for side in (1, -1):
            mask = np.zeros(m, bool)
            for a, ln in _runs((np.abs(k) > 1.0 / INSIDE_R) & (np.sign(k) == side)):
                if ln >= 6:
                    mask[max(0, a - lead): a + ln + lead] = True
            for a, ln in _runs((np.abs(k) > 1.0 / EXIT_R) & (np.sign(k) == -side)):
                if ln >= 6:
                    mask[a + ln // 2: a + ln + 36] = True
            edge = q + nrm * side * half
            for off in (0.35, 1.0):
                p = edge + nrm * side * off
                mask &= ~contains_xy(asphalt, p[:, 0], p[:, 1])
            for a, ln in _runs(mask):
                if ln < 16:
                    continue
                e_, n_ = edge[a: a + ln], nrm[a: a + ln] * side
                taper = np.clip(np.minimum(np.arange(ln), ln - 1 - np.arange(ln)) / 4.0, 0.0, 1.0)
                base = tr.fr.world(e_, tr.H.ground(e_))
                yb = look.ys(base[:, [0, 2]], base[:, 1])
                en = (e_[:, None, :] + n_[:, None, :] * PROFILE_E[None, :, None]).reshape(-1, 2)
                pos = tr.fr.world(en, tr.H.ground(en))
                dy = PROFILE_H[None, :] * np.where(PROFILE_H[None, :] > 0, np.maximum(taper[:, None], 0.18), 1.0)
                pos[:, 1] = (yb[:, None] + dy).ravel()
                s_ = (a + np.arange(ln)) * 0.5
                uv = np.stack([np.broadcast_to(PROFILE_E[None, :], (ln, 4)), np.broadcast_to(s_[:, None] / 2.0, (ln, 4))], -1).reshape(-1, 2)
                parts.surface(f"1KERB_r{count:02d}", "kerb", pos, uv, grid_tris(ln, 4), cast_shadows=False)
                count += 1
                total += (ln - 1) * 0.5
    return dict(road_kerbs=count, road_kerb_m=round(total))
