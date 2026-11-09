#!/usr/bin/env python3
"""Build an Assetto Corsa track from a GPS centerline, an aerial image and (optionally) a height grid.

Input : source/centerline.json  ({"points": [[lat, lon], ...], "scale_m_per_px", "image_center"})
        source/cuzk/ortho.png + dem.tif + meta.json   (ČÚZK orthophoto and LiDAR heights, preferred)
        or source/trace/aerial.png                    (layout screenshot, fallback)
Output: source/<track>.obj + .mtl + texture/*.png     (mesh with AC object names)
        source/layout.json                             (start/pit/timing positions, AC coords)
        content/tracks/<track>/map.png, data/map.ini, data/cameras.ini, ui/outline.png, ui/preview.png

Coordinates: everything is written in Assetto Corsa world space (X east, Y up, Z = -north).
Blender's OBJ importer (default: -Z forward, Y up) turns that into X east, Y north, Z up.

Usage: python build_track.py [--track sosnova] [--grid 16] [--pit-left] [--sf-at-first-point]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
if HERE not in sys.path:  # so `import scenery` works however the script is launched
    sys.path.insert(0, HERE)
KERB_RADIUS = 60.0  # corners tighter than this radius get kerbs (set by --kerb-radius)


# ----------------------------------------------------------------------------- geometry helpers
def project(points: list[list[float]], origin: tuple[float, float] | None = None) -> tuple[np.ndarray, tuple[float, float]]:
    """Lat/lon -> local metres (east, north) around `origin` (default: the centroid)."""
    pts = np.asarray(points, dtype=float)
    lat0, lon0 = origin if origin else (pts[:, 0].mean(), pts[:, 1].mean())
    east = (pts[:, 1] - lon0) * 111_320.0 * math.cos(math.radians(lat0))
    north = (pts[:, 0] - lat0) * 110_540.0
    return np.column_stack([east, north]), (lat0, lon0)


def resample_closed(xy: np.ndarray, step: float) -> np.ndarray:
    if np.allclose(xy[0], xy[-1]):
        xy = xy[:-1]
    loop = np.vstack([xy, xy[:1]])
    seg = np.linalg.norm(np.diff(loop, axis=0), axis=1)
    dist = np.concatenate([[0.0], np.cumsum(seg)])
    total = dist[-1]
    n = max(int(round(total / step)), 8)
    targets = np.linspace(0.0, total, n, endpoint=False)
    return np.column_stack([np.interp(targets, dist, loop[:, 0]), np.interp(targets, dist, loop[:, 1])])


def smooth_closed(xy: np.ndarray, sigma_pts: float) -> np.ndarray:
    """Circular Gaussian smoothing; removes the hand-drawn jaggedness of the traced line."""
    k = int(sigma_pts * 4) | 1
    offs = np.arange(k) - k // 2
    w = np.exp(-0.5 * (offs / sigma_pts) ** 2)
    w /= w.sum()
    out = np.empty_like(xy)
    n = len(xy)
    for i in range(n):
        out[i] = (xy[(i + offs) % n] * w[:, None]).sum(axis=0)
    return out


def smooth_profile(a: np.ndarray, sigma_pts: float) -> np.ndarray:
    """Circular Gaussian smoothing of a 1-D signal along the lap."""
    k = int(sigma_pts * 4) | 1
    pad = np.concatenate([a[-k:], a, a[:k]])
    return ndi.gaussian_filter1d(pad, sigma_pts)[k:-k]


def ensure_ccw(xy: np.ndarray) -> np.ndarray:
    x, y = xy[:, 0], xy[:, 1]
    return xy if 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y) > 0 else xy[::-1].copy()


def frames(xy: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit tangent, unit left normal and signed curvature (1/m) along a closed loop."""
    fwd = np.roll(xy, -1, axis=0) - np.roll(xy, 1, axis=0)
    t = fwd / np.linalg.norm(fwd, axis=1)[:, None]
    left = np.column_stack([-t[:, 1], t[:, 0]])
    ang = np.arctan2(t[:, 1], t[:, 0])
    dang = np.angle(np.exp(1j * (np.roll(ang, -1) - np.roll(ang, 1))))
    ds = np.linalg.norm(np.roll(xy, -1, axis=0) - np.roll(xy, 1, axis=0), axis=1)
    return t, left, dang / ds


# ----------------------------------------------------------------------------- OBJ writer
class Obj:
    def __init__(self) -> None:
        self.v: list[tuple[float, float, float]] = []
        self.vt: list[tuple[float, float]] = []
        self.vn: list[tuple[float, float, float]] = []
        self.objects: list[tuple[str, str, list[tuple[int, ...]]]] = []

    def add_vertex(self, p, uv, n=(0.0, 1.0, 0.0)) -> int:
        self.v.append(tuple(float(c) for c in p))
        self.vt.append((float(uv[0]), float(uv[1])))
        self.vn.append(tuple(float(c) for c in n))
        return len(self.v)  # 1-based

    def add_ribbon(self, name: str, material: str, rows: list[list[int]], closed: bool) -> None:
        """rows[i] = vertex indices across the ribbon (left->right) at station i."""
        faces = []
        n = len(rows)
        for i in range(n if closed else n - 1):
            a, b = rows[i], rows[(i + 1) % n]
            for j in range(len(a) - 1):
                faces.append((a[j], a[j + 1], b[j + 1], b[j]))  # CCW from above => normal up
        self.objects.append((name, material, faces))

    def add_faces(self, name: str, material: str, faces: list[tuple[int, ...]]) -> None:
        self.objects.append((name, material, faces))

    def write(self, path: str, mtl_name: str) -> None:
        with open(path, "w") as f:
            f.write(f"mtllib {mtl_name}\n")
            f.writelines(f"v {p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n" for p in self.v)
            f.writelines(f"vt {t[0]:.5f} {t[1]:.5f}\n" for t in self.vt)
            f.writelines(f"vn {nrm[0]:.4f} {nrm[1]:.4f} {nrm[2]:.4f}\n" for nrm in self.vn)
            for name, mat, faces in self.objects:
                f.write(f"o {name}\nusemtl {mat}\n")
                f.writelines("f " + " ".join(f"{i}/{i}/{i}" for i in face) + "\n" for face in faces)


MATERIALS = {
    "road": ("texture/road.png", (0.35, 0.35, 0.36)),
    "kerb": ("texture/kerb.png", (0.8, 0.2, 0.2)),
    "grass": ("texture/grass.png", (0.25, 0.45, 0.15)),
    "ground": ("texture/ground.png", (0.3, 0.4, 0.2)),
    "line": ("texture/line.png", (1.0, 1.0, 1.0)),
    "wall": ("texture/wall.png", (0.6, 0.6, 0.6)),
    "aerial": ("texture/aerial.png", (0.5, 0.5, 0.4)),
    "cone": ("texture/cone.png", (0.9, 0.35, 0.1)),
    "building": ("texture/building.png", (0.75, 0.74, 0.72)),
    "tree": ("texture/tree.png", (0.2, 0.4, 0.15)),
}


def write_mtl(path: str) -> None:
    with open(path, "w") as f:
        for name, (tex, kd) in MATERIALS.items():
            alpha = f"map_d {tex}\n" if name == "tree" else ""
            f.write(f"newmtl {name}\nKa 0.2 0.2 0.2\nKd {kd[0]} {kd[1]} {kd[2]}\nKs 0.05 0.05 0.05\nNs 10\nd 1\nillum 2\nmap_Kd {tex}\n{alpha}\n")


def make_textures(folder: str) -> None:
    """Procedural placeholder textures for the close-up materials."""
    os.makedirs(folder, exist_ok=True)
    rng = np.random.default_rng(7)

    def noise(size: int, base: tuple[int, int, int], spread: int, blur: float) -> Image.Image:
        arr = np.clip(np.array(base)[None, None, :] + rng.integers(-spread, spread + 1, (size, size, 1)), 0, 255).astype(np.uint8)
        return Image.fromarray(arr).filter(ImageFilter.GaussianBlur(blur))

    noise(512, (72, 72, 74), 18, 0.6).save(os.path.join(folder, "road.png"))
    noise(512, (58, 104, 36), 22, 1.0).save(os.path.join(folder, "grass.png"))
    noise(512, (76, 98, 44), 20, 1.2).save(os.path.join(folder, "ground.png"))
    noise(256, (150, 150, 148), 12, 0.8).save(os.path.join(folder, "wall.png"))
    kerb = Image.new("RGB", (256, 256), (225, 225, 220))
    ImageDraw.Draw(kerb).rectangle([0, 0, 256, 128], fill=(200, 30, 30))
    kerb.save(os.path.join(folder, "kerb.png"))
    Image.new("RGB", (64, 64), (235, 235, 235)).save(os.path.join(folder, "line.png"))


# ----------------------------------------------------------------------------- road surface model
class Surface:
    """Height of the road surface: smoothed centre profile + smoothed cross slope from the terrain."""

    def __init__(self, center: np.ndarray, left: np.ndarray, wl: np.ndarray, wr: np.ndarray, height_fn, step: float, smooth_m: float = 8.0):
        self.center, self.left, self.wl, self.wr = center, left, wl, wr
        hc = height_fn(center)
        hl = height_fn(center + left * wl[:, None])
        hr = height_fn(center - left * wr[:, None])
        # smooth_m ~8 m for a ribbon road (LiDAR noise is 0.18 m); ~0 when the road polygons already use
        # the smoothed terrain field, so stripes/kerbs/empties sit exactly on that surface
        sig = max(smooth_m / step, 0.5)
        self.hc = smooth_profile(hc, sig) if smooth_m > 0 else hc
        self.slope = smooth_profile((hl - hr) / np.maximum(wl + wr, 1e-3), sig * 1.5) if smooth_m > 0 else (hl - hr) / np.maximum(wl + wr, 1e-3)
        self.tree = cKDTree(center)

    def at(self, i: int, lateral: float) -> float:
        """Height at station i, `lateral` metres to the left of the centre (negative = right)."""
        return float(self.hc[i] + self.slope[i] * lateral)

    def nearest(self, en: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """For arbitrary points: nearest station, signed lateral offset and height on the road plane."""
        en = np.atleast_2d(en)
        _, idx = self.tree.query(en)
        d = en - self.center[idx]
        lateral = np.einsum("ij,ij->i", d, self.left[idx])
        return idx, lateral, self.hc[idx] + self.slope[idx] * lateral

    def blend(self, en: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(height, weight) for ground vertices: weight 1 next to the road, fading to 0 by 12 m outside the edge."""
        idx, lateral, h = self.nearest(en)
        edge = np.where(lateral >= 0, self.wl[idx], self.wr[idx]) + 1.2
        outside = np.abs(lateral) - edge
        w = np.clip(1.0 - outside / 12.0, 0.0, 1.0)
        return h, w


# ----------------------------------------------------------------------------- mesh building
def build_mesh(center: np.ndarray, wl: np.ndarray, wr: np.ndarray, out_dir: str, track: str, scenery, surface: Surface,
               sf_index: int, cones_en: np.ndarray | None) -> dict:
    t, left, curv = frames(center)
    n = len(center)
    kerb_w = 1.2
    obj = Obj()
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(center, axis=0), axis=1))])
    step = s[1] - s[0]

    def pt(i: int, d: float, dy: float = 0.0) -> np.ndarray:
        """AC point at station i, d metres left of the centre, on the road surface (+dy)."""
        e = center[i] + left[i] * d
        return np.array([e[0], surface.at(i, d) + dy, -e[1]])

    def ground_uv(i: int, d: float, fallback: tuple[float, float]) -> tuple[float, float]:
        if scenery is None:
            return fallback
        u, v = scenery.uv(scenery.en_to_px(center[i] + left[i] * d))[0]
        return (float(u), float(v))

    polygon_road = scenery is not None and not scenery.has_overlays and scenery.terrain is not None
    info: dict = {}
    road_mask = None
    if polygon_road:
        # ---- road = the real asphalt outline from the orthophoto, triangulated onto the terrain
        from roadmesh import asphalt_geometry, add_road_polygons, rasterize
        geom = asphalt_geometry(scenery, center)
        road_mask = rasterize(scenery, geom)
        info["asphalt_m2"] = float(geom.area)
        info["road_triangles"] = add_road_polygons(obj, scenery, geom, scenery.height)
        print(f"asphalt polygons: {len(geom.geoms)} areas, {geom.area:.0f} m2, {info['road_triangles']} triangles")
    else:
        # ---- road ribbon: 7 vertices across, UV v along length (1 tile per 8 m)
        rows = []
        for i in range(n):
            rows.append([obj.add_vertex(pt(i, d), (k / 6.0, s[i] / 8.0)) for k, d in enumerate(np.linspace(wl[i], -wr[i], 7))])
        obj.add_ribbon("1ROAD_main", "road", rows, closed=True)
        for side, sign in (("L", 1.0), ("R", -1.0)):
            rows = []
            for i in range(n):
                w_i = wl[i] if sign > 0 else wr[i]
                a = pt(i, sign * (w_i - 0.05), 0.004)
                b = pt(i, sign * (w_i - 0.20), 0.004)
                rows.append([obj.add_vertex(a if sign > 0 else b, (0, s[i] / 8)), obj.add_vertex(b if sign > 0 else a, (1, s[i] / 8))])
            obj.add_ribbon(f"LINE_{side}", "line", rows, closed=True)

    # ---- start/finish stripe
    i0, i1 = sf_index, (sf_index + 1) % n
    lift = 0.02 if polygon_road else 0.005
    quad = [pt(i0, wl[i0] - 0.2, lift), pt(i0, -(wr[i0] - 0.2), lift), pt(i1, -(wr[i1] - 0.2), lift), pt(i1, wl[i1] - 0.2, lift)]
    sfv = [obj.add_vertex(p, uv) for p, uv in zip(quad, ((0, 0), (1, 0), (1, 1), (0, 1)))]
    obj.add_faces("LINE_startfinish", "line", [tuple(sfv)])

    # ---- kerbs on the inside of tight corners, otherwise a flat edge band with the ground texture
    curv_s = smooth_profile(curv, max(8.0 / step, 1))
    corner = np.abs(curv_s) > 1.0 / KERB_RADIUS
    grow = int(12 / step)
    corner_grown = corner.copy()
    for g in range(1, grow + 1):
        corner_grown |= np.roll(corner, g) | np.roll(corner, -g)
    kerb_left = corner_grown & (curv_s > 0)
    kerb_right = corner_grown & (curv_s < 0)
    for arr in (kerb_left, kerb_right):
        for g in (1, 2):
            arr |= np.roll(arr, g) & np.roll(arr, -g)

    def band(side_sign: float, inner: np.ndarray, flags: np.ndarray, kerb_name: str, other_name: str) -> None:
        vi_k, vo_k, vi_g, vo_g = [], [], [], []
        for i in range(n):
            d_in, d_out = side_sign * inner[i], side_sign * (inner[i] + kerb_w)
            p_in = pt(i, d_in, 0.01 if polygon_road else 0.0)
            p_out = pt(i, d_out, 0.05 if flags[i] else 0.0)
            vi_k.append(obj.add_vertex(p_in, (0.0, s[i] / 2.0)))
            vo_k.append(obj.add_vertex(p_out, (1.0, s[i] / 2.0)))
            vi_g.append(obj.add_vertex(p_in, ground_uv(i, d_in, (0.0, s[i] / 10.0))))
            vo_g.append(obj.add_vertex(p_out, ground_uv(i, d_out, (1.0, s[i] / 10.0))))
        kerb_faces, other_faces = [], []
        for i in range(n):
            j = (i + 1) % n
            vi, vo = (vi_k, vo_k) if flags[i] else (vi_g, vo_g)
            q = (vo[i], vi[i], vi[j], vo[j]) if side_sign > 0 else (vi[i], vo[i], vo[j], vi[j])
            (kerb_faces if flags[i] else other_faces).append(q)
        if kerb_faces:
            obj.add_faces(kerb_name, "kerb", kerb_faces)
        if other_faces and not polygon_road:
            obj.add_faces(other_name, "aerial" if scenery is not None else "grass", other_faces)

    band(+1.0, wl, kerb_left, "1KERB_L", "1GRASS_edgeL")
    band(-1.0, wr, kerb_right, "1KERB_R", "1GRASS_edgeR")

    info.update({"kerb_left": int(kerb_left.sum()), "kerb_right": int(kerb_right.sum())})
    if scenery is not None:
        def band_mask(reach_m: float) -> np.ndarray:
            m = np.zeros((scenery.h, scenery.w), dtype=bool)
            reach = int(reach_m / scenery.scale)
            for (px, py) in scenery.en_to_px(center).astype(int):
                m[max(py - reach, 0):min(py + reach + 1, scenery.h), max(px - reach, 0):min(px + reach + 1, scenery.w)] = True
            return m
        scenery.ground(obj, cell_m=2.0, surface=None if polygon_road else surface.blend, near_track=band_mask(30.0), skip_mask=road_mask)
        scenery.outer_ring(obj, margin_m=120.0)
        info["cones"] = scenery.cones(obj, cones_en, surface=lambda en: (surface.nearest(en)[2], None))
        info["buildings"] = scenery.buildings(obj, exclude_px=band_mask(max(wl.max(), wr.max()) + 10.0))
        info["trees"] = scenery.trees(obj, exclude_px=band_mask(max(wl.max(), wr.max()) + 6.0))
        from scenery import make_scenery_textures
        make_scenery_textures(os.path.join(out_dir, "texture"))
    else:
        margin = 80.0
        ex0, ex1 = center[:, 0].min() - margin, center[:, 0].max() + margin
        ny0, ny1 = center[:, 1].min() - margin, center[:, 1].max() + margin
        gx, gy = np.linspace(ex0, ex1, 25), np.linspace(ny0, ny1, 25)
        grid = [[obj.add_vertex((x, -0.02, -y), (x / 20.0, y / 20.0)) for x in gx] for y in gy]
        faces = [(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]) for r in range(24) for c in range(24)]
        obj.add_faces("1GRASS_ground", "ground", faces)
        corners = [(ex0, ny0), (ex1, ny0), (ex1, ny1), (ex0, ny1)]
        for k in range(4):
            (xa, ya), (xb, yb) = corners[k], corners[(k + 1) % 4]
            length = math.hypot(xb - xa, yb - ya)
            v0 = obj.add_vertex((xa, -0.02, -ya), (0, 0), (0, 0, 1))
            v1 = obj.add_vertex((xb, -0.02, -yb), (length / 4, 0), (0, 0, 1))
            v2 = obj.add_vertex((xb, 1.5, -yb), (length / 4, 1), (0, 0, 1))
            v3 = obj.add_vertex((xa, 1.5, -ya), (0, 1), (0, 0, 1))
            obj.add_faces(f"1WALL_perimeter_{k}", "wall", [(v0, v3, v2, v1)])

    obj.write(os.path.join(out_dir, f"{track}.obj"), f"{track}.mtl")
    write_mtl(os.path.join(out_dir, f"{track}.mtl"))
    make_textures(os.path.join(out_dir, "texture"))
    info["vertices"] = len(obj.v)
    return info


# ----------------------------------------------------------------------------- layout (start, pits, timing)
def longest_straight(curv: np.ndarray) -> tuple[int, int]:
    n = len(curv)
    straight = np.abs(curv) < 1.0 / 400.0
    cur_start, best_start, best_len = None, 0, 0
    for i in range(2 * n):
        if straight[i % n]:
            cur_start = i if cur_start is None else cur_start
            if i - cur_start + 1 > best_len:
                best_len, best_start = i - cur_start + 1, cur_start
        else:
            cur_start = None
    return best_start % n, (best_start + min(best_len, n) - 1) % n


def build_layout(center: np.ndarray, grid: int, pit_side_right: bool, wl: np.ndarray, wr: np.ndarray, surface: Surface,
                 sf_point: np.ndarray | None = None) -> dict:
    t, left, curv = frames(center)
    n = len(center)
    step = float(np.linalg.norm(center[1] - center[0]))
    if sf_point is not None:
        sf = int(np.argmin(np.linalg.norm(center - sf_point, axis=1)))
    else:
        s0, s1 = longest_straight(curv)
        sf = (s0 + int(((s1 - s0) % n) * 0.62)) % n

    def idx_back(i: int, metres: float) -> int:
        return (i - int(round(metres / step))) % n

    def pose(i: int, lateral: float) -> dict:
        p = center[i] + left[i] * lateral
        heading = math.degrees(math.atan2(t[i][1], t[i][0]))  # 0 = east, CCW positive (Blender convention)
        return {"pos_ac": [float(p[0]), surface.at(i, lateral), float(-p[1])], "dir_en": [float(t[i][0]), float(t[i][1])], "heading_deg_blender": heading}

    layout: dict = {"AC_START": [], "AC_PIT": [], "AC_TIME": [], "AC_HOTLAP_START": [], "AC_CREW": []}
    for k in range(grid):
        row, col = divmod(k, 2)
        i = idx_back(sf, 12.0 + row * 8.0 + col * 4.0)
        layout["AC_START"].append(pose(i, (wl[i] if col == 0 else -wr[i]) * 0.5))

    pit_sign = -1.0 if pit_side_right else 1.0
    w_pit = wr if pit_side_right else wl
    pit_zone_start = (sf + int(round(10.0 / step))) % n
    for k in range(grid):
        i = (pit_zone_start + int(round((k * 6.0) / step))) % n
        pit_lat = pit_sign * (w_pit[i] + 1.2 + 4.0)
        layout["AC_PIT"].append(pose(i, pit_lat))
        layout["AC_CREW"].append(pose(i, pit_lat + pit_sign * 4.0))

    for sector, i in enumerate((sf, (sf + n // 3) % n, (sf + 2 * n // 3) % n)):
        layout["AC_TIME"].append({"index": sector, "L": pose(i, wl[i] + 1.0), "R": pose(i, -(wr[i] + 1.0))})
    layout["AC_HOTLAP_START"].append(pose(idx_back(sf, 180.0), 0.0))
    layout["start_finish_index"] = int(sf)
    layout["pit_side"] = "right" if pit_side_right else "left"
    return layout


# ----------------------------------------------------------------------------- cameras, map, ui images
def write_cameras(path: str, center: np.ndarray, height_fn, count: int = 8) -> None:
    t, left, curv = frames(center)
    n = len(center)
    lines = ["[HEADER]", "VERSION=2", "SET_NAME=Default", f"CAMERA_COUNT={count}", ""]
    chunk = n // count
    for c in range(count):
        local = int(np.argmax(np.abs(curv[c * chunk:(c + 1) * chunk]))) + c * chunk
        outside = -np.sign(curv[local]) if curv[local] != 0 else 1.0
        cam = center[local] + left[local] * outside * 22.0
        cam_h = float(height_fn(cam[None])[0]) + 6.0
        look = center[(local + 15) % n]
        look_h = float(height_fn(look[None])[0])
        fwd = np.array([look[0] - cam[0], look_h - cam_h, -(look[1] - cam[1])])
        fwd /= np.linalg.norm(fwd)
        lines += [f"[CAMERA_{c}]", f"NAME=CAM_{c}", f"POSITION={cam[0]:.3f},{cam_h:.3f},{-cam[1]:.3f}",
                  f"FORWARD={fwd[0]:.4f},{fwd[1]:.4f},{fwd[2]:.4f}", "UP=0,1,0", "MIN_FOV=8", "MAX_FOV=55",
                  f"IN_POINT={c / count:.4f}", f"OUT_POINT={(c + 1) / count:.4f}", "SHADOW_SPLIT0=20", "SHADOW_SPLIT1=80",
                  "SHADOW_SPLIT2=300", "NEAR_PLANE=0.5", "FAR_PLANE=5000", "MIN_EXPOSURE=0.3", "MAX_EXPOSURE=0.8",
                  "DOF_FACTOR=0", "DOF_RANGE=1000", "DOF_FOCUS=0", "DOF_MANUAL=0", "SPLINE=0", "SPLINE_ANIMATION_LENGTH=0", "IS_FIXED=0", ""]
    with open(path, "w") as f:
        f.write("\n".join(lines))


def write_map(track_dir: str, center: np.ndarray, width: float) -> None:
    """map.png + data/map.ini. AC maps world (x, z) to pixels with (x + X_OFFSET) / SCALE_FACTOR."""
    size, margin = 1024, 20
    x, z = center[:, 0], -center[:, 1]
    ext = max(x.max() - x.min(), z.max() - z.min())
    scale = ext / (size - 2 * margin)
    x_off, z_off = -x.min() + margin * scale, -z.min() + margin * scale
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pts = [((xx + x_off) / scale, (zz + z_off) / scale) for xx, zz in zip(x, z)]
    ImageDraw.Draw(img).line(pts + pts[:1], fill=(255, 255, 255, 255), width=max(3, int(width / scale)), joint="curve")
    img.save(os.path.join(track_dir, "map.png"))
    with open(os.path.join(track_dir, "data", "map.ini"), "w") as f:
        f.write(f"[PARAMETERS]\nWIDTH={size}\nHEIGHT={size}\nMARGIN={margin}\nSCALE_FACTOR={scale:.6f}\nMAX_SIZE=1600\nX_OFFSET={x_off:.3f}\nZ_OFFSET={z_off:.3f}\nDRAWING_SIZE=10\n")
    outline = Image.new("RGBA", (800, 600), (0, 0, 0, 0))
    sc = ext / 520.0
    pts2 = [(((xx - x.min()) / sc) + 140, ((zz - z.min()) / sc) + 40) for xx, zz in zip(x, z)]
    ImageDraw.Draw(outline).line(pts2 + pts2[:1], fill=(255, 255, 255, 255), width=10, joint="curve")
    outline.save(os.path.join(track_dir, "ui", "outline.png"))


# ----------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", default="sosnova")
    ap.add_argument("--width", type=float, default=10.0, help="road width (m) when no aerial image is available")
    ap.add_argument("--grid", type=int, default=16, help="number of start/pit positions")
    ap.add_argument("--step", type=float, default=1.0, help="mesh resolution along the track (m)")
    ap.add_argument("--smooth", type=float, default=3.0, help="smoothing of the traced line (m)")
    ap.add_argument("--pit-left", action="store_true", help="put the pits on the left instead of right")
    ap.add_argument("--no-scenery", action="store_true", help="do not use the aerial image / heights even if present")
    ap.add_argument("--kerb-radius", type=float, default=60.0, help="corners tighter than this radius (m) get kerbs")
    ap.add_argument("--sf-at-first-point", action="store_true", help="start/finish at the first centerline point")
    ap.add_argument("--centerline", default=os.path.join(KIT, "source", "centerline.json"))
    a = ap.parse_args()
    global KERB_RADIUS
    KERB_RADIUS = a.kerb_radius

    src_dir = os.path.join(KIT, "source")
    track_dir = os.path.join(KIT, "content", "tracks", a.track)
    for sub in ("data", "ui", "ai", "extension"):
        os.makedirs(os.path.join(track_dir, sub), exist_ok=True)
    os.makedirs(os.path.join(src_dir, "texture"), exist_ok=True)

    with open(a.centerline, encoding="utf-8") as f:
        src = json.load(f)

    # ---- choose the image source: ČÚZK orthophoto + heights (preferred) or the layout screenshot
    scenery = None
    cones_en = None
    origin = None
    cuzk_meta = os.path.join(src_dir, "cuzk", "meta.json")
    if not a.no_scenery and os.path.exists(cuzk_meta):
        from scenery import Aerial, Terrain
        meta = json.load(open(cuzk_meta))
        origin = tuple(meta["center"])
        scenery = Aerial(os.path.join(src_dir, "cuzk", "ortho.png"), meta["gsd"], origin[0], origin[1], has_overlays=False)
        scenery.terrain = Terrain(os.path.join(src_dir, "cuzk", "dem.tif"), tuple(meta["half_m"]), meta["dem_gsd"])
        scenery.clean_texture(os.path.join(src_dir, "texture", "aerial.png"))
        ro = os.path.join(src_dir, "cuzk", "route_ortho.json")
        if os.path.exists(ro):
            rr = json.load(open(ro))
            if rr.get("cones_px"):
                cones_en = scenery.px_to_en(np.array(rr["cones_px"], float))
        print(f"source: ČÚZK orthophoto {scenery.w}x{scenery.h} @ {scenery.scale} m/px + DMR 5G heights")
    elif not a.no_scenery and os.path.exists(os.path.join(src_dir, "trace", "aerial.png")) and "scale_m_per_px" in src:
        from scenery import Aerial
        origin = tuple(src["image_center"])
        scenery = Aerial(os.path.join(src_dir, "trace", "aerial.png"), src["scale_m_per_px"], origin[0], origin[1], has_overlays=True)
        scenery.clean_texture(os.path.join(src_dir, "texture", "aerial.png"),
                              extra_boxes=[(0, 0, 340, 85, 900, 90, 1140, 260), (0, 640, 650, scenery.h, 300, 430, 470, 540), (340, 350, 490, 380), (395, 322, 425, 342), (785, 648, 810, 668), (1110, 480, 1140, 500)])
        print(f"source: layout screenshot @ {scenery.scale:.3f} m/px (flat)")

    en, (lat0, lon0) = project(src["points"], origin)
    sf_point = en[0].copy() if a.sf_at_first_point else None
    en = resample_closed(en, 1.0)
    en = smooth_closed(en, a.smooth)
    en = resample_closed(en, a.step)
    en = ensure_ccw(en)
    length = float(np.sum(np.linalg.norm(np.diff(np.vstack([en, en[:1]]), axis=0), axis=1)))
    print(f"centerline: {len(en)} stations every {a.step} m, lap length {length:.0f} m")

    t_, left_, _ = frames(en)
    if scenery is not None:
        # snap the drawn line to the middle of the real asphalt (twice); widths capped at 8 m so the
        # wide paddock areas do not pull the line, then measure the final edges
        for _ in range(2):
            wl, wr = scenery.road_edges(en, left_)
            shift = (np.minimum(wl, 8.0) - np.minimum(wr, 8.0)) / 2.0
            en = en + left_ * smooth_profile(shift, 4.0 / a.step)[:, None]
            en = resample_closed(en, a.step)
            en = smooth_closed(en, max(2.0 / a.step, 1.0))
            en = resample_closed(en, a.step)
            t_, left_, _ = frames(en)
        wl, wr = scenery.road_edges(en, left_)
        print(f"road edges from image: left {wl.min():.1f}-{wl.max():.1f} m, right {wr.min():.1f}-{wr.max():.1f} m, mean width {np.mean(wl + wr):.1f} m")
    else:
        wl = wr = np.full(len(en), a.width / 2.0)

    # heights: reference the terrain to the start/finish point so the track sits near y = 0
    if scenery is not None and scenery.terrain is not None:
        sf_idx = int(np.argmin(np.linalg.norm(en - sf_point, axis=1))) if sf_point is not None else 0
        scenery.terrain.ref = float(scenery.terrain.sample_raw(en[sf_idx][None])[0])
        height_fn = scenery.height
        hs = height_fn(en)
        print(f"terrain: track height range {hs.min():.1f} .. {hs.max():.1f} m relative to the start line ({scenery.terrain.ref:.1f} m a.s.l.)")
    else:
        height_fn = lambda p: np.zeros(len(np.atleast_2d(p)))
    polygon_road = scenery is not None and not scenery.has_overlays and scenery.terrain is not None
    surface = Surface(en, left_, wl, wr, height_fn, a.step, smooth_m=0.0 if polygon_road else 8.0)

    layout = build_layout(en, a.grid, not a.pit_left, wl, wr, surface, sf_point)
    info = build_mesh(en, wl, wr, src_dir, a.track, scenery, surface, layout["start_finish_index"], cones_en)
    layout["meta"] = {"track": a.track, "length_m": round(length), "width_m": float(np.mean(wl + wr)), "geotag": [lat0, lon0],
                      "stations": len(en), "kerb_segments": [info["kerb_left"], info["kerb_right"]], "cones": len(info.get("cones", [])),
                      "buildings": info.get("buildings", 0), "trees": info.get("trees", 0), "vertices": info["vertices"],
                      "height_range_m": [float(surface.hc.min()), float(surface.hc.max())]}
    with open(os.path.join(src_dir, "layout.json"), "w") as f:
        json.dump(layout, f, indent=1)

    write_cameras(os.path.join(track_dir, "data", "cameras.ini"), en, height_fn)
    write_map(track_dir, en, float(np.mean(wl + wr)))
    if scenery is not None:
        prev = Image.fromarray((scenery.clean * 255).astype(np.uint8)).convert("RGB")
        pd = ImageDraw.Draw(prev)
        pts = [tuple(p) for p in scenery.en_to_px(en)]
        pd.line(pts + pts[:1], fill=(255, 40, 40), width=max(2, int(1.5 / scenery.scale)))
        prev.resize((1022, int(1022 * prev.height / prev.width)), Image.LANCZOS).save(os.path.join(track_dir, "ui", "preview.png"))
    ui_path = os.path.join(track_dir, "ui", "ui_track.json")
    if os.path.exists(ui_path):
        with open(ui_path, encoding="utf-8") as f:
            ui = json.load(f)
        ui.update({"geotags": [f"{lat0:.5f}", f"{lon0:.5f}"], "length": str(round(length)), "width": str(int(round(np.mean(wl + wr)))), "pitboxes": str(a.grid)})
        with open(ui_path, "w", encoding="utf-8") as f:
            json.dump(ui, f, indent=2, ensure_ascii=False)
    print(f"wrote {src_dir}/{a.track}.obj ({info['vertices']} vertices), layout.json, cameras.ini, map.png, map.ini, outline.png, preview.png")
    print(f"start/finish at station {layout['start_finish_index']}, pits on the {layout['pit_side']}, {a.grid} grid slots")
    if scenery is not None:
        print(f"scenery: {layout['meta']['cones']} cones, {layout['meta']['buildings']} buildings, {layout['meta']['trees']} trees, "
              f"road height range {surface.hc.min():.1f}..{surface.hc.max():.1f} m")


if __name__ == "__main__":
    main()
