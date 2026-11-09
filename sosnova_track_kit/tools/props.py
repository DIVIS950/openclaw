"""Scenery objects: trees, buildings, pit wall, tyre stacks on the slalom points, start gantry, boards."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely import contains_xy
from shapely.geometry import Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, META_FAR, SRC, WORK  # noqa: E402
from textures import SIGN_UV  # noqa: E402
from track import Parts, Track, cyclic_runs, speed_profile  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
UP = np.array([0.0, 1.0, 0.0])


def box(parts: Parts, group: str, material: str, corners_xz: np.ndarray, y0: float, y1: float, uv_scale=(8.0, 4.0),
        top_material: str | None = None, top_uv: float = 6.0, **kw) -> None:
    """Extruded footprint (convex, any winding) with walls and a flat top."""
    c = np.asarray(corners_xz, float)
    centre = c.mean(0)
    perim = 0.0
    for a, b in zip(c, np.roll(c, -1, axis=0)):
        ln = float(np.linalg.norm(b - a))
        p = np.array([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])])
        mid = (a + b) / 2 - centre
        parts.quad(group, material, p, (perim / uv_scale[0], 0.0, (perim + ln) / uv_scale[0], (y1 - y0) / uv_scale[1]),
                   hint=(mid[0], 0.0, mid[1]), smooth=False, **kw)
        perim += ln
    top = np.array([(p[0], y1, p[1]) for p in c])
    tris = [(0, k, k + 1) for k in range(1, len(c) - 1)]
    parts.surface(group, top_material or material, top, c / top_uv, tris, hint=UP, smooth=False, **kw)


def build_buildings(tr: Track, parts: Parts) -> list[Polygon]:
    foot = []
    blds = json.load(open(os.path.join(SRC, "buildings.json"), encoding="utf-8"))
    for k, b in enumerate(blds):
        en = np.array(b["en"])
        base = float(tr.H.ground(en).min()) - tr.fr.ref
        box(parts, f"1WALL_bld{k:02d}", "building", tr.fr.xz(en), base - 0.5, base + b["height"],
            top_material="roofwhite" if b["roof"] == "white" else "roof")
        foot.append(Polygon(en))
    return foot


def build_pit_wall(tr: Track, parts: Parts) -> None:
    """Low concrete wall between the start straight and the pit buildings (measured on the photo: x = -7.7 m)."""
    z = np.arange(-6.0, 111.0, 3.0)
    y = tr.h(z, np.full_like(z, -7.7)) - tr.fr.ref
    for a in range(len(z) - 1):
        c = np.array([(-7.85, z[a]), (-7.55, z[a]), (-7.55, z[a + 1]), (-7.85, z[a + 1])])
        box(parts, "1WALL_pitwall", "concrete", c, min(y[a], y[a + 1]) - 0.3, max(y[a], y[a + 1]) + 1.05, uv_scale=(3.0, 3.0), top_uv=3.0)


def build_tyres(tr: Track, parts: Parts) -> None:
    """One stack of tyres on every slalom point of the event layout."""
    sides = 12
    ang = np.arange(sides + 1) / sides * 2 * np.pi
    r, h = 0.36, 0.84
    for k, en in enumerate(tr.cones_en):
        x, z = tr.fr.xz(en[None, :])[0]
        y = float(tr.H.ground(en[None, :])[0]) - tr.fr.ref
        ring = np.column_stack([x + r * np.cos(ang), np.zeros(sides + 1), z + r * np.sin(ang)])
        lo, hi = ring + [0, y - 0.1, 0], ring + [0, y + h, 0]
        pos = np.vstack([lo, hi])
        u = np.arange(sides + 1) / sides * 0.85 * 3 % 0.85
        u = np.linspace(0, 0.85, sides + 1)
        uv = np.vstack([np.column_stack([u, np.zeros(sides + 1)]), np.column_stack([u, np.ones(sides + 1)])])
        i = np.arange(sides)
        tris = np.concatenate([np.stack([i, i + 1, i + sides + 2], -1), np.stack([i, i + sides + 2, i + sides + 1], -1)])
        hint = pos[tris].mean(1) - [x, 0, z]
        hint[:, 1] = 0
        name = f"1WALL_tyres{k // 12}"
        parts.surface(name, "tyre", pos, uv, tris, hint=hint)
        top = np.vstack([[x, y + h, z], hi[:-1]])
        parts.surface(name, "tyre", top, np.full((sides + 1, 2), 0.94), [(0, 1 + j, 1 + (j + 1) % sides) for j in range(sides)], hint=UP, smooth=False)


def board(parts: Parts, group: str, centre: np.ndarray, facing: np.ndarray, width: float, y0: float, y1: float, cell: str,
          flip_u: bool = False) -> None:
    """Sign board facing `facing` (horizontal vector); back side is plain dark. Two legs down to the ground."""
    f = np.array([facing[0], 0.0, facing[2]])
    f /= np.linalg.norm(f)
    right = np.cross(f, UP)          # the viewer's right-hand side when looking at the front of the board
    right = -right
    a, b = centre - right * width / 2, centre + right * width / 2
    p = np.array([a + UP * y0, b + UP * y0, b + UP * y1, a + UP * y1])
    u0, v0, u1, v1 = SIGN_UV[cell]
    if flip_u:
        u0, u1 = u1, u0
    parts.quad(group, "signs", p + f * 0.02, (u0, v0, u1, v1), hint=f, smooth=False)
    parts.quad(group, "signs", p[[1, 0, 3, 2]] - f * 0.02, SIGN_UV["dark"], hint=-f, smooth=False)
    for q in (a + right * 0.12, b - right * 0.12):
        c = np.array([(q[0] - 0.04, q[2] - 0.04), (q[0] + 0.04, q[2] - 0.04), (q[0] + 0.04, q[2] + 0.04), (q[0] - 0.04, q[2] + 0.04)])
        box(parts, group, "metal", c, centre[1] - 0.4, centre[1] + y0)


def build_gantry(tr: Track, parts: Parts) -> None:
    wl, wr = float(tr.wl[0]), float(tr.wr[0])
    xl, xr = wl + 1.0, -(wr + 1.0)
    y = lambda x: float(tr.h(0.0, x)) - tr.fr.ref  # noqa: E731
    for x in (xl, xr):
        c = np.array([(x - 0.15, -0.15), (x + 0.15, -0.15), (x + 0.15, 0.15), (x - 0.15, 0.15)])
        box(parts, "1WALL_gantry", "metal", c, y(x) - 0.4, 6.4)
    beam = np.array([(xr, -0.12), (xl, -0.12), (xl, 0.12), (xr, 0.12)])
    box(parts, "GANTRY_beam", "metal", beam, 5.1, 6.4)
    u0, v0, u1, v1 = SIGN_UV["banner"]
    # banner faces the cars coming down the straight (they look along +Z, so the banner faces -Z)
    p = np.array([(xl - 0.3, 5.2, -0.14), (xr + 0.3, 5.2, -0.14), (xr + 0.3, 6.3, -0.14), (xl - 0.3, 6.3, -0.14)])
    parts.quad("GANTRY_banner", "signs", p, (u0, v0, u1, v1), hint=(0, 0, -1), smooth=False)
    q = p[[1, 0, 3, 2]] + [0, 0, 0.28]
    parts.quad("GANTRY_banner", "signs", q, (u0, v0, u1, v1), hint=(0, 0, 1), smooth=False)


def build_boards(tr: Track, parts: Parts) -> dict:
    """Chevrons on the outside of tight corners and 100 / 50 m boards before the big braking zones."""
    n = tr.n
    stats = dict(chevrons=0, brake=0)

    def place(st: float, side: int, off: float):
        w = (tr.wl if side > 0 else tr.wr)[int(st) % n]
        return tr.world(st, side * (w + off))[0], tr.fr.vec(tr.tan[int(st) % n][None, :])[0]

    for a, ln in cyclic_runs(np.abs(tr.k) > 1.0 / 26.0, 6, 5):
        turn = int(np.sign(tr.k[(a + ln // 2) % n]))
        side = -turn
        for st in np.linspace(a + ln * 0.25, a + ln * 0.75, 3 if ln > 25 else 2):
            pos, t = place(st - 0.0, side, 2.3)
            t_in = tr.fr.vec(tr.tan[int(st - min(ln * 0.5, 14)) % n][None, :])[0]
            board(parts, "SIGN_chevron", pos, np.array([-t_in[0], 0.0, -t_in[1]]), 1.8, 1.05, 1.65, "chevron", flip_u=turn < 0)
            stats["chevrons"] += 1
    v = speed_profile(tr.k)
    brk = np.roll(v, -1) < v - 0.05
    for a, ln in cyclic_runs(brk, 25, 3):
        end = a + ln
        if v[a % n] - v[end % n] < 11.0:
            continue
        turn = int(np.sign(tr.k[(end + 8) % n])) or 1
        for dist, cell in ((100, "b100"), (50, "b50")):
            if dist > ln + 45:
                continue
            st = end - dist
            here = tr.k[int(st) % n]
            side = -int(np.sign(here)) if abs(here) > 1.0 / 80.0 else -turn    # never on the inside of a bend
            pos, t = place(st, side, 2.0)
            board(parts, "SIGN_brake", pos, np.array([-t[0], 0.0, -t[1]]), 0.8, 1.05, 1.85, cell)
            stats["brake"] += 1
    return stats


def _billboards(parts: Parts, group: str, pos: np.ndarray, height: np.ndarray, kind: np.ndarray, rng) -> None:
    """Two crossed, double-sided quads per tree; normals point up so both sides are lit alike."""
    m = len(pos)
    yaw = rng.uniform(0, np.pi, m)
    P, U, T = [], [], []
    for cross in (0.0, np.pi / 2):
        dx, dz = np.cos(yaw + cross) * height * 0.5, np.sin(yaw + cross) * height * 0.5
        a = pos + np.column_stack([-dx, np.full(m, -0.3), -dz])
        b = pos + np.column_stack([dx, np.full(m, -0.3), dz])
        quad = np.stack([a, b, b + UP * height[:, None], a + UP * height[:, None]], 1)       # (m, 4, 3)
        u0 = np.where(kind == 0, 0.0, 0.5) + 0.004
        uv = np.stack([np.column_stack([u0, np.full(m, 0.004)]), np.column_stack([u0 + 0.492, np.full(m, 0.004)]),
                       np.column_stack([u0 + 0.492, np.full(m, 0.996)]), np.column_stack([u0, np.full(m, 0.996)])], 1)
        base = len(P) * 4 * m + np.arange(m)[:, None] * 4
        P.append(quad.reshape(-1, 3)), U.append(uv.reshape(-1, 2))
        T.append(np.concatenate([base + [0, 1, 2], base + [0, 2, 3], base + [2, 1, 0], base + [3, 2, 0]]))
    P, U, T = np.vstack(P), np.vstack(U), np.vstack(T)
    # sort triangles by tile so the splitter makes spatially compact meshes
    cen = P[T].mean(1)
    order = np.lexsort((np.floor(cen[:, 2] / 120), np.floor(cen[:, 0] / 120)))
    parts.add(group, "tree", P, np.tile(UP, (len(P), 1)), U, T[order], cast_shadows=True)


def build_trees(tr: Track, parts: Parts, keep_out) -> dict:
    """Trees where the orthophoto shows tree canopy. keep_out: shapely geometry (asphalt, buildings) in EN."""
    rng = np.random.default_rng(5)
    cls = np.load(os.path.join(WORK, "classes.npz"))
    tree = cls["tree"]
    depth = ndi.distance_transform_edt(tree) * 0.25
    step = 5.0
    gx, gy = np.meshgrid(np.arange(-HALF_E + 3, HALF_E - 3, step), np.arange(-HALF_N + 3, HALF_N - 3, step))
    g = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.4, 0.4, (gx.size, 2)) * step
    px = np.clip(((g[:, 0] + HALF_E) / 0.25).astype(int), 0, tree.shape[1] - 1)
    py = np.clip(((HALF_N - g[:, 1]) / 0.25).astype(int), 0, tree.shape[0] - 1)
    ok = depth[py, px] > 0.8
    ok &= ~contains_xy(keep_out, g[:, 0], g[:, 1])
    g, d = g[ok], depth[py, px][ok]
    h = np.clip(8.0 + 0.8 * d, 8, 14) + rng.uniform(0, 6, len(g))
    pos = tr.fr.world(g, tr.H.ground(g))
    _billboards(parts, "TREES_near", pos, h, (rng.random(len(g)) < 0.4).astype(int), rng)
    # forests around the site, from the wide photo (1 m/px)
    far = np.asarray(Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB"), np.float32) / 255.0
    far = ndi.uniform_filter(far, size=(3, 3, 1))
    r_, g_, b_ = far[..., 0], far[..., 1], far[..., 2]
    fmask = (g_ > r_ + 0.01) & (g_ > b_ + 0.04) & (far.mean(-1) < 0.42)
    fmask = ndi.binary_opening(fmask, iterations=2)
    fdepth = ndi.distance_transform_edt(fmask)
    fe, fn = META_FAR["half_m"]
    step = 15.0
    gx, gy = np.meshgrid(np.arange(-fe + 20, fe - 20, step), np.arange(-fn + 20, fn - 20, step))
    f = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.4, 0.4, (gx.size, 2)) * step
    f = f[((np.abs(f[:, 0]) > HALF_E - 3) | (np.abs(f[:, 1]) > HALF_N - 3)) & (np.hypot(f[:, 0], f[:, 1]) < 800)]
    px = np.clip((f[:, 0] + fe).astype(int), 0, fmask.shape[1] - 1)
    py = np.clip((fn - f[:, 1]).astype(int), 0, fmask.shape[0] - 1)
    f = f[fdepth[py, px] > 2.0]
    fh = rng.uniform(15, 23, len(f))
    fpos = tr.fr.world(f, tr.H.far_ground(f))
    _billboards(parts, "TREES_far", fpos, fh, (rng.random(len(f)) < 0.3).astype(int), rng)
    return dict(near=len(g), far=len(f))
