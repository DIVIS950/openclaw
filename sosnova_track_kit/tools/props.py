"""Objects standing on the ground: buildings, pit wall, tyre barriers and trees, placed from the survey."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely import contains_xy
from shapely.geometry import Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, META_FAR, SRC, WORK, site_uv  # noqa: E402
from track import Parts, Track  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
UP = np.array([0.0, 1.0, 0.0])
WALL_MATERIAL = {"garage": "garage", "building": "building", "hall": "hall", "hut": "hut"}


def box(parts: Parts, group: str, material: str, corners_xz: np.ndarray, y0: float, y1: float, uv_scale=(8.0, 4.0),
        top_material: str | None = None, top_uv: np.ndarray | float = 6.0, **kw) -> None:
    """Extruded footprint (convex, any winding) with walls and a flat top."""
    c = np.asarray(corners_xz, float)
    centre = c.mean(0)
    perim = 0.0
    for a, b in zip(c, np.roll(c, -1, axis=0)):
        ln = float(np.linalg.norm(b - a))
        p = np.array([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])])
        mid = (a + b) / 2 - centre
        reps = max(1.0, round(ln / uv_scale[0]))                      # whole tiles per wall so doors are not cut
        parts.quad(group, material, p, (perim, 0.0, perim + reps, (y1 - y0) / uv_scale[1]),
                   hint=(mid[0], 0.0, mid[1]), smooth=False, **kw)
        perim += reps
    top = np.array([(p[0], y1, p[1]) for p in c])
    tris = [(0, k, k + 1) for k in range(1, len(c) - 1)]
    uv = c / top_uv if np.isscalar(top_uv) else np.asarray(top_uv, float)
    parts.surface(group, top_material or material, top, uv, tris, hint=UP, smooth=False, **kw)


def build_buildings(tr: Track, parts: Parts) -> list[Polygon]:
    """Walls by type; every roof shows its own piece of the aerial photo."""
    foot = []
    blds = json.load(open(os.path.join(SRC, "buildings.json"), encoding="utf-8"))
    for k, b in enumerate(blds):
        en = np.array(b["en"])
        base = float(tr.H.ground(en).min()) - tr.fr.ref
        wall_h = min(b["height"], 4.0) if b["style"] == "garage" else 4.0
        box(parts, f"1WALL_bld{k:02d}", WALL_MATERIAL[b["style"]], tr.fr.xz(en), base - 0.5, base + b["height"],
            uv_scale=(8.0, wall_h if b["height"] < 5.0 else b["height"] / max(1, round(b["height"] / 4.0))),
            top_material="roofphoto", top_uv=site_uv(en))
        foot.append(Polygon(en))
    return foot


def build_pit_wall(tr: Track, parts: Parts) -> None:
    """Low concrete wall between the start straight and the pit buildings (measured on the photo: x = -7.7 m)."""
    z = np.arange(-6.0, 111.0, 3.0)
    y = tr.h(z, np.full_like(z, -7.7)) - tr.fr.ref
    for a in range(len(z) - 1):
        c = np.array([(-7.85, z[a]), (-7.55, z[a]), (-7.55, z[a + 1]), (-7.85, z[a + 1])])
        box(parts, "1WALL_pitwall", "concrete", c, min(y[a], y[a + 1]) - 0.3, max(y[a], y[a + 1]) + 1.05, uv_scale=(3.0, 3.0), top_uv=3.0)


def build_tyre_walls(tr: Track, parts: Parts, keep_clear, asphalt) -> dict:
    """Tyre barriers traced from the photo (work/tyre_walls.json; hand-made additions in source/features.json)."""
    lines = []
    for path in (os.path.join(WORK, "tyre_walls.json"), os.path.join(SRC, "features.json")):
        if os.path.exists(path):
            lines += json.load(open(path, encoding="utf-8")).get("tyre_walls", [])
    venue = keep_clear.buffer(35.0)                                   # the circuit itself, not the yards and woods around it
    count, length = 0, 0.0
    for k, line in enumerate(lines):
        p = np.array(line["en"], float)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m = max(2, int(round(s[-1] / 0.65)) + 1)
        q = np.column_stack([np.interp(np.linspace(0, s[-1], m), s, p[:, 0]), np.interp(np.linspace(0, s[-1], m), s, p[:, 1])])
        if contains_xy(keep_clear, q[:, 0], q[:, 1]).any() or contains_xy(asphalt, q[:, 0], q[:, 1]).mean() > 0.25 \
                or not contains_xy(venue, q[:, 0], q[:, 1]).all():
            continue                                                  # never put a wall on the racing surface or across a road
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]])
        half, h = line.get("width", 0.7) / 2, line.get("height", 0.9)
        g = tr.H.ground(q)
        u = np.linspace(0, s[-1], m) / 2.6
        name = f"1WALL_tyres{k // 8:02d}"
        left, right = q + nrm * half, q - nrm * half
        faces = ((left, g - 0.2, left, g + h, nrm, 0.0, 1.0), (left, g + h, right, g + h, None, 0.86, 1.0), (right, g + h, right, g - 0.2, -nrm, 1.0, 0.0))
        for a_en, a_h, b_en, b_h, out, va, vb in faces:
            pos = np.vstack([tr.fr.world(a_en, a_h), tr.fr.world(b_en, b_h)])
            uv = np.vstack([np.column_stack([u, np.full(m, va)]), np.column_stack([u, np.full(m, vb)])])
            r = np.arange(m - 1)
            tris = np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)])
            if out is None:
                hint = UP
            else:
                o = tr.fr.vec(out)
                o3 = np.column_stack([o[:, 0], np.zeros(m), o[:, 1]])
                hint = np.vstack([o3[:-1], o3[:-1]])
            parts.surface(name, "tyrewall", pos, uv, tris, hint=hint, smooth=False)
        for e in (0, -1):                                             # close the ends
            a, b = tr.fr.world(left[e][None], g[e] - 0.2)[0], tr.fr.world(right[e][None], g[e] - 0.2)[0]
            dd = tr.fr.vec(d[e][None])[0] * (-1 if e == 0 else 1)
            parts.quad(name, "tyrewall", [a, b, b + UP * (h + 0.2), a + UP * (h + 0.2)], (0, 0, 0.27, 1), hint=(dd[0], 0.0, dd[1]), smooth=False)
        count, length = count + 1, length + float(s[-1])
    return dict(walls=count, metres=round(length))


def _billboards(parts: Parts, group: str, pos: np.ndarray, height: np.ndarray, width: np.ndarray, kind: np.ndarray, rng) -> None:
    """Two crossed, double-sided quads per tree; normals point up so both sides are lit alike."""
    m = len(pos)
    if m == 0:
        return
    yaw = rng.uniform(0, np.pi, m)
    P, U, T = [], [], []
    for cross in (0.0, np.pi / 2):
        dx, dz = np.cos(yaw + cross) * width * 0.5, np.sin(yaw + cross) * width * 0.5
        a = pos + np.column_stack([-dx, np.full(m, -0.3), -dz])
        b = pos + np.column_stack([dx, np.full(m, -0.3), dz])
        quad = np.stack([a, b, b + UP * height[:, None], a + UP * height[:, None]], 1)
        u0 = np.where(kind == 0, 0.0, 0.5) + 0.004
        uv = np.stack([np.column_stack([u0, np.full(m, 0.004)]), np.column_stack([u0 + 0.492, np.full(m, 0.004)]),
                       np.column_stack([u0 + 0.492, np.full(m, 0.996)]), np.column_stack([u0, np.full(m, 0.996)])], 1)
        base = len(P) * 4 * m + np.arange(m)[:, None] * 4
        P.append(quad.reshape(-1, 3)), U.append(uv.reshape(-1, 2))
        T.append(np.concatenate([base + [0, 1, 2], base + [0, 2, 3], base + [2, 1, 0], base + [3, 2, 0]]))
    P, U, T = np.vstack(P), np.vstack(U), np.vstack(T)
    cen = P[T].mean(1)
    order = np.lexsort((np.floor(cen[:, 2] / 120), np.floor(cen[:, 0] / 120)))
    parts.add(group, "tree", P, np.tile(UP, (len(P), 1)), U, T[order], cast_shadows=True)


def build_trees(tr: Track, parts: Parts, keep_out) -> dict:
    """Trees where the surface model shows canopy, at the height it measured. keep_out: shapely geometry in EN."""
    rng = np.random.default_rng(5)
    canopy = np.load(os.path.join(WORK, "survey.npz"))["canopy"]
    top = ndi.maximum_filter(canopy, size=17)                         # tallest canopy within 2 m
    step = 5.0
    gx, gy = np.meshgrid(np.arange(-HALF_E + 3, HALF_E - 3, step), np.arange(-HALF_N + 3, HALF_N - 3, step))
    g = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.4, 0.4, (gx.size, 2)) * step
    px = np.clip(((g[:, 0] + HALF_E) / 0.25).astype(int), 0, canopy.shape[1] - 1)
    py = np.clip(((HALF_N - g[:, 1]) / 0.25).astype(int), 0, canopy.shape[0] - 1)
    ok = (canopy[py, px] > 3.0) & ~contains_xy(keep_out, g[:, 0], g[:, 1])
    g, h = g[ok], np.clip(top[py, px][ok] * rng.uniform(0.95, 1.08, ok.sum()), 4.0, 30.0)
    w = np.clip(h * 0.62, 3.5, 12.0)
    pos = tr.fr.world(g, tr.H.ground(g))
    _billboards(parts, "TREES_near", pos, h, w, (rng.random(len(g)) < 0.35).astype(int), rng)
    # forests around the site, from the wide photo (1 m/px)
    far = np.asarray(Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB"), np.float32) / 255.0
    far = ndi.uniform_filter(far, size=(3, 3, 1))
    r_, g_, b_ = far[..., 0], far[..., 1], far[..., 2]
    fmask = (g_ > b_ + 0.015) & (g_ >= r_ - 0.02) & (far.mean(-1) < 0.42)
    fmask = ndi.binary_opening(fmask, iterations=3)
    fdepth = ndi.distance_transform_edt(fmask)
    fe, fn = META_FAR["half_m"]
    step = 13.0
    gx, gy = np.meshgrid(np.arange(-fe + 20, fe - 20, step), np.arange(-fn + 20, fn - 20, step))
    f = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.4, 0.4, (gx.size, 2)) * step
    f = f[((np.abs(f[:, 0]) > HALF_E - 3) | (np.abs(f[:, 1]) > HALF_N - 3)) & (np.hypot(f[:, 0], f[:, 1]) < 760)]
    px = np.clip((f[:, 0] + fe).astype(int), 0, fmask.shape[1] - 1)
    py = np.clip((fn - f[:, 1]).astype(int), 0, fmask.shape[0] - 1)
    f = f[fdepth[py, px] > 3.0]
    fh = rng.uniform(17, 25, len(f))
    fpos = tr.fr.world(f, tr.H.far_ground(f))
    _billboards(parts, "TREES_far", fpos, fh, fh * 0.6, (rng.random(len(f)) < 0.3).astype(int), rng)
    return dict(near=len(g), far=len(f))
