"""Painted markings as sharp geometry: the lines, boxes and kerb stones traced from the photo (paint.py),
laid 2 cm above the asphalt they belong to."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import triangle as tri
from shapely import contains_xy
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK  # noqa: E402
from track import Parts, SurfaceLookup, Track, cyclic_runs  # noqa: E402

LIFT = 0.02
MAX_AREA = 40.0        # larger bright patches are surfaces (concrete, sand), not paint: the photo shows those
UP = np.array([0.0, 1.0, 0.0])


EDGE_IN, EDGE_W = 0.20, 0.12    # white edge line of the lap: distance from the asphalt edge and width (m)


def edge_line_runs(tr: Track) -> list[tuple[int, np.ndarray]]:
    """A white line along every real edge of the lap: where the asphalt ends at grass or sand, or at a concrete
    strip. Where the asphalt runs on (junctions, the plaza) there is none. (side, stations) per piece."""
    n = tr.n
    out = []
    for side, is_open, kerb in ((1, tr.open_l, tr.conc_l), (-1, tr.open_r, tr.conc_r)):
        solid = ~is_open | kerb
        for a, ln in cyclic_runs(solid, 14, 3):
            if ln == n:
                out.append((side, a + np.arange(n + 1)))
            else:                                       # the line stops 2 m short of the place where the asphalt opens
                out.append((side, a + 2 + np.arange(ln - 3)))
    return out


def edge_lines_en(tr: Track) -> list[np.ndarray]:
    return [tr.en(st.astype(float), side * ((tr.wl if side > 0 else tr.wr)[st % tr.n] - EDGE_IN - EDGE_W / 2)) for side, st in edge_line_runs(tr)]


def build_edge_lines(tr: Track, parts: Parts) -> dict:
    """Solid white lines along both edges of the lap, as on the resurfaced circuit."""
    total = 0
    for k, (side, st) in enumerate(edge_line_runs(tr)):
        w = (tr.wl if side > 0 else tr.wr)[st % tr.n]
        i = st.astype(float)
        pos = np.vstack([tr.world(i, side * (w - EDGE_IN), LIFT), tr.world(i, side * (w - EDGE_IN - EDGE_W), LIFT)])
        m = len(st)
        r = np.arange(m - 1)
        uv = np.vstack([np.column_stack([np.full(m, 0.2), i / 2.0]), np.column_stack([np.full(m, 0.8), i / 2.0])])
        parts.surface(f"MARK_edge{k // 12:02d}", "paint", pos, uv, np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)]),
                      hint=UP, cast_shadows=False)
        total += m - 1
    return dict(edge_line_m=total)


def build_marks(tr: Track, parts: Parts, asphalt, keep_out) -> dict:
    """asphalt, keep_out: shapely geometries in east/north."""
    data = json.load(open(os.path.join(WORK, "paint.json"), encoding="utf-8"))
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1APRON", "1GRASS_g", "1GRASS_w", "1GRASS_v"))
    stats = dict(lines=0, line_m=0.0, areas=0)
    from scipy.spatial import cKDTree
    edge_tree = cKDTree(np.vstack(edge_lines_en(tr)))

    def lay(en: np.ndarray) -> np.ndarray:
        pos = tr.fr.world(en, tr.H.ground(en))
        pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT
        return pos

    import realmap
    boxes = [dict(en=b, width=0.14, box=True) for b in realmap.boxes()]         # painted outlines: start boxes, bays
    P, U, T, off = [], [], [], 0
    for line in list(data["lines"]) + boxes:
        p = np.array(line["en"], float)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        if cum[-1] < 0.5:
            continue
        m = max(2, int(np.ceil(cum[-1] / 0.6)) + 1)
        s = np.linspace(0, cum[-1], m)
        q = np.column_stack([np.interp(s, cum, p[:, 0]), np.interp(s, cum, p[:, 1])])
        inside = contains_xy(asphalt, q[:, 0], q[:, 1]) & ~contains_xy(keep_out, q[:, 0], q[:, 1])
        if inside.mean() < 0.7 or (not line.get("box") and ((edge_tree.query(q)[0] < 1.3).mean() > 0.5 or cum[-1] < 2.5)):
            continue                                                               # off the asphalt, a copy of an edge line, or a speck
        stats["areas"] += int(bool(line.get("box")))
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]]) * line["width"] / 2
        pos = np.vstack([lay(q + nrm), lay(q - nrm)])
        r = np.arange(m - 1)
        P.append(pos)
        U.append(np.vstack([np.column_stack([np.full(m, 0.2), s / 2.0]), np.column_stack([np.full(m, 0.8), s / 2.0])]))
        T.append(np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)]) + off)
        off += len(pos)
        stats["lines"] += 1
        stats["line_m"] += float(cum[-1])
    if P:
        pos, tris = np.vstack(P), np.vstack(T)
        cen = pos[tris].mean(1)
        order = np.lexsort((np.floor(cen[:, 2] / 100), np.floor(cen[:, 0] / 100)))
        parts.surface("MARK_paint", "paint", pos, np.vstack(U), tris[order], hint=UP, smooth=False, cast_shadows=False)
    stats["line_m"] = round(stats["line_m"])
    return stats


def _patch(tr: Track, parts: Parts, group: str, i0: float, i1: float, d0: float, d1: float) -> None:
    """Painted rectangle on the lap between stations i0..i1 and lateral offsets d0..d1."""
    rows = np.unique(np.concatenate([[i0, i1], np.arange(np.ceil(i0), np.floor(i1) + 1)]))
    rows = rows[(rows >= i0) & (rows <= i1)]
    ii, dd = np.meshgrid(rows, np.array([d0, d1]), indexing="ij")
    pos = tr.world(ii, dd, LIFT + 0.004)
    uv = np.stack([np.where(dd == d0, 0.2, 0.8), ii / 2.0], -1).reshape(-1, 2)
    r = np.arange(len(rows) - 1) * 2
    parts.surface(group, "paint", pos, uv, np.concatenate([np.stack([r, r + 1, r + 3], -1), np.stack([r, r + 3, r + 2], -1)]), hint=UP, cast_shadows=False)


def build_start(tr: Track, parts: Parts, grid: list[tuple[float, float]], pits: list[tuple[float, float, tuple]]) -> dict:
    """Chequered start/finish band, a box for every grid slot, a painted bay for every pit box.
    grid: (station, lateral) of the car centres. pits: (world x, world z, facing vector) of the pit boxes."""
    wl, wr = float(tr.wl[0]), float(tr.wr[0])
    a, b = -(wr - EDGE_IN - EDGE_W - 0.05), wl - EDGE_IN - EDGE_W - 0.05
    nsq = int((b - a) / 0.5)
    sq = (b - a) / nsq
    for r, (i0, i1) in enumerate(((-0.5, 0.0), (0.0, 0.5))):
        for c in range(nsq):
            if (r + c) % 2 == 0:
                _patch(tr, parts, "MARK_start", i0, i1, a + c * sq, a + (c + 1) * sq)
    for st, lat in grid:
        front = st + 2.6
        _patch(tr, parts, "MARK_grid", front, front + 0.12, lat - 1.15, lat + 1.15)
        for side in (-1.15, 1.03):
            _patch(tr, parts, "MARK_grid", front - 1.5, front, lat + side, lat + side + 0.12)
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1APRON"))
    P, U, T, off = [], [], [], 0
    for x, z, face in pits:
        f = np.array([face[0], face[2]])
        f /= np.linalg.norm(f)
        r = np.array([f[1], -f[0]])
        c = np.array([x, z])
        bars = [(c + r * 1.45 - f * 2.8, c + r * 1.45 + f * 2.8), (c - r * 1.45 - f * 2.8, c - r * 1.45 + f * 2.8), (c - r * 1.45 - f * 2.8, c + r * 1.45 - f * 2.8)]
        for p0, p1 in bars:
            m = max(2, int(np.linalg.norm(p1 - p0) / 0.6) + 1)
            q = p0 + (p1 - p0) * np.linspace(0, 1, m)[:, None]
            d = (p1 - p0) / np.linalg.norm(p1 - p0)
            nn = np.array([-d[1], d[0]]) * 0.05
            xz = np.vstack([q + nn, q - nn])
            en = tr.fr.o + xz[:, :1] * tr.fr.l + xz[:, 1:] * tr.fr.f
            pos = tr.fr.world(en, tr.H.ground(en))
            pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT
            k = np.arange(m - 1)
            P.append(pos)
            U.append(np.vstack([np.column_stack([np.full(m, 0.2), np.arange(m) * 0.3]), np.column_stack([np.full(m, 0.8), np.arange(m) * 0.3])]))
            T.append(np.concatenate([np.stack([k, k + m, k + m + 1], -1), np.stack([k, k + m + 1, k + 1], -1)]) + off)
            off += len(pos)
    if P:
        parts.surface("MARK_pits", "paint", np.vstack(P), np.vstack(U), np.vstack(T), hint=UP, smooth=False, cast_shadows=False)
    return dict(grid_boxes=len(grid), pit_bays=len(pits))


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return list(zip(np.where(d == 1)[0].tolist(), (np.where(d == -1)[0] - np.where(d == 1)[0]).tolist()))
