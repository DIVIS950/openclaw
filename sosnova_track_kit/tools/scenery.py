"""Scenery derived from the north-up aerial image: cleaned ground texture, asphalt/gravel/grass
physics zones, real road edges, cone chicanes, buildings and trees.

Used by build_track.py when source/trace/aerial.png and source/centerline.json (with
scale_m_per_px + image_center) exist. Everything is in AC world space: x east, y up, z = -north.
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from skimage.measure import label, regionprops
from skimage.restoration import inpaint_biharmonic


class Aerial:
    """Pixel <-> world mapping for a north-up image with a known scale (m/px) and centre."""

    def __init__(self, path: str, scale: float, lat0: float, lon0: float):
        self.img = np.asarray(Image.open(path).convert("RGB")).astype(float) / 255.0
        self.h, self.w = self.img.shape[:2]
        self.scale, self.lat0, self.lon0 = scale, lat0, lon0
        self.cx, self.cy = self.w / 2.0, self.h / 2.0
        r, g, b = self.img[..., 0], self.img[..., 1], self.img[..., 2]
        self.red = (r > 0.62) & (g < 0.45) & (b < 0.45) & (r - g > 0.28)
        self.yellow = (r > 0.75) & (g > 0.65) & (b < 0.45) & (r - b > 0.4)
        self.blue = (b > 0.6) & (r < 0.35) & (g < 0.5) & (b - r > 0.3)
        self.overlay = ndi.binary_dilation(self.red | self.yellow | self.blue, iterations=3)
        self.exclude = np.zeros((self.h, self.w), dtype=bool)  # text/label boxes, set by clean_texture

    # --- coordinate helpers -------------------------------------------------------------
    def px_to_en(self, px: np.ndarray) -> np.ndarray:
        return np.column_stack([(px[:, 0] - self.cx) * self.scale, -(px[:, 1] - self.cy) * self.scale])

    def en_to_px(self, en: np.ndarray) -> np.ndarray:
        return np.column_stack([en[:, 0] / self.scale + self.cx, -en[:, 1] / self.scale + self.cy])

    def en_to_ac(self, en: np.ndarray, y: float = 0.0) -> np.ndarray:
        return np.column_stack([en[:, 0], np.full(len(en), y), -en[:, 1]])

    def uv(self, px: np.ndarray) -> np.ndarray:
        return np.column_stack([px[:, 0] / self.w, 1.0 - px[:, 1] / self.h])

    # --- pixel classes --------------------------------------------------------------------
    def classes(self) -> dict[str, np.ndarray]:
        if hasattr(self, "_classes"):
            return self._classes
        im = ndi.median_filter(self.img, size=(3, 3, 1))  # calm the JPEG noise before thresholding
        r, g, b = im[..., 0], im[..., 1], im[..., 2]
        mx, mn = im.max(-1), im.min(-1)
        sat, bri = mx - mn, im.mean(-1)
        # asphalt: neutral grey, not greenish (grass) and not yellowish (dry grass / gravel)
        asphalt = (sat < 0.09) & (bri > 0.25) & (bri < 0.70) & (g - r < 0.025) & (r - b < 0.08)
        asphalt = ndi.binary_closing(ndi.binary_opening(asphalt, iterations=1), iterations=2)
        asphalt |= self.overlay  # the route was drawn on asphalt
        roof = (sat < 0.16) & (bri >= 0.72) & ~self.exclude  # map labels are white too
        sand = (r > g) & (g > b) & (r - b > 0.16) & (bri > 0.42) & ~self.overlay & ~asphalt
        tree = (g > r + 0.03) & (g > b + 0.08) & (bri < 0.40) & ~self.exclude
        self._classes = {"asphalt": asphalt, "roof": roof, "sand": sand, "tree": tree}
        return self._classes

    # --- cleaned texture ----------------------------------------------------------------
    def clean_texture(self, out_path: str, extra_boxes: list[tuple[int, int, int, int]], upscale: int = 2) -> None:
        """Inpaint the drawn route/dots/text, upscale a little and save as the ground texture."""
        clean = self.img.copy()
        # 1) inpaint the drawn route / dots / arrows
        mask = self.overlay.copy()
        small, msk = clean[::2, ::2], mask[::2, ::2]
        filled = inpaint_biharmonic(small, msk, channel_axis=-1)
        up = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).resize((self.w, self.h), Image.BILINEAR)) / 255.0
        clean[mask] = up[mask]
        # 2) text/label boxes. Small ones are inpainted; big ones are filled with random crops of a
        #    plain terrain patch (given as the optional second rectangle), feathered so no seams show.
        rng = np.random.default_rng(11)
        small_mask = np.zeros((self.h, self.w), dtype=bool)
        for box in extra_boxes:
            x0, y0, x1, y1 = box[:4]
            self.exclude[y0:y1, x0:x1] = True
            if len(box) < 8:
                small_mask[y0:y1, x0:x1] = True
                continue
            sx0, sy0, sx1, sy1 = box[4:8]
            patch = clean[sy0:sy1, sx0:sx1]
            ph, pw = patch.shape[:2]
            tile = 24
            acc = np.zeros((y1 - y0, x1 - x0, 3))
            wgt = np.zeros((y1 - y0, x1 - x0, 1))
            yy, xx = np.mgrid[0:tile * 2, 0:tile * 2]
            feather = (np.sin(np.pi * (yy + 0.5) / (tile * 2)) * np.sin(np.pi * (xx + 0.5) / (tile * 2)))[..., None]
            for ty in range(-tile, y1 - y0, tile):
                for tx in range(-tile, x1 - x0, tile):
                    py, px = rng.integers(0, max(ph - 2 * tile, 1)), rng.integers(0, max(pw - 2 * tile, 1))
                    crop = patch[py:py + 2 * tile, px:px + 2 * tile]
                    ch, cw = crop.shape[:2]
                    ya, xa = max(ty, 0), max(tx, 0)
                    yb, xb = min(ty + ch, y1 - y0), min(tx + cw, x1 - x0)
                    if yb <= ya or xb <= xa:
                        continue
                    acc[ya:yb, xa:xb] += crop[ya - ty:yb - ty, xa - tx:xb - tx] * feather[ya - ty:yb - ty, xa - tx:xb - tx]
                    wgt[ya:yb, xa:xb] += feather[ya - ty:yb - ty, xa - tx:xb - tx]
            clean[y0:y1, x0:x1] = acc / np.maximum(wgt, 1e-6)
        if small_mask.any():
            small, msk = clean[::2, ::2], small_mask[::2, ::2]
            filled = inpaint_biharmonic(small, msk, channel_axis=-1)
            up = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).resize((self.w, self.h), Image.BILINEAR)) / 255.0
            clean[small_mask] = up[small_mask]
        img = Image.fromarray((clean * 255).astype(np.uint8))
        img = img.resize((self.w * upscale, self.h * upscale), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.5, 60, 2))
        img.save(out_path)
        self.clean = clean

    # --- road edges -----------------------------------------------------------------------
    def road_edges(self, center_en: np.ndarray, left_en: np.ndarray, min_m: float = 2.5, max_m: float = 14.0) -> tuple[np.ndarray, np.ndarray]:
        """Distance (m) from the traced centre to the asphalt edge on the left and right of each station."""
        ok = self.classes()["asphalt"]
        n = len(center_en)
        step_px = 1.0
        max_px = int(max_m / self.scale)
        wl, wr = np.zeros(n), np.zeros(n)
        for i in range(n):
            for sign, arr in ((1.0, wl), (-1.0, wr)):
                d, gap = 0, 0
                while d < max_px:
                    p = center_en[i] + sign * left_en[i] * (d + 1) * self.scale * step_px
                    px = self.en_to_px(p[None])[0]
                    xi, yi = int(round(px[0])), int(round(px[1]))
                    if not (0 <= xi < self.w and 0 <= yi < self.h):
                        break
                    if ok[yi, xi]:
                        gap = 0
                    else:
                        gap += 1
                        if gap > 3:
                            d -= gap - 1
                            break
                    d += 1
                arr[i] = max(d, 0) * self.scale
        # robust smoothing along the lap (circular): median then gaussian
        def smooth(a: np.ndarray) -> np.ndarray:
            k = 15
            pad = np.concatenate([a[-k:], a, a[:k]])
            med = ndi.median_filter(pad, size=k, mode="wrap")[k:-k]
            pad = np.concatenate([med[-k:], med, med[:k]])
            return ndi.gaussian_filter1d(pad, 4)[k:-k]
        return np.clip(smooth(wl), min_m, max_m), np.clip(smooth(wr), min_m, max_m)

    # --- ground grid --------------------------------------------------------------------
    def ground(self, obj, cell_px: int = 4, y: float = -0.02, near_track: np.ndarray | None = None) -> None:
        cls = self.classes()
        asphalt = ndi.binary_closing(cls["asphalt"] | cls["roof"], iterations=2)
        sand = cls["sand"] & ~asphalt
        if near_track is not None:
            sand &= near_track  # gravel run-off only near the track; tan areas further away are dry grass
        nx, ny = self.w // cell_px, self.h // cell_px
        xs = np.arange(nx + 1) * cell_px
        ys = np.arange(ny + 1) * cell_px
        # one shared vertex grid; faces are grouped into objects by class
        vidx = np.zeros((ny + 1, nx + 1), dtype=int)
        for j, py in enumerate(ys):
            for i, px in enumerate(xs):
                en = self.px_to_en(np.array([[px, py]], float))[0]
                vidx[j, i] = obj.add_vertex((en[0], y, -en[1]), (px / self.w, 1.0 - py / self.h))
        groups: dict[str, list] = {"1ROAD_paddock": [], "1SAND_runoff": [], "1GRASS_ground": []}
        for j in range(ny):
            for i in range(nx):
                block_a = asphalt[j * cell_px:(j + 1) * cell_px, i * cell_px:(i + 1) * cell_px].mean()
                block_s = sand[j * cell_px:(j + 1) * cell_px, i * cell_px:(i + 1) * cell_px].mean()
                name = "1ROAD_paddock" if block_a > 0.5 else "1SAND_runoff" if block_s > 0.5 else "1GRASS_ground"
                # CCW from above in (east, north): py grows southwards, so order (j+1) row first
                groups[name].append((vidx[j + 1, i], vidx[j + 1, i + 1], vidx[j, i + 1], vidx[j, i]))
        for name, faces in groups.items():
            if faces:
                obj.add_faces(name, "aerial", faces)

    def outer_ring(self, obj, margin_m: float, y: float = -0.02, wall_h: float = 2.0) -> None:
        """Plain grass ring around the aerial image plus perimeter walls."""
        half_w, half_h = self.cx * self.scale, self.cy * self.scale
        ox, oy = half_w + margin_m, half_h + margin_m
        inner = [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]
        outer = [(-ox, -oy), (ox, -oy), (ox, oy), (-ox, oy)]
        vi = [obj.add_vertex((e, y, -n), (e / 15, n / 15)) for e, n in inner]
        vo = [obj.add_vertex((e, y, -n), (e / 15, n / 15)) for e, n in outer]
        faces = []
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((vi[k], vo[k], vo[k2], vi[k2]))  # CCW from above
        obj.add_faces("1GRASS_outer", "grass", faces)
        for k in range(4):
            (xa, ya), (xb, yb) = outer[k], outer[(k + 1) % 4]
            length = math.hypot(xb - xa, yb - ya)
            v0 = obj.add_vertex((xa, y, -ya), (0, 0), (0, 0, 1))
            v1 = obj.add_vertex((xb, y, -yb), (length / 4, 0), (0, 0, 1))
            v2 = obj.add_vertex((xb, wall_h, -yb), (length / 4, 1), (0, 0, 1))
            v3 = obj.add_vertex((xa, wall_h, -ya), (0, 1), (0, 0, 1))
            obj.add_faces(f"1WALL_perimeter_{k}", "wall", [(v0, v3, v2, v1)])

    # --- cones ----------------------------------------------------------------------------
    def cones(self, obj) -> list[list[float]]:
        lab = label(ndi.binary_opening(self.yellow, iterations=1))
        pts = []
        for rp in regionprops(lab):
            if 12 <= rp.area <= 400:
                cy, cx = rp.centroid
                pts.append(self.px_to_en(np.array([[cx, cy]], float))[0])
        for k, en in enumerate(pts):
            x, z = en[0], -en[1]
            self._cone(obj, f"AC_POBJECT_CONE_{k}", x, z)
        return [[float(p[0]), float(p[1])] for p in pts]

    @staticmethod
    def _cone(obj, name: str, x: float, z: float, h: float = 0.55, r: float = 0.18, sides: int = 8) -> None:
        top = obj.add_vertex((x, h, z), (0.5, 1.0))
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(obj.add_vertex((x + r * math.cos(a), 0.0, z + r * math.sin(a)), (k / sides, 0.0), (math.cos(a), 0.3, math.sin(a))))
        base = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            base.append(obj.add_vertex((x + 1.5 * r * math.cos(a), 0.02, z + 1.5 * r * math.sin(a)), (k / sides, 0.02)))
        faces = []
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((ring[k2], ring[k], top))  # outward facing: ring goes CCW seen from +Y
            faces.append((base[k], base[k2], ring[k2], ring[k]))
        faces.append(tuple(reversed(base)))
        obj.add_faces(name, "cone", faces)

    # --- buildings ------------------------------------------------------------------------
    def buildings(self, obj, min_area_m2: float = 40.0) -> int:
        cls = self.classes()
        roof = ndi.binary_opening(cls["roof"], iterations=2)
        lab = label(roof)
        count = 0
        for rp in regionprops(lab):
            area_m2 = rp.area * self.scale ** 2
            if area_m2 < min_area_m2:
                continue
            # oriented rectangle from the region's principal axes
            coords = rp.coords[:, ::-1].astype(float)  # x, y
            c = coords.mean(0)
            u, s, vt = np.linalg.svd(coords - c, full_matrices=False)
            axes = vt
            proj = (coords - c) @ axes.T
            lo, hi = proj.min(0), proj.max(0)
            side_a, side_b = (hi - lo) * self.scale
            fill = rp.area / max((hi[0] - lo[0]) * (hi[1] - lo[1]), 1.0)
            # a roof fills its oriented rectangle and is not a thin strip (white kerbs, run-off bands)
            if fill < 0.55 or min(side_a, side_b) < 4.0:
                continue
            corners_px = np.array([c + lo[0] * axes[0] + lo[1] * axes[1], c + hi[0] * axes[0] + lo[1] * axes[1],
                                   c + hi[0] * axes[0] + hi[1] * axes[1], c + lo[0] * axes[0] + hi[1] * axes[1]])
            en = self.px_to_en(corners_px)
            # make the footprint CCW in (east, north)
            if 0.5 * np.sum(en[:, 0] * np.roll(en[:, 1], -1) - np.roll(en[:, 0], -1) * en[:, 1]) < 0:
                en, corners_px = en[::-1], corners_px[::-1]
            height = 8.0 if area_m2 > 600 else 4.5
            uvs = self.uv(corners_px)
            bottom = [obj.add_vertex((e, 0.0, -n), (uv[0], uv[1])) for (e, n), uv in zip(en, uvs)]
            top = [obj.add_vertex((e, height, -n), (uv[0], uv[1])) for (e, n), uv in zip(en, uvs)]
            faces_roof = [tuple(top)]
            faces_wall = []
            for k in range(4):
                k2 = (k + 1) % 4
                length = math.hypot(*(en[k2] - en[k]))
                wb0 = obj.add_vertex((en[k][0], 0.0, -en[k][1]), (0, 0))
                wb1 = obj.add_vertex((en[k2][0], 0.0, -en[k2][1]), (length / 4, 0))
                wt1 = obj.add_vertex((en[k2][0], height, -en[k2][1]), (length / 4, height / 4))
                wt0 = obj.add_vertex((en[k][0], height, -en[k][1]), (0, height / 4))
                faces_wall.append((wb0, wb1, wt1, wt0))  # outward for a CCW footprint
            obj.add_faces(f"1WALL_building_{count}", "building", faces_wall)
            obj.add_faces(f"ROOF_building_{count}", "aerial", faces_roof)
            count += 1
        return count

    # --- trees ------------------------------------------------------------------------------
    def trees(self, obj, spacing_m: float = 6.0, height: float = 8.0, exclude_px: np.ndarray | None = None) -> int:
        cls = self.classes()
        mask = ndi.binary_opening(cls["tree"], iterations=2)
        if exclude_px is not None:
            mask &= ~exclude_px
        sp = max(int(spacing_m / self.scale), 2)
        rng = np.random.default_rng(3)
        pts = []
        for py in range(sp // 2, self.h, sp):
            for px in range(sp // 2, self.w, sp):
                jx, jy = rng.integers(-sp // 3, sp // 3 + 1, 2)
                x, y = min(max(px + jx, 0), self.w - 1), min(max(py + jy, 0), self.h - 1)
                if mask[y, x]:
                    pts.append((x, y))
        en = self.px_to_en(np.array(pts, float)) if pts else np.zeros((0, 2))
        faces = []
        for k, (e, n) in enumerate(en):
            hgt = height * rng.uniform(0.8, 1.25)
            half = hgt * 0.38
            x, z = e, -n
            for ang in (0.0, math.pi / 2):
                dx, dz = math.cos(ang) * half, math.sin(ang) * half
                v0 = obj.add_vertex((x - dx, 0.0, z - dz), (0, 0), (-math.sin(ang), 0, math.cos(ang)))
                v1 = obj.add_vertex((x + dx, 0.0, z + dz), (1, 0), (-math.sin(ang), 0, math.cos(ang)))
                v2 = obj.add_vertex((x + dx, hgt, z + dz), (1, 1), (-math.sin(ang), 0, math.cos(ang)))
                v3 = obj.add_vertex((x - dx, hgt, z - dz), (0, 1), (-math.sin(ang), 0, math.cos(ang)))
                faces.append((v0, v1, v2, v3))
            if len(faces) >= 2 * 120:  # keep objects small
                obj.add_faces(f"TREES_{k // 120:02d}", "tree", faces)
                faces = []
        if faces:
            obj.add_faces(f"TREES_{len(en) // 120:02d}", "tree", faces)
        return len(en)


def make_scenery_textures(folder: str) -> None:
    """Cone, building wall and tree billboard textures (procedural placeholders)."""
    cone = Image.new("RGB", (64, 128), (235, 90, 20))
    d = ImageDraw.Draw(cone)
    d.rectangle([0, 40, 64, 60], fill=(240, 240, 240))
    d.rectangle([0, 80, 64, 96], fill=(240, 240, 240))
    cone.save(os.path.join(folder, "cone.png"))
    wall = Image.new("RGB", (256, 256), (200, 198, 192))
    d = ImageDraw.Draw(wall)
    for yy in range(0, 256, 32):
        d.line([(0, yy), (256, yy)], fill=(170, 168, 162), width=2)
    for xx in range(0, 256, 64):
        d.rectangle([xx + 16, 120, xx + 48, 200], fill=(70, 90, 110))  # windows
    wall.save(os.path.join(folder, "building.png"))
    # tree billboard with alpha: trunk + noisy canopy
    tree = Image.new("RGBA", (256, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(tree)
    d.rectangle([116, 330, 140, 512], fill=(80, 60, 40, 255))
    rng = np.random.default_rng(5)
    for _ in range(260):
        cx, cy = rng.normal(128, 45), rng.normal(200, 85)
        rad = rng.uniform(14, 34)
        shade = int(rng.uniform(45, 110))
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(shade // 2 + 10, shade, shade // 3 + 10, 255))
    tree.save(os.path.join(folder, "tree.png"))
