"""Track furniture that delimits the lap on the open paddock asphalt: barrier tape on posts, plastic
barriers at junction mouths, tyre stacks at the chicanes and a start/finish gantry. Also the
realistic tiling asphalt texture.

All positions are derived from the lap line and the orthophoto classes: wherever asphalt continues
beyond the lap's edge (a junction, the paddock), the edge gets a delimiter; natural asphalt edges
against grass get nothing. The pit side of the start straight stays open so cars can leave the pits.
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi


# ----------------------------------------------------------------------------- where is the lap open?
def open_edges(scenery, center: np.ndarray, left: np.ndarray, wl: np.ndarray, wr: np.ndarray,
               probe_m=(2.0, 4.0, 7.0), skip: dict | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Boolean per station for the left/right edge: True where asphalt continues beyond the lap edge."""
    asphalt = scenery.classes()["asphalt"]
    n = len(center)
    out = []
    for sign, w in ((1.0, wl), (-1.0, wr)):
        flags = np.zeros(n, dtype=bool)
        for d in probe_m:
            p = center + sign * left * (w + d)[:, None]
            px = scenery.en_to_px(p).astype(int)
            inside = (px[:, 0] >= 0) & (px[:, 0] < scenery.w) & (px[:, 1] >= 0) & (px[:, 1] < scenery.h)
            hit = np.zeros(n, dtype=bool)
            hit[inside] = asphalt[px[inside, 1], px[inside, 0]]
            flags |= hit
        # smooth: close 3 m gaps, drop runs shorter than 6 m
        flags = ndi.binary_closing(flags, iterations=3)
        flags = ndi.binary_opening(flags, iterations=3)
        out.append(flags)
    fl, fr = out
    if skip:
        side = fl if skip["side"] == "left" else fr
        a, b = skip["range"]
        if a <= b:
            side[a:b] = False
        else:
            side[a:] = False
            side[:b] = False
    return fl, fr


def runs(flags: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) index pairs of True runs on a circular array (end exclusive, may wrap)."""
    n = len(flags)
    if flags.all():
        return [(0, n)]
    if not flags.any():
        return []
    start = int(np.argmin(flags))  # begin at a False so runs do not split at index 0
    rolled = np.roll(flags, -start)
    res, i = [], 0
    while i < n:
        if rolled[i]:
            j = i
            while j < n and rolled[j]:
                j += 1
            res.append(((i + start) % n, (j + start) % n))
            i = j
        else:
            i += 1
    return res


def run_indices(a: int, b: int, n: int) -> list[int]:
    return list(range(a, b)) if a < b else list(range(a, n)) + list(range(0, b))


# ----------------------------------------------------------------------------- mesh helpers
def box(obj, name: str, mat: str, c: np.ndarray, u: np.ndarray, length: float, width: float, height: float, base: float, uv_rep: float = 1.0) -> None:
    """Axis box: centre c (east, north), unit direction u along length, in AC space."""
    v = np.array([-u[1], u[0]])
    corners = [c + u * length / 2 + v * width / 2, c - u * length / 2 + v * width / 2,
               c - u * length / 2 - v * width / 2, c + u * length / 2 - v * width / 2]
    lo = [obj.add_vertex((p[0], base, -p[1]), (k * uv_rep, 0)) for k, p in enumerate(corners)]
    hi = [obj.add_vertex((p[0], base + height, -p[1]), (k * uv_rep, 1)) for k, p in enumerate(corners)]
    faces = [tuple(hi)]  # top (corners are CCW in east/north => normal up)
    for k in range(4):
        k2 = (k + 1) % 4
        faces.append((lo[k2], lo[k], hi[k], hi[k2]))  # outward side faces
    obj.add_faces(name, mat, faces)


def cylinder(obj, name: str, mat: str, x: float, z: float, base: float, r: float, h: float, sides: int = 10, uv_v_rep: float = 1.0) -> None:
    lo, hi = [], []
    for k in range(sides):
        a = 2 * math.pi * k / sides
        nx, nz = math.cos(a), math.sin(a)
        lo.append(obj.add_vertex((x + r * nx, base, z + r * nz), (k / sides * 3, 0), (nx, 0, nz)))
        hi.append(obj.add_vertex((x + r * nx, base + h, z + r * nz), (k / sides * 3, uv_v_rep), (nx, 0, nz)))
    faces = []
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((lo[k], lo[k2], hi[k2], hi[k]))
    faces.append(tuple(reversed(hi)))  # top cap facing up (ring in AC x/z goes clockwise seen from +y)
    obj.add_faces(name, mat, faces)


# ----------------------------------------------------------------------------- delimiters
def add_delimiters(obj, center: np.ndarray, left: np.ndarray, wl: np.ndarray, wr: np.ndarray, height_fn, fl: np.ndarray, fr: np.ndarray,
                   step: float, barrier_max_m: float = 24.0) -> dict:
    """Tape on posts along long open stretches, plastic barriers across short junction mouths."""
    n = len(center)
    counts = {"tape_m": 0.0, "posts": 0, "barriers": 0}
    tape_id = 0
    for sign, w, flags in ((1.0, wl, fl), (-1.0, wr, fr)):
        for a, b in runs(flags):
            idx = run_indices(a, b, n)
            length = len(idx) * step
            offs = sign * (w[idx] + 0.6)
            pts = center[idx] + left[idx] * offs[:, None]
            hts = height_fn(pts)
            if length <= barrier_max_m:
                # plastic barriers, 1.0 m long, 0.5 wide, 0.8 high, nose to tail
                k = 0
                d = 0.0
                while d + 1.0 <= length:
                    i0 = int(d / step)
                    i1 = min(int((d + 1.0) / step), len(idx) - 1)
                    c = (pts[i0] + pts[i1]) / 2
                    u = pts[i1] - pts[i0]
                    u = u / (np.linalg.norm(u) + 1e-9)
                    box(obj, f"1WALL_barrier_{counts['barriers']:03d}", "barrier", c, u, 1.0, 0.5, 0.8, float(min(hts[i0], hts[i1])) - 0.02)
                    counts["barriers"] += 1
                    d += 1.05
                    k += 1
            else:
                # posts every 4 m + a collidable tape wall (alpha texture: only the tape band is visible)
                for d in np.arange(0.0, length, 4.0):
                    i = min(int(d / step), len(idx) - 1)
                    cylinder(obj, f"POST_{counts['posts']:04d}", "post", pts[i][0], -pts[i][1], float(hts[i]) - 0.02, 0.035, 1.05, sides=6)
                    counts["posts"] += 1
                faces = []
                vs = [(obj.add_vertex((p[0], h + 0.3, -p[1]), (s_ / 4.0, 0.0)), obj.add_vertex((p[0], h + 1.0, -p[1]), (s_ / 4.0, 1.0)))
                      for s_, (p, h) in enumerate(zip(pts, hts))]
                for k in range(len(vs) - 1):
                    (a0, a1), (b0, b1) = vs[k], vs[k + 1]
                    faces.append((a0, b0, b1, a1))
                    faces.append((b0, a0, a1, b1))  # back face so it is visible from both sides
                obj.add_faces(f"1WALL_tape_{tape_id:03d}", "tape", faces)
                tape_id += 1
                counts["tape_m"] += length
    return counts


def add_tyre_stacks(obj, positions_en: np.ndarray, height_fn, name: str = "AC_POBJECT_TYRES") -> int:
    """Three-tyre stacks (0.66 m diameter, 0.78 m tall) at the chicane points, movable physics objects."""
    hts = height_fn(positions_en)
    for k, ((e, n_), h) in enumerate(zip(positions_en, hts)):
        cylinder(obj, f"{name}_{k:02d}", "tyre", e, -n_, float(h), 0.33, 0.78, sides=12, uv_v_rep=3.0)
    return len(positions_en)


def add_gantry(obj, center: np.ndarray, left: np.ndarray, wl: np.ndarray, wr: np.ndarray, height_fn, sf: int, step: float) -> None:
    """Start/finish gantry: two posts outside the asphalt and a beam with the timing banner."""
    i = (sf + int(round(1.0 / step))) % len(center)
    pl = center[i] + left[i] * (wl[i] + 1.5)
    pr = center[i] - left[i] * (wr[i] + 1.5)
    hl, hr = height_fn(np.array([pl, pr]))
    u = pr - pl
    span = float(np.linalg.norm(u))
    u = u / span
    top = max(hl, hr) + 6.0
    box(obj, "1WALL_gantry_postL", "gantry", pl, u, 0.4, 0.4, top - hl, float(hl) - 0.3)
    box(obj, "1WALL_gantry_postR", "gantry", pr, u, 0.4, 0.4, top - hr, float(hr) - 0.3)
    box(obj, "GANTRY_beam", "gantry", (pl + pr) / 2, u, span + 0.4, 0.5, 0.5, top)
    # banner hanging under the beam, facing both directions
    c = (pl + pr) / 2
    v = np.array([-u[1], u[0]])
    for side in (1.0, -1.0):
        cc = c + v * 0.26 * side
        a = cc - u * span / 2
        b = cc + u * span / 2
        v0 = obj.add_vertex((a[0], top - 1.1, -a[1]), (0, 0))
        v1 = obj.add_vertex((b[0], top - 1.1, -b[1]), (1, 0))
        v2 = obj.add_vertex((b[0], top, -b[1]), (1, 1))
        v3 = obj.add_vertex((a[0], top, -a[1]), (0, 1))
        obj.add_faces(f"GANTRY_banner_{'A' if side > 0 else 'B'}", "banner", [(v0, v1, v2, v3) if side > 0 else (v1, v0, v3, v2)])


# ----------------------------------------------------------------------------- textures
def _tileable_noise(size: int, sigma: float, rng) -> np.ndarray:
    n = rng.standard_normal((size, size))
    n = ndi.gaussian_filter(n, sigma, mode="wrap")
    return (n - n.mean()) / (n.std() + 1e-9)


def make_asphalt_texture(path: str, size: int = 2048, seed: int = 7, base_tone: float = 0.50) -> None:
    """Realistic tiling asphalt (one tile = 8 m), tone matched to the orthophoto (track surface measures
    about 0.56 grey in sunlight, slightly bluish). Aggregate grain, mild tone variation, faint worn bands,
    light stone speckles; low contrast so repeats are not visible at speed."""
    rng = np.random.default_rng(seed)
    base = base_tone + 0.025 * _tileable_noise(size, 110, rng) + 0.015 * _tileable_noise(size, 30, rng)
    grain = 0.06 * _tileable_noise(size, 1.1, rng) + 0.045 * _tileable_noise(size, 0.55, rng) + 0.025 * _tileable_noise(size, 3.0, rng)
    bands = 0.02 * np.tanh(_tileable_noise(size, 200, rng))  # faint darker worn bands (tyre tracks)
    patches = np.clip((_tileable_noise(size, 40, rng) - 1.6) * 0.08, 0, 0.05)  # small tar patches
    g = np.clip(base + grain - bands - patches, 0.08, 0.95)
    speck = rng.random((size, size)) > 0.999
    g[speck] = np.clip(g[speck] + 0.25, 0, 1)
    r, gch, b = g * 0.975, g * 0.995, g * 1.03  # cool grey like the photo
    img = (np.stack([r, gch, b], -1) * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(img).save(path)


def make_furniture_textures(folder: str) -> None:
    os.makedirs(folder, exist_ok=True)
    make_asphalt_texture(os.path.join(folder, "road.png"))
    # tape: transparent wall, red/white tape band in the top 15 %
    tape = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(tape)
    for x in range(0, 512, 64):
        col = (220, 30, 30, 255) if (x // 64) % 2 == 0 else (245, 245, 245, 255)
        d.rectangle([x, 8, x + 64, 44], fill=col)
    tape.save(os.path.join(folder, "tape.png"))
    post = Image.new("RGB", (64, 256), (235, 235, 235))
    d = ImageDraw.Draw(post)
    for y in range(0, 256, 64):
        d.rectangle([0, y, 64, y + 32], fill=(210, 30, 30))
    post.save(os.path.join(folder, "post.png"))
    barrier = Image.new("RGB", (256, 128), (215, 35, 30))
    d = ImageDraw.Draw(barrier)
    d.rectangle([64, 0, 128, 128], fill=(240, 240, 240))
    d.rectangle([192, 0, 256, 128], fill=(240, 240, 240))
    d.rectangle([0, 0, 256, 6], fill=(60, 60, 60))
    barrier.save(os.path.join(folder, "barrier.png"))
    tyre = Image.new("RGB", (256, 256), (28, 28, 30))
    d = ImageDraw.Draw(tyre)
    for y in (0, 85, 170):
        d.rectangle([0, y, 256, y + 6], fill=(10, 10, 10))
        d.rectangle([0, y + 30, 256, y + 50], fill=(235, 235, 235))
    tyre.save(os.path.join(folder, "tyre.png"))
    Image.new("RGB", (64, 64), (70, 72, 76)).save(os.path.join(folder, "gantry.png"))
    banner = Image.new("RGB", (1024, 128), (20, 20, 20))
    d = ImageDraw.Draw(banner)
    for x in range(0, 1024, 32):
        if (x // 32) % 2 == 0:
            d.rectangle([x, 0, x + 32, 16], fill=(240, 240, 240))
            d.rectangle([x + 16, 16, x + 48, 32], fill=(240, 240, 240))
    d.rectangle([0, 48, 1024, 112], fill=(200, 30, 30))
    d.text((430, 70), "START  /  FINISH", fill=(255, 255, 255))
    banner.save(os.path.join(folder, "banner.png"))
