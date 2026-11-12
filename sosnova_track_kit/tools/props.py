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
from shapely.ops import unary_union

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


def pit_wall_line(tr: Track) -> np.ndarray:
    """The low concrete wall between the start straight and the pit buildings: 1.1 m outside the real asphalt edge
    (east/north points)."""
    from scipy.ndimage import gaussian_filter1d
    st = np.arange(-6, 112, 2)
    w = gaussian_filter1d(np.tile(tr.wr, 3), 6.0)[tr.n + st]
    return tr.en(st.astype(float), -(w + 1.1))


def build_tyre_walls(tr: Track, parts: Parts, keep_clear, asphalt, lines: list | None = None, min_len: float = 6.0, anywhere: bool = False) -> dict:
    """Tyre barriers traced from the photo (work/tyre_walls.json; hand-made additions in source/features.json)."""
    given = lines
    lines = list(given) if given is not None else []
    for path in (() if given is not None else (os.path.join(WORK, "tyre_walls.json"), os.path.join(SRC, "features.json"))):
        if os.path.exists(path):
            lines += json.load(open(path, encoding="utf-8")).get("tyre_walls", [])
    venue = keep_clear.buffer(35.0)                                   # the circuit itself, not the yards and woods around it
    off = unary_union([keep_clear, asphalt.buffer(0.8)])
    pieces = []
    for line in lines:                                                # never a wall on the racing surface or across a road
        p = np.array(line["en"], float)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m = max(2, int(round(s[-1] / 0.65)) + 1)
        q = np.column_stack([np.interp(np.linspace(0, s[-1], m), s, p[:, 0]), np.interp(np.linspace(0, s[-1], m), s, p[:, 1])])
        ok = np.ones(len(q), bool) if anywhere else ~contains_xy(off, q[:, 0], q[:, 1]) & contains_xy(venue, q[:, 0], q[:, 1])
        dd = np.diff(np.concatenate([[0], ok.astype(int), [0]]))
        for a0, a1 in zip(np.where(dd == 1)[0], np.where(dd == -1)[0]):
            if (a1 - a0) * 0.65 >= min_len:
                pieces.append((line, q[a0:a1]))
    count, length = 0, 0.0
    for k, (line, q) in enumerate(pieces):
        m = len(q)
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))])
        mat = line.get("material", "softwall")
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]])
        half, h = line.get("width", 0.7) / 2, line.get("height", 0.9)
        g = tr.H.ground(q)
        u = np.linspace(0, s[-1], m) / 4.0
        name = f"1WALL_barrier{k // 8:02d}" if mat == "softwall" else f"1WALL_wall{k // 8:02d}"
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
            parts.surface(name, mat, pos, uv, tris, hint=hint, smooth=False)
        for e in (0, -1):                                             # close the ends
            a, b = tr.fr.world(left[e][None], g[e] - 0.2)[0], tr.fr.world(right[e][None], g[e] - 0.2)[0]
            dd = tr.fr.vec(d[e][None])[0] * (-1 if e == 0 else 1)
            parts.quad(name, mat, [a, b, b + UP * (h + 0.2), a + UP * (h + 0.2)], (0.02, 0, 0.2, 1), hint=(dd[0], 0.0, dd[1]), smooth=False)
        count, length = count + 1, length + float(s[-1])
    return dict(walls=count, metres=round(length))


def _billboards(parts: Parts, group: str, material: str, cells: list[dict], pos: np.ndarray, height: np.ndarray, rng) -> None:
    """Two crossed, double-sided pictures of a real tree per tree; normals point up so both sides are lit alike."""
    m = len(pos)
    if m == 0:
        return
    pick = rng.integers(0, len(cells), m)
    u0 = np.array([c["u0"] for c in cells])[pick] + 0.003
    u1 = np.array([c["u1"] for c in cells])[pick] - 0.003
    width = height * np.array([c["aspect"] for c in cells])[pick]
    yaw = rng.uniform(0, np.pi, m)
    P, U, T = [], [], []
    for k, cross in enumerate((0.0, np.pi / 2)):
        dx, dz = np.cos(yaw + cross) * width * 0.5, np.sin(yaw + cross) * width * 0.5
        a = pos + np.column_stack([-dx, np.full(m, -0.25), -dz])
        b = pos + np.column_stack([dx, np.full(m, -0.25), dz])
        quad = np.stack([a, b, b + UP * height[:, None], a + UP * height[:, None]], 1)
        ua, ub = (u0, u1) if k == 0 else (u1, u0)                    # the second picture is mirrored
        uv = np.stack([np.column_stack([ua, np.full(m, 0.004)]), np.column_stack([ub, np.full(m, 0.004)]),
                       np.column_stack([ub, np.full(m, 0.996)]), np.column_stack([ua, np.full(m, 0.996)])], 1)
        base = len(P) * 4 * m + np.arange(m)[:, None] * 4
        P.append(quad.reshape(-1, 3)), U.append(uv.reshape(-1, 2))
        T.append(np.concatenate([base + [0, 1, 2], base + [0, 2, 3], base + [2, 1, 0], base + [3, 2, 0]]))
    P, U, T = np.vstack(P), np.vstack(U), np.vstack(T)
    cen = P[T].mean(1)
    order = np.lexsort((np.floor(cen[:, 2] / 120), np.floor(cen[:, 0] / 120)))
    parts.add(group, material, P, np.tile(UP, (len(P), 1)), U, T[order], cast_shadows=True)


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
    cells = json.load(open(os.path.join(SRC, "assets", "trees.json"), encoding="utf-8"))
    pos = tr.fr.world(g, tr.H.ground(g))
    low = h < 9.0                                                     # low canopy is broadleaf scrub, the rest conifers
    _billboards(parts, "TREES_conifer", "treeconifer", cells["conifer"], pos[~low], h[~low], rng)
    _billboards(parts, "TREES_leaf", "treeleaf", cells["leaf"], pos[low], h[low], rng)
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
    _billboards(parts, "TREES_far", "treeconifer", cells["conifer"], fpos, fh, rng)
    return dict(near=len(g), far=len(f))


# power pylons standing in the infield north of the bridge, read from the photo: (east, north, height m)
PYLONS = [(-17.0, 108.0, 31.0), (-16.0, 127.0, 32.0), (-16.0, 147.0, 32.0)]


def build_pylons(tr: Track, parts: Parts) -> int:
    for k, (e, n, h) in enumerate(PYLONS):
        en = np.array([[e, n]])
        base = tr.fr.world(en, tr.H.ground(en))[0]
        for ang in (0.0, np.pi / 2):
            d = np.array([np.cos(ang + 0.3), 0.0, np.sin(ang + 0.3)]) * h / 4.0      # the texture cell is half as wide as tall
            p = [base - d - UP * 0.2, base + d - UP * 0.2, base + d + UP * h, base - d + UP * h]
            parts.quad("1WALL_pylons", "pylon", p, (0.0, 0.0, 1.0, 1.0), hint=np.cross(d, UP), smooth=False, double_sided=True)
    return len(PYLONS)


GANTRY_AT = 20.0      # metres after the start line, so every car on the grid sees the lights


def build_gantry(tr: Track, parts: Parts) -> None:
    """Start lights on a gantry over the road, facing the grid."""
    st = GANTRY_AT
    wl, wr = float(tr.interp(tr.wl, np.array([st]))[0]), float(tr.interp(tr.wr, np.array([st]))[0])
    left, right = tr.world(st, wl + 1.0)[0], tr.world(st, -(wr + 1.0))[0]
    road = tr.world(st, 0.0)[0]
    for p in (left, right):
        c = np.array([(p[0] - 0.12, p[2] - 0.12), (p[0] + 0.12, p[2] - 0.12), (p[0] + 0.12, p[2] + 0.12), (p[0] - 0.12, p[2] + 0.12)])
        box(parts, "1WALL_gantry", "metal", c, p[1] - 0.4, road[1] + 6.1, uv_scale=(2.0, 2.0), top_uv=2.0)
    beam = np.array([(right[0], right[2] - 0.15), (left[0], left[2] - 0.15), (left[0], left[2] + 0.15), (right[0], right[2] + 0.15)])
    box(parts, "GANTRY_beam", "metal", beam, road[1] + 5.6, road[1] + 6.1, uv_scale=(2.0, 2.0), top_uv=2.0)
    cx = (left[0] + right[0]) / 2
    z = road[2] - 0.2
    p = [(cx + 2.4, road[1] + 4.4, z), (cx - 2.4, road[1] + 4.4, z), (cx - 2.4, road[1] + 5.6, z), (cx + 2.4, road[1] + 5.6, z)]    # seen from the grid
    parts.quad("GANTRY_lights", "lights", p, (0.0, 0.0, 1.0, 1.0), hint=(0, 0, -1), smooth=False)
    back = [(q[0], q[1], q[2] + 0.1) for q in (p[1], p[0], p[3], p[2])]
    parts.quad("GANTRY_lights", "metal", back, (0, 0, 1, 1), hint=(0, 0, 1), smooth=False)


def build_brake_boards(tr: Track, parts: Parts) -> int:
    """150 / 100 / 50 m boards before the hard braking zones, on the side that has a verge."""
    from track import cyclic_runs, speed_profile
    n = tr.n
    v = speed_profile(tr.k)
    count = 0
    for a, ln in cyclic_runs(np.roll(v, -1) < v - 0.05, 25, 3):
        end = a + ln
        if v[a % n] - v[end % n] < 11.0:
            continue
        for dist, cell in ((150, 0), (100, 1), (50, 2)):
            if dist > ln + 60:
                continue
            st = end - dist
            i = int(st) % n
            side = -1 if not tr.open_r[i] else (1 if not tr.open_l[i] else 0)
            if side == 0:
                continue
            w = (tr.wl if side > 0 else tr.wr)[i]
            base = tr.world(float(st), side * (w + 2.2))[0]
            t = tr.fr.vec(tr.tan[i][None, :])[0]
            f = np.array([-t[0], 0.0, -t[1]])                                    # faces the cars
            right = -np.cross(f, UP)
            a_, b_ = base - right * 0.45, base + right * 0.45
            p = np.array([a_ + UP * 0.9, b_ + UP * 0.9, b_ + UP * 1.8, a_ + UP * 1.8])
            parts.quad("SIGN_brake", "boards", p + f * 0.02, (cell / 3 + 0.004, 0.0, (cell + 1) / 3 - 0.004, 1.0), hint=f, smooth=False)
            parts.quad("SIGN_brake", "metal", p[[1, 0, 3, 2]] - f * 0.02, (0, 0, 1, 1), hint=-f, smooth=False)
            for q in (a_ + right * 0.1, b_ - right * 0.1):
                c = np.array([(q[0] - 0.03, q[2] - 0.03), (q[0] + 0.03, q[2] - 0.03), (q[0] + 0.03, q[2] + 0.03), (q[0] - 0.03, q[2] + 0.03)])
                box(parts, "SIGN_brake", "metal", c, base[1] - 0.3, base[1] + 0.9, uv_scale=(1.0, 1.0), top_uv=1.0)
            count += 1
    return count


def build_tyre_stacks(tr: Track, parts: Parts) -> dict:
    """Tyre stacks of the race layout: one at every yellow dot of the organiser's map (registered on the photo,
    tr.cones_en). Four tyres high, the top one painted yellow. They stand beside the lap and form the chicanes."""
    R_, H_, SEG = 0.34, 0.92, 10
    ang = np.linspace(0, 2 * np.pi, SEG + 1)
    ring = np.column_stack([np.cos(ang), np.sin(ang)])
    P, U, T, HN, TP, TU, TT, off, toff = [], [], [], [], [], [], [], 0, 0
    for c in tr.cones_en:
        g = float(tr.H.ground(np.array([c]))[0])
        en = c[None, :] + ring * R_
        lo, hi = tr.fr.world(en, np.full(SEG + 1, g - 0.15)), tr.fr.world(en, np.full(SEG + 1, g + H_))
        out = tr.fr.vec(ring)
        n3 = np.column_stack([out[:, 0], np.zeros(SEG + 1), out[:, 1]])
        P.append(np.vstack([lo, hi]))
        U.append(np.vstack([np.column_stack([ang / (2 * np.pi) * 3, np.zeros(SEG + 1)]), np.column_stack([ang / (2 * np.pi) * 3, np.ones(SEG + 1)])]))
        r = np.arange(SEG)
        mid = n3[r] + n3[r + 1]
        HN.append(np.vstack([mid, mid]))                           # one outward vector per side triangle
        T.append(np.concatenate([np.stack([r, r + SEG + 1, r + SEG + 2], -1), np.stack([r, r + SEG + 2, r + 1], -1)]) + off)
        off += 2 * (SEG + 1)
        top = np.vstack([hi[:SEG], tr.fr.world(c[None, :], np.array([g + H_]))])
        TP.append(top)
        TU.append(np.column_stack([np.full(SEG + 1, 0.5), np.full(SEG + 1, 0.95)]))
        TT.append(np.stack([np.full(SEG, SEG), r, (r + 1) % SEG], -1) + toff)
        toff += SEG + 1
    if P:
        parts.surface("1WALL_tyrestacks", "tyres", np.vstack(P), np.vstack(U), np.vstack(T), hint=np.vstack(HN), smooth=True)
        parts.surface("1WALL_tyrestacks", "tyres", np.vstack(TP), np.vstack(TU), np.vstack(TT), hint=UP, smooth=False)
    return dict(tyre_stacks=len(tr.cones_en))


def race_rows(tr: Track, max_gap: float = 8.5) -> list[np.ndarray]:
    """The yellow dots of the organiser's map grouped into rows: dots closer than max_gap belong to one row,
    ordered along it. Each row is one closure of the race layout."""
    c = tr.cones_en
    n = len(c)
    group = list(range(n))

    def find(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if np.linalg.norm(c[i] - c[j]) <= max_gap:
                group[find(i)] = find(j)
    rows = {}
    for i in range(n):
        rows.setdefault(find(i), []).append(i)
    out = []
    for ids in rows.values():
        p = c[ids]
        if len(p) > 1:
            axis = np.linalg.svd(p - p.mean(0))[2][0]
            p = p[np.argsort((p - p.mean(0)) @ axis)]
        out.append(p)
    return out


def race_barrier_lines(tr: Track) -> list[dict]:
    """Red and white plastic barriers that fill each row between its tyre barrels (east/north polylines)."""
    out = []
    for row in race_rows(tr):
        for a, b in zip(row[:-1], row[1:]):
            d = float(np.linalg.norm(b - a))
            if d < 2.2:
                continue
            u = (b - a) / d
            out.append(dict(en=[(a + u * 0.55).round(2).tolist(), (b - u * 0.55).round(2).tolist()], width=0.62, height=0.52, material="bags"))
    return out


def build_tape(tr: Track, parts: Parts) -> dict:
    """Red and white barrier tape strung from tyre barrel to tyre barrel along each row, above the barriers
    (visual only)."""
    P, U, T, HN, off, total = [], [], [], [], 0, 0.0
    for row in race_rows(tr):
        for a, b in zip(row[:-1], row[1:]):
            d = float(np.linalg.norm(b - a))
            en = np.array([a, b])
            g = tr.H.ground(en)
            pos = np.vstack([tr.fr.world(en, g + 0.80), tr.fr.world(en, g + 0.87)])
            P.append(pos)
            U.append(np.array([[0, 0.3], [d / 1.0, 0.3], [0, 0.6], [d / 1.0, 0.6]]))
            T.append(np.array([[0, 1, 3], [0, 3, 2]]) + off)
            side = tr.fr.vec(np.array([[-(b - a)[1], (b - a)[0]]]) / d)[0]
            HN += [(side[0], 0.0, side[1])] * 2
            off += 4
            total += d
    if P:
        parts.surface("TAPE_rows", "barricade", np.vstack(P), np.vstack(U), np.vstack(T), hint=np.array(HN), smooth=False, double_sided=True, cast_shadows=False)
    return dict(tape_m=round(total))


def build_cones(tr: Track, parts: Parts) -> dict:
    """Orange traffic cones along the lap wherever it crosses open asphalt (junctions, the plaza), one every 8 m, so
    the way of the race route is plain to see. They are for the eye only: a car passes through them."""
    n = tr.n
    SEG = 8
    ang = np.linspace(0, 2 * np.pi, SEG + 1)
    ring = np.column_stack([np.cos(ang), np.sin(ang)])
    P, U, T, HN, off, count = [], [], [], [], 0, 0
    for side in (1, -1):
        w = tr.wl if side > 0 else tr.wr
        m = (tr.open_l & ~tr.conc_l) if side > 0 else (tr.open_r & ~tr.conc_r)
        if side > 0:
            m = m & ~tr.in_pit_stretch()
        for st in np.where(m)[0][::8]:
            c = tr.en(np.array([float(st)]), np.array([side * (w[st] + 0.25)]))[0]
            g = float(tr.h(np.array([float(st)]), np.array([side * w[st]]))[0])
            base = tr.fr.world(c[None, :] + ring * 0.15, np.full(SEG + 1, g))
            tip = tr.fr.world(c[None, :] + ring * 0.025, np.full(SEG + 1, g + 0.52))
            out = tr.fr.vec(ring)
            n3 = np.column_stack([out[:, 0], np.full(SEG + 1, 0.3), out[:, 1]])
            P.append(np.vstack([base, tip]))
            U.append(np.vstack([np.column_stack([ang / (2 * np.pi), np.zeros(SEG + 1)]), np.column_stack([ang / (2 * np.pi), np.ones(SEG + 1)])]))
            r = np.arange(SEG)
            mid = n3[r] + n3[r + 1]
            HN.append(np.vstack([mid, mid]))
            T.append(np.concatenate([np.stack([r, r + SEG + 1, r + SEG + 2], -1), np.stack([r, r + SEG + 2, r + 1], -1)]) + off)
            off += 2 * (SEG + 1)
            count += 1
    if P:
        parts.surface("CONES_route", "cone", np.vstack(P), np.vstack(U), np.vstack(T), hint=np.vstack(HN), smooth=True)
    return dict(cones=count)


def build_fences(tr: Track, parts: Parts, lines: list) -> dict:
    """Wire mesh fences on top of the walls, as around the real paddock and pits (for the eye only).
    lines: [(east/north polyline, height of the wall under it)]."""
    P, U, T, HN, off, total = [], [], [], [], 0, 0.0
    for en, base_h in lines:
        en = np.asarray(en, float)
        seg = np.linalg.norm(np.diff(en, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m = max(2, int(s[-1] / 2.5) + 1)
        q = np.column_stack([np.interp(np.linspace(0, s[-1], m), s, en[:, 0]), np.interp(np.linspace(0, s[-1], m), s, en[:, 1])])
        g = tr.H.ground(q)
        pos = np.vstack([tr.fr.world(q, g + base_h), tr.fr.world(q, g + base_h + 1.7)])
        u = np.linspace(0, s[-1], m) / 2.5
        P.append(pos)
        U.append(np.vstack([np.column_stack([u, np.zeros(m)]), np.column_stack([u, np.ones(m)])]))
        r = np.arange(m - 1)
        T.append(np.concatenate([np.stack([r, r + 1, r + m + 1], -1), np.stack([r, r + m + 1, r + m], -1)]) + off)
        d = np.gradient(q, axis=0)
        nrm = tr.fr.vec(np.column_stack([-d[:, 1], d[:, 0]]) / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9))
        HN.append(np.tile(np.column_stack([nrm[:-1, 0], np.zeros(m - 1), nrm[:-1, 1]]), (2, 1)))
        off += 2 * m
        total += float(s[-1])
    if P:
        parts.surface("FENCE_walls", "fence", np.vstack(P), np.vstack(U), np.vstack(T), hint=np.vstack(HN), smooth=False, double_sided=True, cast_shadows=False)
    return dict(fence_m=round(total))
