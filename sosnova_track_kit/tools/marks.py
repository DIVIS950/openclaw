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


EDGE_IN, EDGE_W = 0.22, 0.15    # white edge line of the lap: distance from the asphalt edge and width (m)


def edge_line_runs(tr: Track) -> list[tuple[int, np.ndarray]]:
    """(side, stations) of every piece of white edge line. A real asphalt edge carries a solid line. Where the
    lap runs beside open asphalt (a junction, the square, the pit apron) the line is broken into dashes, so the
    route stays readable without inventing an edge."""
    n = tr.n
    out = []
    for side, is_open, w in ((1, tr.open_l, tr.wl), (-1, tr.open_r, tr.wr)):
        # no line where the edge swings sideways (the mouth of a junction): a line there would be a hook
        swing = np.abs(np.roll(w, -1) - np.roll(w, 1)) / 2.0 > 0.14
        swing = np.convolve(np.tile(swing, 3), np.ones(7), "same")[n: 2 * n] > 0
        for a, ln in cyclic_runs(~is_open & ~swing, 6, 0):
            out.append((side, a + np.arange(ln + 1)))
        for a, ln in cyclic_runs(is_open & ~swing, 4, 0):
            for k in range(a + 2, a + ln - 3, 6):                                 # 3 m line, 3 m gap
                out.append((side, k + np.arange(4)))
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
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1ROAD_x", "1APRON", "1GRASS_g"))
    stats = dict(lines=0, line_m=0.0, areas=0)
    from scipy.spatial import cKDTree
    edge_tree = cKDTree(np.vstack(edge_lines_en(tr)))

    def lay(en: np.ndarray) -> np.ndarray:
        pos = tr.fr.world(en, tr.H.ground(en))
        pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT
        return pos

    P, U, T, off = [], [], [], 0
    for line in data["lines"]:
        p = np.array(line["en"], float)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        if cum[-1] < 0.5:
            continue
        m = max(2, int(np.ceil(cum[-1] / 0.6)) + 1)
        s = np.linspace(0, cum[-1], m)
        q = np.column_stack([np.interp(s, cum, p[:, 0]), np.interp(s, cum, p[:, 1])])
        inside = contains_xy(asphalt, q[:, 0], q[:, 1]) & ~contains_xy(keep_out, q[:, 0], q[:, 1])
        if inside.mean() < 0.7 or (edge_tree.query(q)[0] < 1.3).mean() > 0.5:      # off the asphalt, or a copy of an edge line
            continue
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
    AP, AU, AT, aoff = [], [], [], 0
    for ring in data["areas"]:
        poly = Polygon(ring).buffer(0)
        if poly.is_empty or poly.geom_type != "Polygon" or not (0.15 < poly.area < MAX_AREA):
            continue
        c = poly.representative_point()
        if not asphalt.contains(c) or keep_out.contains(c):
            continue
        xy = np.array(poly.exterior.coords)[:-1]
        k = len(xy)
        if k < 3:
            continue
        try:
            out = tri.triangulate(dict(vertices=xy, segments=np.array([(i, (i + 1) % k) for i in range(k)], np.int32)), "p")
        except Exception:
            continue
        if "triangles" not in out or len(out["triangles"]) == 0:
            continue
        AP.append(lay(out["vertices"]))
        AU.append(out["vertices"] / 3.0)
        AT.append(out["triangles"] + aoff)
        aoff += len(out["vertices"])
        stats["areas"] += 1
    if AP:                                                   # flat concrete kerbs and painted patches
        parts.surface("MARK_kerb", "pad", np.vstack(AP), np.vstack(AU), np.vstack(AT), hint=UP, smooth=False, cast_shadows=False)
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


def build_road_lines(tr: Track, parts: Parts, roads: list, asphalt, aprons, keep_out, lap=None) -> dict:
    """White edge lines on the other roads: two parallel lines per road, the same distance from its centre.
    roads: [(centre line east/north, width m)]. No lines across broad aprons, the lap, or next to buildings."""
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1ROAD_x", "1APRON", "1GRASS_g", "1SAND"))
    off_limits = unary_union([aprons.buffer(-1.0), keep_out]) if not aprons.is_empty else keep_out
    if lap is not None:
        off_limits = unary_union([off_limits, lap.buffer(0.2)])
    from scipy.ndimage import gaussian_filter1d
    KP, KU, KT, koff, kerb_m = [], [], [], 0, 0.0
    P, U, T, off, total = [], [], [], 0, 0.0
    for line, width in roads:
        seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        m = int(cum[-1] / 0.6) + 1
        if m < 12:
            continue
        s = np.linspace(0, cum[-1], m)
        q = np.column_stack([np.interp(s, cum, line[:, 0]), np.interp(s, cum, line[:, 1])])
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]])
        # flat red and white kerb on the inside of the bends of this road
        a_, b_ = q[1:-1] - q[:-2], q[2:] - q[1:-1]
        turn = np.zeros(m)
        turn[1:-1] = (a_[:, 0] * b_[:, 1] - a_[:, 1] * b_[:, 0]) / np.maximum(np.linalg.norm(a_, axis=1) * np.linalg.norm(b_, axis=1) * 0.6, 1e-9)
        turn = gaussian_filter1d(turn, 4.0, mode="nearest")
        for sgn in (1.0, -1.0):
            inner, outer = q + nrm * sgn * (width / 2), q + nrm * sgn * (width / 2 + 1.0)
            okk = (turn * sgn > 1.0 / 40.0) & ~contains_xy(off_limits, outer[:, 0], outer[:, 1]) & ~contains_xy(asphalt, outer[:, 0], outer[:, 1])
            for a0, ln in ((x_, l_) for x_, l_ in _runs(okk) if l_ * 0.6 >= 6.0):
                en = np.vstack([inner[a0: a0 + ln], outer[a0: a0 + ln]])
                pos = tr.fr.world(en, tr.H.ground(en))
                pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT + 0.01
                k = np.arange(ln - 1)
                KP.append(pos)
                KU.append(np.vstack([np.column_stack([np.full(ln, 0.0), s[a0: a0 + ln] / 2.0]), np.column_stack([np.full(ln, 1.0), s[a0: a0 + ln] / 2.0])]))
                KT.append(np.concatenate([np.stack([k, k + ln, k + ln + 1], -1), np.stack([k, k + ln + 1, k + 1], -1)]) + koff)
                koff += len(pos)
                kerb_m += (ln - 1) * 0.6
        for side in (1.0, -1.0):
            c = q + nrm * side * (width / 2 - 0.3)
            ok = contains_xy(asphalt, c[:, 0], c[:, 1]) & ~contains_xy(off_limits, c[:, 0], c[:, 1])
            for a0, ln in ((a_, l_) for a_, l_ in _runs(ok) if l_ * 0.6 >= 8.0):
                cc, nn = c[a0: a0 + ln], nrm[a0: a0 + ln] * 0.06
                en = np.vstack([cc + nn, cc - nn])
                pos = tr.fr.world(en, tr.H.ground(en))
                pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT
                k = np.arange(ln - 1)
                P.append(pos)
                U.append(np.vstack([np.column_stack([np.full(ln, 0.2), np.arange(ln) * 0.3]), np.column_stack([np.full(ln, 0.8), np.arange(ln) * 0.3])]))
                T.append(np.concatenate([np.stack([k, k + ln, k + ln + 1], -1), np.stack([k, k + ln + 1, k + 1], -1)]) + off)
                off += len(pos)
                total += (ln - 1) * 0.6
    if P:
        pos, tris = np.vstack(P), np.vstack(T)
        cen = pos[tris].mean(1)
        order = np.lexsort((np.floor(cen[:, 2] / 100), np.floor(cen[:, 0] / 100)))
        parts.surface("MARK_roads", "paint", pos, np.vstack(U), tris[order], hint=UP, smooth=False, cast_shadows=False)
    if KP:
        parts.surface("MARK_roadkerbs", "kerbc", np.vstack(KP), np.vstack(KU), np.vstack(KT), hint=UP, smooth=False, cast_shadows=False)
    return dict(other_roads=len(roads), other_road_m=round(sum(float(np.linalg.norm(np.diff(l, axis=0), axis=1).sum()) for l, _ in roads)),
                other_road_line_m=round(total), other_road_kerb_m=round(kerb_m))


def build_area_lines(tr: Track, parts: Parts, areas, asphalt, keep_out) -> dict:
    """A white line along the free edge of every paved area: drawn 0.3 m inside the outline wherever grass lies beyond it."""
    look = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1ROAD_x", "1APRON", "1GRASS_g", "1SAND"))
    P, U, T, off, total = [], [], [], 0, 0.0
    for poly in getattr(areas, "geoms", [areas]):
        if poly.is_empty:
            continue
        for ring in [poly.exterior, *poly.interiors]:
            m = int(ring.length / 0.6)
            if m < 20:
                continue
            q = np.array([ring.interpolate(k * 0.6).coords[0] for k in range(m)])
            d = np.roll(q, -1, axis=0) - np.roll(q, 1, axis=0)
            d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
            out = np.column_stack([d[:, 1], -d[:, 0]])
            if poly.contains(Point(q[0] + out[0] * 0.5)):
                out = -out
            c, beyond = q - out * 0.3, q + out * 1.2
            ok = ~contains_xy(asphalt, beyond[:, 0], beyond[:, 1]) & ~contains_xy(keep_out, c[:, 0], c[:, 1]) & contains_xy(asphalt, c[:, 0], c[:, 1])
            if ok.all():
                runs = [(0, m + 1)]
            else:
                k0 = int(np.argmin(ok))
                runs = [((a0 + k0) % m, ln) for a0, ln in _runs(np.roll(ok, -k0))]
            for a0, ln in runs:
                if ln * 0.6 < 8.0:
                    continue
                idx = (a0 + np.arange(ln)) % m
                cc, nn = c[idx], out[idx] * 0.06
                en = np.vstack([cc + nn, cc - nn])
                pos = tr.fr.world(en, tr.H.ground(en))
                pos[:, 1] = look.ys(pos[:, [0, 2]], pos[:, 1]) + LIFT
                k = np.arange(ln - 1)
                P.append(pos)
                U.append(np.vstack([np.column_stack([np.full(ln, 0.2), np.arange(ln) * 0.3]), np.column_stack([np.full(ln, 0.8), np.arange(ln) * 0.3])]))
                T.append(np.concatenate([np.stack([k, k + ln, k + ln + 1], -1), np.stack([k, k + ln + 1, k + 1], -1)]) + off)
                off += len(pos)
                total += (ln - 1) * 0.6
    if P:
        pos, tris = np.vstack(P), np.vstack(T)
        cen = pos[tris].mean(1)
        order = np.lexsort((np.floor(cen[:, 2] / 100), np.floor(cen[:, 0] / 100)))
        parts.surface("MARK_areas", "paint", pos, np.vstack(U), tris[order], hint=UP, smooth=False, cast_shadows=False)
    return dict(area_line_m=round(total))


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return list(zip(np.where(d == 1)[0].tolist(), (np.where(d == -1)[0] - np.where(d == 1)[0]).tolist()))
