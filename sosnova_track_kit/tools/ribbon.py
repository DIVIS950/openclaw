"""Road ribbon (asphalt with in-mesh edge lines), painted markings, kerbs and barriers."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, WORK  # noqa: E402
from textures import ROAD_TILE_M  # noqa: E402
from track import Parts, Track, cyclic_runs, grid_tris, vertex_normals, wind_up  # noqa: E402

LINE_IN, LINE_W = 0.25, 0.15      # white edge line: distance from the road edge and width (m)
CHUNK = 125                       # stations per road mesh
KERB_R = 45.0                     # kerbs on the inside of corners tighter than this radius (m)
BARRIER_OFF, BARRIER_HALF, BARRIER_H = 0.65, 0.25, 0.95
DECAL_DY = 0.012


def columns(tr: Track, i: np.ndarray) -> np.ndarray:
    """Lateral offsets of the 9 road columns at stations i, from the right edge to the left edge."""
    wl, wr = tr.wl[i], tr.wr[i]
    a, b = -(wr - LINE_IN - LINE_W), wl - LINE_IN - LINE_W
    inner = [a + (b - a) * t for t in (0.25, 0.5, 0.75)]
    return np.stack([-wr, -(wr - LINE_IN), a, *inner, b, wl - LINE_IN, wl], axis=1)


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
    tiles = round(tr.lap / ROAD_TILE_M)
    v_along = np.arange(n + 1) * tiles / n
    uv_road = np.stack([D / ROAD_TILE_M + 0.5, np.broadcast_to(v_along[:, None], D.shape)], -1).reshape(-1, 2)
    s = np.arange(n + 1, dtype=float)
    u_line = np.tile(np.array([0, 0, 1, 0, 0, 0, 0, 1, 0], float), (n + 1, 1))   # across each 0.15 m line
    u_line[:, 2], u_line[:, 6], u_line[:, 1], u_line[:, 7] = 1, 0, 0, 1
    uv_line = np.stack([u_line * 0.5 + 0.25, np.broadcast_to((s / 2.0)[:, None], D.shape)], -1).reshape(-1, 2)
    road_strips, line_strips = (0, 2, 3, 4, 5, 7), (1, 6)
    for k, a in enumerate(range(0, n, CHUNK)):
        b = min(n, a + CHUNK)
        for strips, group, mat, uv in ((road_strips, "1ROAD_trk", "road", uv_road), (line_strips, "1ROAD_line", "paint", uv_line)):
            tris = []
            for j in strips:
                r = np.arange(a, b)
                p00, p01, p10, p11 = r * cols + j, r * cols + j + 1, (r + 1) * cols + j, (r + 1) * cols + j + 1
                tris.append(np.stack([p00, p01, p11], -1))
                tris.append(np.stack([p00, p11, p10], -1))
            t = wind_up(pos, np.concatenate(tris))
            ids, inv = np.unique(t, return_inverse=True)
            parts.add(f"{group}_{k:02d}", mat, pos[ids], nrm[ids], uv[ids], inv.reshape(-1, 3))


def decal(tr: Track, parts: Parts, group: str, material: str, i0: float, i1: float, d0: float, d1: float,
          uvrect=(0.3, 0.3, 0.7, 0.7)) -> None:
    """Painted rectangle on the road between stations i0..i1 and lateral offsets d0..d1."""
    rows = np.unique(np.concatenate([[i0, i1], np.arange(np.ceil(i0), np.floor(i1) + 1)]))
    rows = rows[(rows >= i0) & (rows <= i1)]
    ii, dd = np.meshgrid(rows, np.array([d0, d1]), indexing="ij")
    pos = tr.world(ii, dd, DECAL_DY)
    u0, v0, u1, v1 = uvrect
    uv = np.stack([np.where(dd == d0, u0, u1), v0 + (ii - i0) / max(i1 - i0, 1e-9) * (v1 - v0)], -1).reshape(-1, 2)
    parts.surface(group, material, pos, uv, grid_tris(len(rows), 2), cast_shadows=False)


def build_markings(tr: Track, parts: Parts, grid: list[tuple[float, float]]) -> None:
    """Chequered start/finish band and grid boxes. grid = list of (station, lateral) of the car centres."""
    wl, wr = float(tr.wl[0]), float(tr.wr[0])
    a, b = -(wr - LINE_IN - LINE_W), wl - LINE_IN - LINE_W
    nsq = int((b - a) / 0.5)
    sq = (b - a) / nsq
    for r, (i0, i1) in enumerate(((-0.5, 0.0), (0.0, 0.5))):
        for c in range(nsq):
            if (r + c) % 2 == 0:
                decal(tr, parts, "MARK_sf", "paint", i0, i1, a + c * sq, a + (c + 1) * sq)
    for st, lat in grid:
        front = st + 2.6
        decal(tr, parts, "MARK_grid", "paint", front, front + 0.12, lat - 1.15, lat + 1.15)
        for side in (-1.15, 1.03):
            decal(tr, parts, "MARK_grid", "paint", front - 1.4, front, lat + side, lat + side + 0.12)


def build_kerbs(tr: Track, parts: Parts) -> list[tuple[int, int, int]]:
    """Red/white kerbs on the inside of tight corners, on the verge just outside the white line."""
    out = []
    prof_e = np.array([0.0, 0.5, 1.0, 1.03])
    prof_h = np.array([0.008, 0.045, 0.022, -0.04])
    for side in (1, -1):
        tight = (np.abs(tr.k) > 1.0 / KERB_R) & (np.sign(tr.k) == side)
        blocked = tr.open_l if side > 0 else tr.open_r
        mask = np.zeros(tr.n, bool)
        for a, ln in cyclic_runs(tight, 3, 4):
            mask[(a - 3 + np.arange(ln + 6)) % tr.n] = True      # start a little before, end a little after
        mask &= ~blocked
        for a, ln in cyclic_runs(mask, 8, 0):
            st = a + np.arange(ln + 1)
            taper = np.clip(np.minimum(np.arange(ln + 1), ln - np.arange(ln + 1)) / 2.0, 0.0, 1.0)
            w = (tr.wl if side > 0 else tr.wr)[st % tr.n]
            ii = np.repeat(st[:, None], 4, 1).astype(float)
            dd = side * (w[:, None] + prof_e[None, :])
            dy = prof_h[None, :] * np.where(prof_h[None, :] > 0, np.maximum(taper[:, None], 0.18), 1.0)
            pos = tr.world(ii, dd, dy)
            uv = np.stack([np.broadcast_to(prof_e[None, :], ii.shape), ii / 2.0], -1).reshape(-1, 2)
            parts.surface(f"1KERB_k{len(out):02d}", "kerb", pos, uv, grid_tris(ln + 1, 4), cast_shadows=False)
            out.append((side, int(a), int(ln)))
    return out


def asphalt_run(tr: Track, side: int, reach: float = 30.0) -> np.ndarray:
    """How far (m) the asphalt continues beyond the road edge, per station, from the orthophoto mask."""
    asphalt = np.load(os.path.join(WORK, "classes.npz"))["asphalt"]
    rows, cols = asphalt.shape
    w = tr.wl if side > 0 else tr.wr
    d = np.arange(0.75, reach, 0.5)
    en = tr.c[:, None, :] + side * tr.nrm[:, None, :] * (w[:, None] + d[None, :])[..., None]
    px = np.clip(((en[..., 0] + HALF_E) / 0.25).astype(int), 0, cols - 1)
    py = np.clip(((HALF_N - en[..., 1]) / 0.25).astype(int), 0, rows - 1)
    hit = asphalt[py, px]
    gap = ~hit[:, :-1] & ~hit[:, 1:]                      # two samples in a row without asphalt
    first = np.where(gap.any(1), gap.argmax(1), len(d) - 1)
    return d[first] - 0.75


def barrier_mask(tr: Track, side: int) -> np.ndarray:
    """Edges that need a barrier: the asphalt goes on for more than a hard shoulder (a junction or an apron)."""
    m = (tr.open_l if side > 0 else tr.open_r) & (asphalt_run(tr, side) >= 6.0)
    if side > 0:
        m &= ~tr.in_pit_stretch()
    return m


def build_barriers(tr: Track, parts: Parts) -> list[tuple[int, int, int]]:
    """Solid red/white barrier modules wherever the road edge borders more asphalt (junctions, aprons)."""
    out = []
    for side in (1, -1):
        for a, ln in cyclic_runs(barrier_mask(tr, side), 3, 6):
            st = (a + np.arange(ln + 1)).astype(float)
            w = (tr.wl if side > 0 else tr.wr)[st.astype(int) % tr.n]
            dc = w + BARRIER_OFF
            # cross-section corners: inner bottom, inner top, outer top, outer bottom
            sec = [(dc - BARRIER_HALF, -0.25), (dc - BARRIER_HALF * 0.7, BARRIER_H), (dc + BARRIER_HALF * 0.7, BARRIER_H), (dc + BARRIER_HALF, -0.25)]
            ring = [tr.world(st, side * d, dy) for d, dy in sec]
            centre = tr.world(st, side * dc, BARRIER_H / 2)
            u = st / 4.0
            name = f"1WALL_bar{len(out):02d}"
            for (pa, pb), (va, vb) in zip(((ring[0], ring[1]), (ring[1], ring[2]), (ring[2], ring[3])), ((0.0, 0.92), (0.92, 1.0), (0.92, 0.0))):
                pos = np.vstack([pa, pb])
                uv = np.vstack([np.column_stack([u, np.full(len(u), va)]), np.column_stack([u, np.full(len(u), vb)])])
                m = len(st)
                r = np.arange(m - 1)
                tris = np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)])
                mid = (pos[tris[:, 0]] + pos[tris[:, 1]] + pos[tris[:, 2]]) / 3
                cc = np.vstack([centre, centre])
                hint = mid - (cc[tris[:, 0]] + cc[tris[:, 1]] + cc[tris[:, 2]]) / 3
                parts.surface(name, "barrier", pos, uv, tris, hint=hint)
            for e in (0, -1):                                   # end caps
                p = np.array([ring[0][e], ring[3][e], ring[2][e], ring[1][e]])
                parts.quad(name, "barrier", p, (0.02, 0.0, 0.12, 0.92), hint=p.mean(0) - centre[-2 if e else 1], smooth=False)
            out.append((side, int(a), int(ln)))
    return out
