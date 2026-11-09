#!/usr/bin/env python3
"""Build an Assetto Corsa starter track from a GPS centerline.

Input : source/centerline.json  ({"points": [[lat, lon], ...], ...} from fetch_osm.py)
Output: source/<track>.obj + .mtl + texture/*.png     (mesh with AC object names)
        source/layout.json                             (start/pit/timing positions, AC coords)
        content/tracks/<track>/map.png, data/map.ini, data/cameras.ini, ui/outline.png, ui/preview.png

Coordinates: everything is written in Assetto Corsa world space (X east, Y up, Z = -north).
Blender's OBJ importer (default: -Z forward, Y up) turns that into X east, Y north, Z up.

Usage: python build_track.py [--track sosnova] [--width 12] [--grid 16]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
KERB_RADIUS = 60.0  # corners tighter than this radius get kerbs (set by --kerb-radius)


# ----------------------------------------------------------------------------- geometry helpers
def project(points: list[list[float]]) -> tuple[np.ndarray, tuple[float, float]]:
    """Lat/lon -> local metres (east, north) around the centroid."""
    pts = np.asarray(points, dtype=float)
    lat0, lon0 = pts[:, 0].mean(), pts[:, 1].mean()
    east = (pts[:, 1] - lon0) * 111_320.0 * math.cos(math.radians(lat0))
    north = (pts[:, 0] - lat0) * 110_540.0
    return np.column_stack([east, north]), (lat0, lon0)


def resample_closed(xy: np.ndarray, step: float) -> np.ndarray:
    """Resample a closed polyline at a fixed spacing (metres)."""
    if np.allclose(xy[0], xy[-1]):
        xy = xy[:-1]
    loop = np.vstack([xy, xy[:1]])
    seg = np.linalg.norm(np.diff(loop, axis=0), axis=1)
    dist = np.concatenate([[0.0], np.cumsum(seg)])
    total = dist[-1]
    n = max(int(round(total / step)), 8)
    targets = np.linspace(0.0, total, n, endpoint=False)
    x = np.interp(targets, dist, loop[:, 0])
    y = np.interp(targets, dist, loop[:, 1])
    return np.column_stack([x, y])


def smooth_closed(xy: np.ndarray, sigma_pts: float) -> np.ndarray:
    """Circular Gaussian smoothing; removes the hand-drawn jaggedness of OSM ways."""
    k = int(sigma_pts * 4) | 1
    offs = np.arange(k) - k // 2
    w = np.exp(-0.5 * (offs / sigma_pts) ** 2)
    w /= w.sum()
    out = np.empty_like(xy)
    n = len(xy)
    for i in range(n):
        idx = (i + offs) % n
        out[i] = (xy[idx] * w[:, None]).sum(axis=0)
    return out


def ensure_ccw(xy: np.ndarray) -> np.ndarray:
    x, y = xy[:, 0], xy[:, 1]
    area = 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)
    return xy if area > 0 else xy[::-1].copy()


def frames(xy: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit tangent, unit left normal and signed curvature (1/m) along a closed loop."""
    fwd = np.roll(xy, -1, axis=0) - np.roll(xy, 1, axis=0)
    t = fwd / np.linalg.norm(fwd, axis=1)[:, None]
    left = np.column_stack([-t[:, 1], t[:, 0]])
    ang = np.arctan2(t[:, 1], t[:, 0])
    dang = np.angle(np.exp(1j * (np.roll(ang, -1) - np.roll(ang, 1))))
    ds = np.linalg.norm(np.roll(xy, -1, axis=0) - np.roll(xy, 1, axis=0), axis=1)
    return t, left, dang / ds


def to_ac(en: np.ndarray, y: float | np.ndarray = 0.0) -> np.ndarray:
    """(east, north) -> AC (x, y, z) with z = -north."""
    yy = np.full(len(en), y) if np.isscalar(y) else np.asarray(y)
    return np.column_stack([en[:, 0], yy, -en[:, 1]])


# ----------------------------------------------------------------------------- OBJ writer
class Obj:
    def __init__(self) -> None:
        self.v: list[tuple[float, float, float]] = []
        self.vt: list[tuple[float, float]] = []
        self.vn: list[tuple[float, float, float]] = []
        self.objects: list[tuple[str, str, list[tuple[int, ...]]]] = []  # name, material, faces (v/vt/vn idx)

    def add_vertex(self, p, uv, n=(0.0, 1.0, 0.0)) -> int:
        self.v.append(tuple(float(c) for c in p))
        self.vt.append((float(uv[0]), float(uv[1])))
        self.vn.append(tuple(float(c) for c in n))
        return len(self.v)  # 1-based

    def add_ribbon(self, name: str, material: str, rows: list[list[int]], closed: bool) -> None:
        """rows[i] = vertex indices across the ribbon at station i. Quads between stations.
        Row order must be left->right as seen in the travel direction so normals point up."""
        faces = []
        n = len(rows)
        last = n if closed else n - 1
        for i in range(last):
            a, b = rows[i], rows[(i + 1) % n]
            for j in range(len(a) - 1):
                # CCW seen from above (+Y): left -> right -> forward-right -> forward-left
                faces.append((a[j], a[j + 1], b[j + 1], b[j]))
        self.objects.append((name, material, faces))

    def add_faces(self, name: str, material: str, faces: list[tuple[int, ...]]) -> None:
        self.objects.append((name, material, faces))

    def write(self, path: str, mtl_name: str) -> None:
        with open(path, "w") as f:
            f.write(f"mtllib {mtl_name}\n")
            for p in self.v:
                f.write(f"v {p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n")
            for t in self.vt:
                f.write(f"vt {t[0]:.5f} {t[1]:.5f}\n")
            for nrm in self.vn:
                f.write(f"vn {nrm[0]:.4f} {nrm[1]:.4f} {nrm[2]:.4f}\n")
            for name, mat, faces in self.objects:
                f.write(f"o {name}\nusemtl {mat}\n")
                for face in faces:
                    f.write("f " + " ".join(f"{i}/{i}/{i}" for i in face) + "\n")


MATERIALS = {
    "road": ("texture/road.png", (0.35, 0.35, 0.36)),
    "kerb": ("texture/kerb.png", (0.8, 0.2, 0.2)),
    "grass": ("texture/grass.png", (0.25, 0.45, 0.15)),
    "ground": ("texture/ground.png", (0.3, 0.4, 0.2)),
    "line": ("texture/line.png", (1.0, 1.0, 1.0)),
    "wall": ("texture/wall.png", (0.6, 0.6, 0.6)),
}


def write_mtl(path: str) -> None:
    with open(path, "w") as f:
        for name, (tex, kd) in MATERIALS.items():
            f.write(f"newmtl {name}\nKa 0.2 0.2 0.2\nKd {kd[0]} {kd[1]} {kd[2]}\nKs 0.05 0.05 0.05\nNs 10\nd 1\nillum 2\nmap_Kd {tex}\n\n")


def make_textures(folder: str) -> None:
    """Simple procedural placeholder textures (replace with real ones later)."""
    os.makedirs(folder, exist_ok=True)
    rng = random.Random(7)

    def noise(size: int, base: tuple[int, int, int], spread: int, blur: float) -> Image.Image:
        img = Image.new("RGB", (size, size))
        px = img.load()
        for yy in range(size):
            for xx in range(size):
                d = rng.randint(-spread, spread)
                px[xx, yy] = tuple(max(0, min(255, c + d)) for c in base)
        return img.filter(ImageFilter.GaussianBlur(blur))

    noise(512, (72, 72, 74), 18, 0.6).save(os.path.join(folder, "road.png"))
    noise(512, (58, 104, 36), 22, 1.0).save(os.path.join(folder, "grass.png"))
    noise(512, (76, 98, 44), 20, 1.2).save(os.path.join(folder, "ground.png"))
    noise(256, (150, 150, 148), 12, 0.8).save(os.path.join(folder, "wall.png"))
    kerb = Image.new("RGB", (256, 256), (225, 225, 220))
    d = ImageDraw.Draw(kerb)
    d.rectangle([0, 0, 256, 128], fill=(200, 30, 30))  # red/white, V tiles along the track
    kerb.save(os.path.join(folder, "kerb.png"))
    Image.new("RGB", (64, 64), (235, 235, 235)).save(os.path.join(folder, "line.png"))


# ----------------------------------------------------------------------------- mesh building
def build_mesh(center: np.ndarray, width: float, pit_side_right: bool, pit_zone: tuple[int, int], out_dir: str, track: str) -> dict:
    t, left, curv = frames(center)
    n = len(center)
    half = width / 2.0
    kerb_w, grass_w = 1.2, 10.0
    obj = Obj()
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(center, axis=0), axis=1))])  # station (m)

    def offset(i: int, d: float) -> np.ndarray:
        """Point d metres to the LEFT of the centerline at station i (negative = right)."""
        return center[i] + left[i] * d

    # ---- road: 5 vertices across, UV v along length (1 tile per 8 m), u across
    rows = []
    for i in range(n):
        row = []
        for k, d in enumerate(np.linspace(half, -half, 5)):
            row.append(obj.add_vertex(to_ac(offset(i, d)[None])[0], (k / 4.0, s[i] / 8.0)))
        rows.append(row)
    obj.add_ribbon("1ROAD_main", "road", rows, closed=True)

    # ---- white edge lines (visual only, no digit prefix => not collidable)
    for side, sign in (("L", 1.0), ("R", -1.0)):
        rows = []
        for i in range(n):
            a = to_ac(offset(i, sign * (half - 0.05))[None], 0.003)[0]
            b = to_ac(offset(i, sign * (half - 0.20))[None], 0.003)[0]
            rows.append([obj.add_vertex(a if sign > 0 else b, (0, s[i] / 8)), obj.add_vertex(b if sign > 0 else a, (1, s[i] / 8))])
        obj.add_ribbon(f"LINE_{side}", "line", rows, closed=True)

    # ---- kerb band: kerb where the corner is tight, grass (flat) elsewhere.
    # Kerbs sit on the INSIDE of a corner; curvature > 0 = turning left => inside is left.
    # smooth the curvature over ~16 m before deciding where corners are (traced lines wobble)
    ks = int(8 / (s[1] - s[0])) | 1
    kern = np.exp(-0.5 * ((np.arange(ks) - ks // 2) / (ks / 4)) ** 2)
    kern /= kern.sum()
    curv_s = np.zeros_like(curv)
    for k_i, w in enumerate(kern):
        curv_s += w * np.roll(curv, k_i - ks // 2)
    curv = curv_s
    corner = np.abs(curv) > 1.0 / KERB_RADIUS
    # widen each kerb zone by ~12 m so kerbs start before the apex
    grow = int(12 / (s[1] - s[0]))
    corner_grown = corner.copy()
    for g in range(1, grow + 1):
        corner_grown |= np.roll(corner, g) | np.roll(corner, -g)
    kerb_left = corner_grown & (curv > 0)
    kerb_right = corner_grown & (curv < 0)
    # smooth the kerb flags along the loop so there are no 1-segment blips
    for arr in (kerb_left, kerb_right):
        for g in (1, 2):
            arr |= np.roll(arr, g) & np.roll(arr, -g)

    def band(side_sign: float, inner: float, outer: float, flags: np.ndarray, kerb_name: str, other_name: str, other_mat: str, height: float, uv_scale: float) -> None:
        """Ribbon between offsets inner..outer on one side, split into kerb/other objects by flags."""
        verts_in, verts_out = [], []
        for i in range(n):
            pin = to_ac(offset(i, side_sign * inner)[None], 0.0)[0]
            pout = to_ac(offset(i, side_sign * outer)[None], height if flags[i] else 0.0)[0]
            verts_in.append(obj.add_vertex(pin, (0.0, s[i] / uv_scale)))
            verts_out.append(obj.add_vertex(pout, (1.0, s[i] / uv_scale)))
        kerb_faces, other_faces = [], []
        for i in range(n):
            j = (i + 1) % n
            if side_sign > 0:  # left side: inner edge is to the right of the outer edge
                quad = (verts_out[i], verts_in[i], verts_in[j], verts_out[j])
            else:
                quad = (verts_in[i], verts_out[i], verts_out[j], verts_in[j])
            (kerb_faces if flags[i] else other_faces).append(quad)
        if kerb_faces:
            obj.add_faces(kerb_name, "kerb", kerb_faces)
        if other_faces:
            obj.add_faces(other_name, other_mat, other_faces)

    band(+1.0, half, half + kerb_w, kerb_left, "1KERB_L", "1GRASS_edgeL", "grass", 0.04, 2.0)
    band(-1.0, half, half + kerb_w, kerb_right, "1KERB_R", "1GRASS_edgeR", "grass", 0.04, 2.0)

    # ---- grass verge 10 m each side; on the pit side inside the pit zone it becomes asphalt (pit apron)
    pit_sign = -1.0 if pit_side_right else 1.0
    in_pit = np.zeros(n, dtype=bool)
    a, b = pit_zone
    if a <= b:
        in_pit[a:b] = True
    else:  # zone wraps past the end of the loop
        in_pit[a:] = True
        in_pit[:b] = True
    for side_sign, name in ((+1.0, "L"), (-1.0, "R")):
        pit_flags = in_pit if side_sign == pit_sign else np.zeros(n, dtype=bool)
        verts_in, verts_out = [], []
        for i in range(n):
            pin = to_ac(offset(i, side_sign * (half + kerb_w))[None], 0.0)[0]
            pout = to_ac(offset(i, side_sign * (half + kerb_w + grass_w))[None], 0.0)[0]
            verts_in.append(obj.add_vertex(pin, (0.0, s[i] / 10.0)))
            verts_out.append(obj.add_vertex(pout, (1.0, s[i] / 10.0)))
        grass_faces, pit_faces = [], []
        for i in range(n):
            j = (i + 1) % n
            quad = (verts_out[i], verts_in[i], verts_in[j], verts_out[j]) if side_sign > 0 else (verts_in[i], verts_out[i], verts_out[j], verts_in[j])
            (pit_faces if pit_flags[i] else grass_faces).append(quad)
        obj.add_faces(f"1GRASS_verge{name}", "grass", grass_faces)
        if pit_faces:
            obj.add_faces("1ROAD_pitapron", "road", pit_faces)

    # ---- ground plane under everything (2 cm lower) + perimeter walls so cars cannot fall off
    margin = 80.0
    ex0, ex1 = center[:, 0].min() - margin, center[:, 0].max() + margin
    ny0, ny1 = center[:, 1].min() - margin, center[:, 1].max() + margin
    gx = np.linspace(ex0, ex1, 25)
    gy = np.linspace(ny0, ny1, 25)
    grid = [[obj.add_vertex((x, -0.02, -y), (x / 20.0, y / 20.0)) for x in gx] for y in gy]
    faces = []
    for r in range(len(gy) - 1):
        for c in range(len(gx) - 1):
            # CCW from above in (east, north): (x0,y0) -> (x1,y0) -> (x1,y1) -> (x0,y1)
            faces.append((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
    obj.add_faces("1GRASS_ground", "ground", faces)

    wall_h = 1.5
    corners = [(ex0, ny0), (ex1, ny0), (ex1, ny1), (ex0, ny1)]
    for k in range(4):
        (xa, ya), (xb, yb) = corners[k], corners[(k + 1) % 4]
        length = math.hypot(xb - xa, yb - ya)
        # inward-facing wall: vertices ordered so the normal points toward the track
        v0 = obj.add_vertex((xa, -0.02, -ya), (0, 0), (0, 0, 1))
        v1 = obj.add_vertex((xb, -0.02, -yb), (length / 4, 0), (0, 0, 1))
        v2 = obj.add_vertex((xb, wall_h, -yb), (length / 4, 1), (0, 0, 1))
        v3 = obj.add_vertex((xa, wall_h, -ya), (0, 1), (0, 0, 1))
        obj.add_faces(f"1WALL_perimeter_{k}", "wall", [(v0, v3, v2, v1)])

    obj.write(os.path.join(out_dir, f"{track}.obj"), f"{track}.mtl")
    write_mtl(os.path.join(out_dir, f"{track}.mtl"))
    make_textures(os.path.join(out_dir, "texture"))
    return {"stations": s.tolist(), "kerb_left": int(kerb_left.sum()), "kerb_right": int(kerb_right.sum())}


# ----------------------------------------------------------------------------- layout (start, pits, timing)
def longest_straight(curv: np.ndarray, s: np.ndarray) -> tuple[int, int]:
    """Indices (start, end) of the longest run with |curvature| < 1/400 m."""
    n = len(curv)
    straight = np.abs(curv) < 1.0 / 400.0
    best, cur_start, cur_len, best_start, best_len = None, None, 0, 0, 0
    # walk twice to handle wrap-around
    for i in range(2 * n):
        if straight[i % n]:
            if cur_start is None:
                cur_start = i
            cur_len = i - cur_start + 1
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            cur_start = None
    best = (best_start % n, (best_start + min(best_len, n) - 1) % n)
    return best


def build_layout(center: np.ndarray, grid: int, pit_side_right: bool, width: float, sf_point: np.ndarray | None = None) -> tuple[dict, tuple[int, int]]:
    t, left, curv = frames(center)
    n = len(center)
    step = float(np.linalg.norm(center[1] - center[0]))
    if sf_point is not None:
        # start/finish forced to the station nearest to the given (east, north) point
        sf = int(np.argmin(np.linalg.norm(center - sf_point, axis=1)))
    else:
        s0, s1 = longest_straight(curv, np.array([step * i for i in range(n)]))
        run = (s1 - s0) % n
        # start/finish line at 62 % of the longest straight, grid behind it
        sf = (s0 + int(run * 0.62)) % n

    def idx_back(i: int, metres: float) -> int:
        return (i - int(round(metres / step))) % n

    def pose(i: int, lateral: float, y: float = 0.0) -> dict:
        p = center[i] + left[i] * lateral
        heading = math.degrees(math.atan2(t[i][1], t[i][0]))  # 0 = east, CCW positive (Blender convention)
        return {"pos_ac": [float(p[0]), y, float(-p[1])], "dir_en": [float(t[i][0]), float(t[i][1])], "heading_deg_blender": heading}

    layout: dict = {"AC_START": [], "AC_PIT": [], "AC_TIME": [], "AC_HOTLAP_START": [], "AC_CREW": []}
    for k in range(grid):
        row, col = divmod(k, 2)
        i = idx_back(sf, 12.0 + row * 8.0 + col * 4.0)
        layout["AC_START"].append(pose(i, (1.0 if col == 0 else -1.0) * (width / 4.0)))

    pit_sign = -1.0 if pit_side_right else 1.0
    pit_lat = pit_sign * (width / 2.0 + 1.2 + 5.0)  # middle of the pit apron
    # pit boxes start 10 m after the start/finish line, 6 m apart, beside the track on the pit side
    pit_zone_start = (sf + int(round(10.0 / step))) % n
    for k in range(grid):
        i = (pit_zone_start + int(round((k * 6.0) / step))) % n
        layout["AC_PIT"].append(pose(i, pit_lat))
        layout["AC_CREW"].append(pose(i, pit_lat + pit_sign * 4.0))
    pit_zone = ((pit_zone_start - int(8 / step)) % n, (pit_zone_start + int(round((grid * 6.0 + 10.0) / step))) % n)

    half_w = width / 2.0 + 1.0
    for sector, i in enumerate((sf, (sf + n // 3) % n, (sf + 2 * n // 3) % n)):
        layout["AC_TIME"].append({"index": sector, "L": pose(i, half_w), "R": pose(i, -half_w)})
    layout["AC_HOTLAP_START"].append(pose(idx_back(sf, 180.0), 0.0))
    layout["start_finish_index"] = int(sf)
    layout["pit_side"] = "right" if pit_side_right else "left"
    return layout, pit_zone


# ----------------------------------------------------------------------------- cameras, map, ui images
def write_cameras(path: str, center: np.ndarray, count: int = 8) -> None:
    t, left, curv = frames(center)
    n = len(center)
    # pick camera spots at the sharpest corners, spread around the lap
    lines = ["[HEADER]", "VERSION=2", "SET_NAME=Default", f"CAMERA_COUNT={count}", ""]
    chunk = n // count
    for c in range(count):
        seg = slice(c * chunk, (c + 1) * chunk)
        local = int(np.argmax(np.abs(curv[seg]))) + c * chunk
        outside = -np.sign(curv[local]) if curv[local] != 0 else 1.0
        cam = center[local] + left[local] * outside * 22.0
        look = center[(local + 15) % n]
        fwd = np.array([look[0] - cam[0], -5.0, -(look[1] - cam[1])])
        fwd /= np.linalg.norm(fwd)
        lines += [
            f"[CAMERA_{c}]",
            f"NAME=CAM_{c}",
            f"POSITION={cam[0]:.3f},6.000,{-cam[1]:.3f}",
            f"FORWARD={fwd[0]:.4f},{fwd[1]:.4f},{fwd[2]:.4f}",
            "UP=0,1,0",
            "MIN_FOV=8",
            "MAX_FOV=55",
            f"IN_POINT={c / count:.4f}",
            f"OUT_POINT={(c + 1) / count:.4f}",
            "SHADOW_SPLIT0=20",
            "SHADOW_SPLIT1=80",
            "SHADOW_SPLIT2=300",
            "NEAR_PLANE=0.5",
            "FAR_PLANE=5000",
            "MIN_EXPOSURE=0.3",
            "MAX_EXPOSURE=0.8",
            "DOF_FACTOR=0",
            "DOF_RANGE=1000",
            "DOF_FOCUS=0",
            "DOF_MANUAL=0",
            "SPLINE=0",
            "SPLINE_ANIMATION_LENGTH=0",
            "IS_FIXED=0",
            "",
        ]
    with open(path, "w") as f:
        f.write("\n".join(lines))


def write_map(track_dir: str, center: np.ndarray, width: float) -> None:
    """map.png + data/map.ini. AC maps world (x, z) to pixels with (x + X_OFFSET) / SCALE_FACTOR."""
    size, margin = 1024, 20
    ac = to_ac(center)
    x, z = ac[:, 0], ac[:, 2]
    ext = max(x.max() - x.min(), z.max() - z.min())
    scale = ext / (size - 2 * margin)
    x_off = -x.min() + margin * scale
    z_off = -z.min() + margin * scale
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = [((xx + x_off) / scale, (zz + z_off) / scale) for xx, zz in zip(x, z)]
    d.line(pts + pts[:1], fill=(255, 255, 255, 255), width=max(3, int(width / scale)), joint="curve")
    img.save(os.path.join(track_dir, "map.png"))
    with open(os.path.join(track_dir, "data", "map.ini"), "w") as f:
        f.write(
            "[PARAMETERS]\n"
            f"WIDTH={size}\nHEIGHT={size}\nMARGIN={margin}\n"
            f"SCALE_FACTOR={scale:.6f}\nMAX_SIZE=1600\n"
            f"X_OFFSET={x_off:.3f}\nZ_OFFSET={z_off:.3f}\nDRAWING_SIZE=10\n"
        )
    # ui/outline.png (transparent, white line) and ui/preview.png (green background)
    outline = Image.new("RGBA", (800, 600), (0, 0, 0, 0))
    o = ImageDraw.Draw(outline)
    ext2 = max(x.max() - x.min(), z.max() - z.min())
    sc = ext2 / 520.0
    pts2 = [(((xx - x.min()) / sc) + 140, ((zz - z.min()) / sc) + 40) for xx, zz in zip(x, z)]
    o.line(pts2 + pts2[:1], fill=(255, 255, 255, 255), width=10, joint="curve")
    outline.save(os.path.join(track_dir, "ui", "outline.png"))
    preview = Image.new("RGB", (1022, 576), (62, 108, 48))
    p = ImageDraw.Draw(preview)
    sc = ext2 / 480.0
    pts3 = [(((xx - x.min()) / sc) + 260, ((zz - z.min()) / sc) + 48) for xx, zz in zip(x, z)]
    # draw the road as overlapping discs so bends stay smooth, then a thin centre line
    for px, py in pts3:
        p.ellipse([px - 11, py - 11, px + 11, py + 11], fill=(40, 40, 42))
    p.line(pts3 + pts3[:1], fill=(230, 230, 230), width=2)
    preview.save(os.path.join(track_dir, "ui", "preview.png"))


# ----------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", default="sosnova")
    ap.add_argument("--width", type=float, default=12.0, help="road width in metres")
    ap.add_argument("--grid", type=int, default=16, help="number of start/pit positions")
    ap.add_argument("--step", type=float, default=2.0, help="mesh resolution along the track (m)")
    ap.add_argument("--smooth", type=float, default=6.0, help="smoothing sigma in metres")
    ap.add_argument("--pit-left", action="store_true", help="put the pits on the left instead of right")
    ap.add_argument("--kerb-radius", type=float, default=60.0, help="corners tighter than this radius (m) get kerbs")
    ap.add_argument("--sf-at-first-point", action="store_true", help="start/finish at the first centerline point instead of the longest straight")
    ap.add_argument("--centerline", default=os.path.join(KIT, "source", "centerline.json"))
    a = ap.parse_args()

    global KERB_RADIUS
    KERB_RADIUS = a.kerb_radius
    src_dir = os.path.join(KIT, "source")
    track_dir = os.path.join(KIT, "content", "tracks", a.track)
    for sub in ("data", "ui", "ai", "extension"):
        os.makedirs(os.path.join(track_dir, sub), exist_ok=True)

    with open(a.centerline, encoding="utf-8") as f:
        src = json.load(f)
    en, (lat0, lon0) = project(src["points"])
    sf_point = en[0].copy() if a.sf_at_first_point else None
    en = resample_closed(en, 1.0)
    en = smooth_closed(en, a.smooth)
    en = resample_closed(en, a.step)
    en = ensure_ccw(en)
    length = float(np.sum(np.linalg.norm(np.diff(np.vstack([en, en[:1]]), axis=0), axis=1)))
    print(f"centerline: {len(en)} stations, lap length {length:.0f} m, centre {lat0:.5f},{lon0:.5f}")

    layout, pit_zone = build_layout(en, a.grid, not a.pit_left, a.width, sf_point)
    info = build_mesh(en, a.width, not a.pit_left, pit_zone, src_dir, a.track)
    layout["meta"] = {"track": a.track, "length_m": round(length), "width_m": a.width, "geotag": [lat0, lon0], "stations": len(en), "kerb_segments": [info["kerb_left"], info["kerb_right"]]}
    with open(os.path.join(src_dir, "layout.json"), "w") as f:
        json.dump(layout, f, indent=1)
    write_cameras(os.path.join(track_dir, "data", "cameras.ini"), en)
    write_map(track_dir, en, a.width)
    # keep ui_track.json in sync with the real geometry
    ui_path = os.path.join(track_dir, "ui", "ui_track.json")
    if os.path.exists(ui_path):
        with open(ui_path, encoding="utf-8") as f:
            ui = json.load(f)
        ui.update({"geotags": [f"{lat0:.5f}", f"{lon0:.5f}"], "length": str(round(length)), "width": str(int(a.width)), "pitboxes": str(a.grid)})
        with open(ui_path, "w", encoding="utf-8") as f:
            json.dump(ui, f, indent=2, ensure_ascii=False)
    print(f"wrote {src_dir}/{a.track}.obj, layout.json, cameras.ini, map.png, map.ini, outline.png, preview.png")
    print(f"start/finish at station {layout['start_finish_index']}, pits on the {layout['pit_side']}, {a.grid} grid slots")


if __name__ == "__main__":
    main()
