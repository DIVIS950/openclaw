"""Solid shapes: the things that used to be flat pictures or plain boxes, as real three-dimensional bodies.

  * trees: a trunk, and a canopy with volume (stacked cones for a conifer, two rounded bodies for a broadleaf tree),
    with the pictures of the real tree around it for the fine outline
  * tyre walls: rows of single round stacks, four tyres high, each with its hole
  * power pylons: a square lattice tower with three pairs of cross-arms
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from track import Parts, Track  # noqa: E402

UP = np.array([0.0, 1.0, 0.0])


class Soup:
    """Collects closed bodies and hands them to Parts in one piece. Every triangle carries the point it has to face
    away from, so the winding comes out right whatever order the vertices were made in."""

    def __init__(self):
        self.P, self.U, self.T, self.C, self.off = [], [], [], [], 0

    def add(self, pos, uv, tris, centre):
        pos, tris = np.asarray(pos, float), np.asarray(tris, np.int64).reshape(-1, 3)
        self.P.append(pos), self.U.append(np.asarray(uv, float)), self.T.append(tris + self.off)
        self.C.append(np.broadcast_to(np.asarray(centre, float), (len(tris), 3)))
        self.off += len(pos)

    def flush(self, parts: Parts, group: str, material: str, smooth: bool = True, **flags) -> int:
        if not self.P:
            return 0
        pos, tris, cen = np.vstack(self.P), np.vstack(self.T), np.vstack(self.C)
        hint = pos[tris].mean(1) - cen
        # sort by place, so that the meshes the model is cut into are compact
        order = np.lexsort((np.floor(pos[tris[:, 0], 2] / 90), np.floor(pos[tris[:, 0], 0] / 90)))
        parts.surface(group, material, pos, np.vstack(self.U), tris[order], hint=hint[order], smooth=smooth, **flags)
        return len(tris)


def _ring(n: int, yaw: float = 0.0):
    a = yaw + np.linspace(0, 2 * np.pi, n + 1)
    return np.cos(a), np.sin(a), (a - yaw) / (2 * np.pi)


def cone(soup: Soup, base, radius, y0, y1, sides, yaw, rng, tip=0.03, wobble=0.12, u_rep=2.0):
    """A cone standing on `base` (world x, z): ring at height y0, tip at y1. The ring is a little uneven."""
    cx, sx, u = _ring(sides, yaw)
    r = radius * (1 + rng.uniform(-wobble, wobble, sides + 1))
    r[-1] = r[0]
    lo = np.column_stack([base[0] + cx * r, np.full(sides + 1, y0), base[1] + sx * r])
    hi = np.column_stack([base[0] + cx * tip, np.full(sides + 1, y1), base[1] + sx * tip])
    k = np.arange(sides)
    tris = np.concatenate([np.stack([k, k + 1, k + sides + 2], -1), np.stack([k, k + sides + 2, k + sides + 1], -1)])
    uv = np.vstack([np.column_stack([u * u_rep, np.zeros(sides + 1)]), np.column_stack([u * u_rep, np.ones(sides + 1)])])
    soup.add(np.vstack([lo, hi]), uv, tris, (base[0], y0 - 0.3 * (y1 - y0), base[1]))


def blob(soup: Soup, centre, rx, ry, sides, rings, yaw, rng, wobble=0.14, u_rep=2.0):
    """A rounded body (an uneven ellipsoid) around `centre` (world x, y, z)."""
    cx, sx, u = _ring(sides, yaw)
    lat = np.linspace(-np.pi / 2, np.pi / 2, rings + 1)
    rows, uvs = [], []
    for j, la in enumerate(lat):
        r = rx * np.cos(la) * (1 + rng.uniform(-wobble, wobble, sides + 1))
        r[-1] = r[0]
        rows.append(np.column_stack([centre[0] + cx * r, np.full(sides + 1, centre[1] + ry * np.sin(la)), centre[2] + sx * r]))
        uvs.append(np.column_stack([u * u_rep, np.full(sides + 1, j / rings)]))
    k = np.arange(sides)
    tris = []
    for j in range(rings):
        a, b = j * (sides + 1), (j + 1) * (sides + 1)
        tris += [np.stack([a + k, a + k + 1, b + k + 1], -1), np.stack([a + k, b + k + 1, b + k], -1)]
    soup.add(np.vstack(rows), np.vstack(uvs), np.concatenate(tris), centre)


def tube(soup: Soup, base, r0, r1, y0, y1, sides, yaw=0.0, u_rep=1.0, v_rep=1.0, cap=False, cap_uv=(0.5, 0.5)):
    """A (tapering) round column on `base` (world x, z)."""
    cx, sx, u = _ring(sides, yaw)
    lo = np.column_stack([base[0] + cx * r0, np.full(sides + 1, y0), base[1] + sx * r0])
    hi = np.column_stack([base[0] + cx * r1, np.full(sides + 1, y1), base[1] + sx * r1])
    k = np.arange(sides)
    tris = np.concatenate([np.stack([k, k + 1, k + sides + 2], -1), np.stack([k, k + sides + 2, k + sides + 1], -1)])
    uv = np.vstack([np.column_stack([u * u_rep, np.zeros(sides + 1)]), np.column_stack([u * u_rep, np.full(sides + 1, v_rep)])])
    soup.add(np.vstack([lo, hi]), uv, tris, (base[0], (y0 + y1) / 2, base[1]))
    if cap:
        top = np.vstack([hi[:sides], [(base[0], y1, base[1])]])
        soup.add(top, np.tile(cap_uv, (sides + 1, 1)), np.stack([np.full(sides, sides), k, (k + 1) % sides], -1), (base[0], y1 - 1.0, base[1]))


def build_trees(parts: Parts, pos: np.ndarray, height: np.ndarray, conifer: np.ndarray, width: np.ndarray, rng) -> dict:
    """pos: world positions of the feet (m, 3); height, width (m); conifer: which trees are conifers."""
    trunks, needles, leaves = Soup(), Soup(), Soup()
    for p, h, w, is_con in zip(pos, height, width, conifer):
        base, y0, yaw = (p[0], p[2]), p[1], rng.uniform(0, 2 * np.pi)
        rt = 0.06 + 0.014 * h
        if is_con:
            tube(trunks, base, rt, rt * 0.25, y0 - 0.3, y0 + 0.9 * h, 6, yaw, u_rep=2.0, v_rep=h / 3.0)
            r0 = 0.30 * w                                           # the body; the pictures carry the outer twigs
            for k in range(4):                                       # four tiers that overlap
                yb = y0 + h * (0.20 + 0.19 * k)
                yt = min(y0 + h, yb + h * (0.36 if k < 3 else 0.24))
                cone(needles, base, r0 * (1 - 0.21 * k), yb, yt, 8, yaw + 0.4 * k, rng, u_rep=3.0)
        else:
            tube(trunks, base, rt * 1.2, rt * 0.6, y0 - 0.3, y0 + 0.55 * h, 6, yaw, u_rep=2.0, v_rep=h / 3.0)
            blob(leaves, (p[0], y0 + 0.66 * h, p[2]), 0.36 * w, 0.30 * h, 8, 4, yaw, rng, u_rep=3.0)
            o = rng.uniform(-0.12, 0.12, 2) * w
            blob(leaves, (p[0] + o[0], y0 + 0.50 * h, p[2] + o[1]), 0.30 * w, 0.20 * h, 8, 3, yaw + 1.0, rng, u_rep=3.0)
    n = trunks.flush(parts, "TREE3D_trunks", "bark", cast_shadows=True)
    n += needles.flush(parts, "TREE3D_conifer", "foliagec", cast_shadows=True)
    n += leaves.flush(parts, "TREE3D_leaf", "foliagel", cast_shadows=True)
    return dict(solid_trees=int(len(pos)), solid_tree_triangles=int(n))


def build_tyre_stacks(tr: Track, parts: Parts, lines: list[np.ndarray], widths: list[float], seed: int = 11) -> dict:
    """Tyre walls as they are built: single stacks of four tyres, side by side along the line, two rows deep where
    the wall is wide. lines: east/north points every 0.65 m or so; widths: wall width per line (m)."""
    rng = np.random.default_rng(seed)
    D, SIDES = 0.62, 8
    side, top, hole = Soup(), Soup(), Soup()
    count = 0
    for q, width in zip(lines, widths):
        q = np.asarray(q, float)
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))])
        if cum[-1] < D:
            continue
        rows = 2 if width >= 1.1 else 1
        for r in range(rows):
            t = np.arange(D / 2 + (D / 2 if r else 0.0), cum[-1], D)
            if len(t) == 0:
                continue
            c = np.column_stack([np.interp(t, cum, q[:, 0]), np.interp(t, cum, q[:, 1])])
            d = np.column_stack([np.interp(np.clip(t + 0.3, 0, cum[-1]), cum, q[:, 0]), np.interp(np.clip(t + 0.3, 0, cum[-1]), cum, q[:, 1])]) - \
                np.column_stack([np.interp(np.clip(t - 0.3, 0, cum[-1]), cum, q[:, 0]), np.interp(np.clip(t - 0.3, 0, cum[-1]), cum, q[:, 1])])
            d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
            lat = (0.0 if rows == 1 else (D / 2 if r else -D / 2))
            c = c + np.column_stack([-d[:, 1], d[:, 0]]) * lat + rng.uniform(-0.03, 0.03, c.shape)
            g = tr.H.ground(c) - tr.fr.ref
            xz = tr.fr.xz(c)
            for (x, z), y in zip(xz, g):
                h = 0.88 + rng.uniform(-0.03, 0.03)
                yaw = rng.uniform(0, 2 * np.pi)
                R, r_in = D / 2 - 0.005, 0.17
                tube(side, (x, z), R, R, y - 0.15, y + h, SIDES, yaw, u_rep=3.0, v_rep=1.0)
                cx, sx, _ = _ring(SIDES, yaw)                      # the top: a ring of rubber around the hole
                outer = np.column_stack([x + cx * R, np.full(SIDES + 1, y + h), z + sx * R])
                inner = np.column_stack([x + cx * r_in, np.full(SIDES + 1, y + h - 0.01), z + sx * r_in])
                k = np.arange(SIDES)
                top.add(np.vstack([outer, inner]), np.tile((0.5, 0.42), (2 * (SIDES + 1), 1)),
                        np.concatenate([np.stack([k, k + 1, k + SIDES + 2], -1), np.stack([k, k + SIDES + 2, k + SIDES + 1], -1)]), (x, y + h - 1.0, z))
                deep = np.vstack([inner[:SIDES] - UP * 0.10, [(x, y + h - 0.11, z)]])
                hole.add(deep, np.tile((0.5, 0.02), (SIDES + 1, 1)), np.stack([np.full(SIDES, SIDES), k, (k + 1) % SIDES], -1), (x, y + h - 1.0, z))
                count += 1
    n = side.flush(parts, "TYRES_stacks", "tyres", cast_shadows=True)
    n += top.flush(parts, "TYRES_tops", "tyres", smooth=False, cast_shadows=False)
    n += hole.flush(parts, "TYRES_holes", "tyredark", smooth=False, cast_shadows=False)
    return dict(tyre_wall_stacks=count, tyre_wall_triangles=int(n))


def build_pylon(tr: Track, parts: Parts, e: float, n: float, h: float, yaw: float = 0.3) -> None:
    """A lattice power pylon: a square tower that narrows to the top, and three pairs of cross-arms."""
    en = np.array([[e, n]])
    x, z = tr.fr.xz(en)[0]
    y0 = float(tr.H.ground(en)[0]) - tr.fr.ref - 0.2
    ax = np.array([np.cos(yaw), np.sin(yaw)])
    ay = np.array([-ax[1], ax[0]])
    levels = np.array([0.0, 0.16, 0.31, 0.45, 0.58, 0.69, 0.78, 0.86, 0.94, 1.0]) * h
    half = np.where(levels < 0.81 * h, 3.2 - 2.6 * levels / (0.81 * h), 0.6)
    for j in range(len(levels) - 1):                                 # four faces per storey, each with its own X
        for s, (a, b) in enumerate(((ax, ay), (ay, -ax), (-ax, -ay), (-ay, ax))):
            p = []
            for hh, yy in ((half[j], levels[j]), (half[j + 1], levels[j + 1])):
                c0, c1 = a * hh - b * hh, a * hh + b * hh
                p.append(((x + c0[0], y0 + yy, z + c0[1]), (x + c1[0], y0 + yy, z + c1[1])))
            quad = [p[0][0], p[0][1], p[1][1], p[1][0]]
            v0, v1 = (0.0, 0.5) if levels[j] < 0.81 * h else (0.5, 1.0)      # the top carries the red and white marking
            parts.quad("1WALL_pylons", "lattice", quad, (0.0, v0, 1.0, v1), hint=(a[0], 0.0, a[1]), smooth=False, double_sided=True)
    for frac, reach in ((0.61, 6.5), (0.75, 7.6), (0.89, 5.2)):      # cross-arms: two upright lattice faces meeting at the tip
        yy, hh = y0 + frac * h, float(np.interp(frac * h, levels, half))
        for sgn in (-1.0, 1.0):
            tip = np.array([x, z]) + ax * sgn * reach
            for side in (-1.0, 1.0):
                root = np.array([x, z]) + ax * sgn * hh + ay * side * hh
                quad = [(root[0], yy, root[1]), (tip[0], yy, tip[1]), (tip[0], yy + 0.25, tip[1]), (root[0], yy + 2.2, root[1])]
                parts.quad("1WALL_pylons", "lattice", quad, (0.0, 0.0, 2.0, 0.5), hint=(ay[0] * side, 0.0, ay[1] * side), smooth=False, double_sided=True)
            parts.quad("1WALL_pylons", "metal", [(tip[0] - 0.06, yy - 1.4, tip[1]), (tip[0] + 0.06, yy - 1.4, tip[1]), (tip[0] + 0.06, yy, tip[1]), (tip[0] - 0.06, yy, tip[1])],
                       (0, 0, 1, 1), hint=(ay[0], 0.0, ay[1]), smooth=False, double_sided=True)      # insulator string
