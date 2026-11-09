"""Scenery derived from a north-up aerial image and (optionally) a LiDAR height grid:
ground texture, asphalt/gravel/grass physics zones, real road edges, cone chicanes, buildings,
trees and terrain heights.

Used by build_track.py. Everything is in AC world space: x east, y up, z = -north.
Two image sources are supported:
  * the layout screenshot (about 0.45 m/px, has drawn overlays that must be removed)
  * the ČÚZK orthophoto (0.125 m/px, clean) + DMR 5G heights (1 m grid)
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.measure import label, regionprops
from skimage.restoration import inpaint_biharmonic

Image.MAX_IMAGE_PIXELS = None


# ============================================================================ terrain
class Terrain:
    """Bilinear sampler over a float height raster that covers the same extent as the aerial image."""

    def __init__(self, tif_path: str, half_m: tuple[float, float], gsd: float):
        a = np.asarray(Image.open(tif_path), dtype=np.float32)
        a = np.where(a < -9000, np.nan, a)
        if np.isnan(a).any():  # fill no-data from neighbours
            idx = ndi.distance_transform_edt(np.isnan(a), return_distances=False, return_indices=True)
            a = a[tuple(idx)]
        # LiDAR noise is ~0.18 m; a 2 m Gaussian keeps the real relief and removes the pebbles.
        self.h = ndi.gaussian_filter(a, 2.0)
        self.rows, self.cols = a.shape
        self.half_e, self.half_n = half_m
        self.gsd = gsd
        self.ref = 0.0

    def sample_raw(self, en: np.ndarray) -> np.ndarray:
        """Heights (m a.s.l.) at (east, north) points, bilinear, clamped to the raster."""
        en = np.atleast_2d(en)
        px = (en[:, 0] + self.half_e) / self.gsd - 0.5
        py = (self.half_n - en[:, 1]) / self.gsd - 0.5
        px = np.clip(px, 0, self.cols - 1.001)
        py = np.clip(py, 0, self.rows - 1.001)
        x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
        fx, fy = px - x0, py - y0
        h = (self.h[y0, x0] * (1 - fx) * (1 - fy) + self.h[y0, x0 + 1] * fx * (1 - fy)
             + self.h[y0 + 1, x0] * (1 - fx) * fy + self.h[y0 + 1, x0 + 1] * fx * fy)
        return h

    def sample(self, en: np.ndarray) -> np.ndarray:
        return self.sample_raw(en) - self.ref


# ============================================================================ aerial image
class Aerial:
    """Pixel <-> world mapping for a north-up image with a known scale (m/px) and centre."""

    def __init__(self, path: str, scale: float, lat0: float, lon0: float, has_overlays: bool = True):
        self.img = np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255.0
        self.h, self.w = self.img.shape[:2]
        self.scale, self.lat0, self.lon0 = scale, lat0, lon0
        self.cx, self.cy = self.w / 2.0, self.h / 2.0
        self.has_overlays = has_overlays
        r, g, b = self.img[..., 0], self.img[..., 1], self.img[..., 2]
        if has_overlays:
            self.red = (r > 0.62) & (g < 0.45) & (b < 0.45) & (r - g > 0.28)
            self.yellow = (r > 0.75) & (g > 0.65) & (b < 0.45) & (r - b > 0.4)
            self.blue = (b > 0.6) & (r < 0.35) & (g < 0.5) & (b - r > 0.3)
            self.overlay = ndi.binary_dilation(self.red | self.yellow | self.blue, iterations=3)
        else:
            self.red = self.yellow = self.blue = self.overlay = np.zeros((self.h, self.w), dtype=bool)
        self.exclude = np.zeros((self.h, self.w), dtype=bool)
        self.terrain: Terrain | None = None
        self.clean = self.img

    # --- coordinate helpers -------------------------------------------------------------
    def px_to_en(self, px: np.ndarray) -> np.ndarray:
        px = np.atleast_2d(px)
        return np.column_stack([(px[:, 0] - self.cx) * self.scale, -(px[:, 1] - self.cy) * self.scale])

    def en_to_px(self, en: np.ndarray) -> np.ndarray:
        en = np.atleast_2d(en)
        return np.column_stack([en[:, 0] / self.scale + self.cx, -en[:, 1] / self.scale + self.cy])

    def uv(self, px: np.ndarray) -> np.ndarray:
        px = np.atleast_2d(px)
        return np.column_stack([px[:, 0] / self.w, 1.0 - px[:, 1] / self.h])

    def height(self, en: np.ndarray) -> np.ndarray:
        if self.terrain is None:
            return np.zeros(len(np.atleast_2d(en)))
        return self.terrain.sample(en)

    def ac(self, en: np.ndarray, dy: float = 0.0, y: float | np.ndarray | None = None) -> np.ndarray:
        """(east, north) -> AC (x, y, z). y defaults to terrain height + dy."""
        en = np.atleast_2d(en)
        yy = self.height(en) + dy if y is None else np.broadcast_to(np.asarray(y, float), (len(en),)) + dy
        return np.column_stack([en[:, 0], yy, -en[:, 1]])

    # --- pixel classes --------------------------------------------------------------------
    def classes(self) -> dict[str, np.ndarray]:
        if hasattr(self, "_classes"):
            return self._classes
        im = ndi.median_filter(self.img, size=(3, 3, 1)) if self.w * self.h < 3_000_000 else ndi.uniform_filter(self.img, size=(3, 3, 1))
        r, g, b = im[..., 0], im[..., 1], im[..., 2]
        mx, mn = im.max(-1), im.min(-1)
        sat, bri = mx - mn, im.mean(-1)
        # asphalt: neutral grey, not greenish (grass) and not yellowish (dry grass / gravel)
        if self.has_overlays:  # layout screenshot (JPEG-ish, warmer colours)
            asphalt = (sat < 0.09) & (bri > 0.25) & (bri < 0.70) & (g - r < 0.025) & (r - b < 0.08)
        else:  # ČÚZK orthophoto: asphalt is neutral/bluish grey (measured under the traced route)
            asphalt = (sat < 0.075) & (bri > 0.40) & (bri < 0.70) & (g - r < 0.035) & (r - b < 0.03)
        it = 1 if self.scale > 0.3 else max(1, int(0.5 / self.scale))
        asphalt = ndi.binary_closing(ndi.binary_opening(asphalt, iterations=it), iterations=2 * it)
        asphalt |= self.overlay  # the route was drawn on asphalt
        roof = (sat < 0.12) & (bri >= 0.72) & ~self.exclude
        sand = (r > g) & (g > b) & (r - b > 0.14) & (bri > 0.42) & ~self.overlay & ~asphalt
        tree = (g > r + 0.01) & (g > b + 0.04) & (bri < 0.42) & ~self.exclude & ~asphalt
        self._classes = {"asphalt": asphalt, "roof": roof, "sand": sand, "tree": tree}
        return self._classes

    # --- cleaned texture ----------------------------------------------------------------
    def clean_texture(self, out_path: str, extra_boxes: list[tuple] | None = None, max_width: int = 4096) -> None:
        """Remove drawn overlays / labels (screenshot source) and save the ground texture."""
        clean = self.img.copy()
        if self.has_overlays and self.overlay.any():
            small, msk = clean[::2, ::2], self.overlay[::2, ::2]
            filled = inpaint_biharmonic(small, msk, channel_axis=-1)
            up = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).resize((self.w, self.h), Image.BILINEAR)) / 255.0
            clean[self.overlay] = up[self.overlay]
        rng = np.random.default_rng(11)
        small_mask = np.zeros((self.h, self.w), dtype=bool)
        for box in extra_boxes or []:
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
        self.clean = clean
        img = Image.fromarray((np.clip(clean * 0.82, 0, 1) * 255).astype(np.uint8))  # tone down for AC's strong sun
        if img.width < max_width // 2:  # low-res source: upscale a little
            img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.5, 60, 2))
        elif img.width > max_width:
            img = img.resize((max_width, int(img.height * max_width / img.width)), Image.LANCZOS)
        if out_path.lower().endswith((".jpg", ".jpeg")):
            img.convert("RGB").save(out_path, quality=92, subsampling=0)
        else:
            img.save(out_path)

    # --- road edges -----------------------------------------------------------------------
    def road_edges(self, center_en: np.ndarray, left_en: np.ndarray, min_m: float = 2.5, max_m: float = 14.0) -> tuple[np.ndarray, np.ndarray]:
        """Distance (m) from the traced centre to the asphalt edge on the left and right of each station."""
        ok = self.classes()["asphalt"]
        n = len(center_en)
        step = self.scale  # scan one pixel at a time
        max_steps = int(max_m / step)
        gap_allow = max(3, int(1.0 / step))  # tolerate up to 1 m of non-asphalt (markings, shadows)
        wl, wr = np.zeros(n), np.zeros(n)
        for i in range(n):
            for sign, arr in ((1.0, wl), (-1.0, wr)):
                d, gap = 0, 0
                while d < max_steps:
                    p = center_en[i] + sign * left_en[i] * (d + 1) * step
                    px = self.en_to_px(p)[0]
                    xi, yi = int(round(px[0])), int(round(px[1]))
                    if not (0 <= xi < self.w and 0 <= yi < self.h):
                        break
                    if ok[yi, xi]:
                        gap = 0
                    else:
                        gap += 1
                        if gap > gap_allow:
                            d -= gap - 1
                            break
                    d += 1
                arr[i] = max(d, 0) * step

        def smooth(a: np.ndarray) -> np.ndarray:
            k = 15
            pad = np.concatenate([a[-k:], a, a[:k]])
            med = ndi.median_filter(pad, size=k, mode="wrap")[k:-k]
            pad = np.concatenate([med[-k:], med, med[:k]])
            return ndi.gaussian_filter1d(pad, 4)[k:-k]
        return np.clip(smooth(wl), min_m, max_m), np.clip(smooth(wr), min_m, max_m)

    # --- ground grid --------------------------------------------------------------------
    def ground(self, obj, cell_m: float = 2.0, surface=None, near_track: np.ndarray | None = None, skip_mask: np.ndarray | None = None) -> None:
        """Ground grid classified from the image. `surface(en)` returns (height, weight) so the ground
        can follow the road surface right next to the track and the terrain further away."""
        cls = self.classes()
        asphalt = ndi.binary_closing(cls["asphalt"] | cls["roof"], iterations=2)
        sand = cls["sand"] & ~asphalt
        if near_track is not None:
            sand &= near_track
        cell_px = max(int(round(cell_m / self.scale)), 1)
        nx, ny = self.w // cell_px, self.h // cell_px
        xs = np.arange(nx + 1) * cell_px
        ys = np.arange(ny + 1) * cell_px
        gx, gy = np.meshgrid(xs, ys)
        en = self.px_to_en(np.column_stack([gx.ravel(), gy.ravel()]).astype(float))
        hgt = self.height(en) - 0.02
        if surface is not None:
            hs, wgt = surface(en)
            hgt = wgt * (hs - 0.02) + (1 - wgt) * hgt
        vidx = np.zeros((ny + 1, nx + 1), dtype=int)
        k = 0
        for j in range(ny + 1):
            for i in range(nx + 1):
                vidx[j, i] = obj.add_vertex((en[k, 0], hgt[k], -en[k, 1]), (xs[i] / self.w, 1.0 - ys[j] / self.h))
                k += 1
        groups: dict[str, list] = {"1ROAD_paddock": [], "1SAND_runoff": [], "1GRASS_ground": []}
        a_cells = asphalt[:ny * cell_px, :nx * cell_px].reshape(ny, cell_px, nx, cell_px).mean(axis=(1, 3))
        k_cells = skip_mask[:ny * cell_px, :nx * cell_px].reshape(ny, cell_px, nx, cell_px).mean(axis=(1, 3)) if skip_mask is not None else np.zeros((ny, nx))
        s_cells = sand[:ny * cell_px, :nx * cell_px].reshape(ny, cell_px, nx, cell_px).mean(axis=(1, 3))
        for j in range(ny):
            for i in range(nx):
                if k_cells[j, i] > 0.98:
                    continue  # fully covered by the triangulated asphalt polygons
                name = "1ROAD_paddock" if a_cells[j, i] > 0.5 else "1SAND_runoff" if s_cells[j, i] > 0.5 else "1GRASS_ground"
                groups[name].append((vidx[j + 1, i], vidx[j + 1, i + 1], vidx[j, i + 1], vidx[j, i]))
        for name, faces in groups.items():
            # split big groups so no object exceeds the 65k vertex limit of AC
            chunk = 15000
            for c in range(0, len(faces), chunk):
                suffix = "" if c == 0 else f"_{c // chunk}"
                obj.add_faces(name + suffix, "aerial", faces[c:c + chunk])

    def outer_ring(self, obj, margin_m: float, wall_h: float = 2.0, draw_ring: bool = True, half_override: tuple[float, float] | None = None) -> None:
        """Plain grass ring around the aerial image plus perimeter walls, following the terrain edge heights.
        With draw_ring=False only the walls are written (used when the wide-area terrain exists)."""
        half_w, half_h = half_override if half_override else (self.cx * self.scale, self.cy * self.scale)
        ox, oy = half_w + margin_m, half_h + margin_m
        inner = [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]
        outer = [(-ox, -oy), (ox, -oy), (ox, oy), (-ox, oy)]
        # subdivide the ring edges so it can follow the terrain along the image border
        faces = []
        for k in range(4):
            k2 = (k + 1) % 4
            segs = 24
            prev = None
            for t in np.linspace(0, 1, segs + 1):
                pi = (inner[k][0] + (inner[k2][0] - inner[k][0]) * t, inner[k][1] + (inner[k2][1] - inner[k][1]) * t)
                po = (outer[k][0] + (outer[k2][0] - outer[k][0]) * t, outer[k][1] + (outer[k2][1] - outer[k][1]) * t)
                hi = float(self.height(np.array([pi]))[0]) - 0.02
                vi = obj.add_vertex((pi[0], hi, -pi[1]), (pi[0] / 15, pi[1] / 15))
                vo = obj.add_vertex((po[0], hi, -po[1]), (po[0] / 15, po[1] / 15))
                if prev is not None:
                    faces.append((prev[0], prev[1], vo, vi))
                prev = (vi, vo)
        if draw_ring:
            obj.add_faces("1GRASS_outer", "grass", faces)
        for k in range(4):
            (xa, ya), (xb, yb) = outer[k], outer[(k + 1) % 4]
            length = math.hypot(xb - xa, yb - ya)
            ha = float(self.height(np.array([inner[k]]))[0])
            hb = float(self.height(np.array([inner[(k + 1) % 4]]))[0])
            v0 = obj.add_vertex((xa, ha - 1.0, -ya), (0, 0), (0, 0, 1))
            v1 = obj.add_vertex((xb, hb - 1.0, -yb), (length / 4, 0), (0, 0, 1))
            v2 = obj.add_vertex((xb, hb + wall_h, -yb), (length / 4, 1), (0, 0, 1))
            v3 = obj.add_vertex((xa, ha + wall_h, -ya), (0, 1), (0, 0, 1))
            obj.add_faces(f"1WALL_perimeter_{k}", "wall", [(v0, v3, v2, v1)])

    # --- cones ----------------------------------------------------------------------------
    def cones(self, obj, positions_en: np.ndarray | None = None, surface=None) -> list[list[float]]:
        if positions_en is None:
            lab = label(ndi.binary_opening(self.yellow, iterations=1))
            pts = [self.px_to_en(np.array([[rp.centroid[1], rp.centroid[0]]], float))[0] for rp in regionprops(lab) if 12 <= rp.area <= 400]
            positions_en = np.array(pts) if pts else np.zeros((0, 2))
        for k, en in enumerate(positions_en):
            base = float(surface(np.array([en]))[0][0]) if surface is not None else float(self.height(np.array([en]))[0])
            self._cone(obj, f"AC_POBJECT_CONE_{k}", en[0], -en[1], base)
        return [[float(p[0]), float(p[1])] for p in positions_en]

    @staticmethod
    def _cone(obj, name: str, x: float, z: float, base: float, h: float = 0.55, r: float = 0.18, sides: int = 8) -> None:
        top = obj.add_vertex((x, base + h, z), (0.5, 1.0))
        ring, plate = [], []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(obj.add_vertex((x + r * math.cos(a), base, z + r * math.sin(a)), (k / sides, 0.0), (math.cos(a), 0.3, math.sin(a))))
            plate.append(obj.add_vertex((x + 1.5 * r * math.cos(a), base + 0.02, z + 1.5 * r * math.sin(a)), (k / sides, 0.02)))
        faces = []
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((ring[k2], ring[k], top))
            faces.append((plate[k], plate[k2], ring[k2], ring[k]))
        faces.append(tuple(reversed(plate)))
        obj.add_faces(name, "cone", faces)

    # --- buildings ------------------------------------------------------------------------
    def buildings(self, obj, min_area_m2: float = 40.0, exclude_px: np.ndarray | None = None) -> int:
        cls = self.classes()
        it = max(1, int(0.5 / self.scale))
        roof = ndi.binary_opening(cls["roof"], iterations=it)
        if exclude_px is not None:
            roof &= ~exclude_px  # bright run-off strips next to the track are not buildings
        lab = label(roof)
        count = 0
        for rp in regionprops(lab):
            area_m2 = rp.area * self.scale ** 2
            if area_m2 < min_area_m2:
                continue
            coords = rp.coords[:, ::-1].astype(float)
            c = coords.mean(0)
            _, _, vt = np.linalg.svd(coords - c, full_matrices=False)
            proj = (coords - c) @ vt.T
            lo, hi = proj.min(0), proj.max(0)
            side_a, side_b = (hi - lo) * self.scale
            fill = rp.area / max((hi[0] - lo[0]) * (hi[1] - lo[1]), 1.0)
            if fill < 0.55 or min(side_a, side_b) < 4.0:
                continue
            corners_px = np.array([c + lo[0] * vt[0] + lo[1] * vt[1], c + hi[0] * vt[0] + lo[1] * vt[1],
                                   c + hi[0] * vt[0] + hi[1] * vt[1], c + lo[0] * vt[0] + hi[1] * vt[1]])
            en = self.px_to_en(corners_px)
            if 0.5 * np.sum(en[:, 0] * np.roll(en[:, 1], -1) - np.roll(en[:, 0], -1) * en[:, 1]) < 0:
                en, corners_px = en[::-1], corners_px[::-1]
            height = 8.0 if area_m2 > 600 else 4.5
            base = float(self.height(en).min()) - 0.3
            uvs = self.uv(corners_px)
            top = [obj.add_vertex((e, base + height, -n), (uv[0], uv[1])) for (e, n), uv in zip(en, uvs)]
            faces_wall = []
            for k in range(4):
                k2 = (k + 1) % 4
                length = math.hypot(*(en[k2] - en[k]))
                wb0 = obj.add_vertex((en[k][0], base, -en[k][1]), (0, 0))
                wb1 = obj.add_vertex((en[k2][0], base, -en[k2][1]), (length / 4, 0))
                wt1 = obj.add_vertex((en[k2][0], base + height, -en[k2][1]), (length / 4, height / 4))
                wt0 = obj.add_vertex((en[k][0], base + height, -en[k][1]), (0, height / 4))
                faces_wall.append((wb0, wb1, wt1, wt0))
            obj.add_faces(f"1WALL_building_{count}", "building", faces_wall)
            obj.add_faces(f"ROOF_building_{count}", "aerial", [tuple(top)])
            count += 1
        return count

    # --- trees ------------------------------------------------------------------------------
    def trees(self, obj, spacing_m: float = 6.0, height: float = 8.0, exclude_px: np.ndarray | None = None) -> int:
        cls = self.classes()
        it = max(1, int(0.6 / self.scale))
        mask = ndi.binary_opening(cls["tree"], iterations=it)
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
        base = self.height(en) if len(en) else np.zeros(0)
        faces = []
        for k, ((e, n), b0) in enumerate(zip(en, base)):
            hgt = height * rng.uniform(0.8, 1.25)
            half = hgt * 0.38
            x, z = e, -n
            for ang in (0.0, math.pi / 2):
                dx, dz = math.cos(ang) * half, math.sin(ang) * half
                nrm = (-math.sin(ang), 0, math.cos(ang))
                v0 = obj.add_vertex((x - dx, b0 - 0.3, z - dz), (0, 0), nrm)
                v1 = obj.add_vertex((x + dx, b0 - 0.3, z + dz), (1, 0), nrm)
                v2 = obj.add_vertex((x + dx, b0 + hgt, z + dz), (1, 1), nrm)
                v3 = obj.add_vertex((x - dx, b0 + hgt, z - dz), (0, 1), nrm)
                faces.append((v0, v1, v2, v3))
            if len(faces) >= 2 * 120:
                obj.add_faces(f"TREES_{k // 120:02d}", "tree", faces)
                faces = []
        if faces:
            obj.add_faces(f"TREES_{len(en) // 120:02d}", "tree", faces)
        return len(en)


def outer_terrain(obj, far_dir: str, inner_half: tuple[float, float], out_tex: str, ref_height: float = 0.0, cell_m: float = 12.0, tree_spacing_m: float = 14.0, max_trees: int = 3500) -> dict:
    """Terrain ring from the wide-area orthophoto (1 m/px) and heights (4 m): covers 2.5 x 2 km around the
    site, skips the inner high-resolution area, carries the real hills and a billboard forest."""
    import json
    meta = json.load(open(os.path.join(far_dir, "meta.json")))
    far = Aerial(os.path.join(far_dir, "ortho.png"), meta["gsd"], meta["center"][0], meta["center"][1], has_overlays=False)
    far.terrain = Terrain(os.path.join(far_dir, "dem.tif"), tuple(meta["half_m"]), meta["dem_gsd"])
    far.terrain.ref = ref_height  # same zero level as the inner terrain (start line)
    img = Image.fromarray((np.clip(far.img * 0.82, 0, 1) * 255).astype(np.uint8))
    img.resize((2048, int(2048 * far.h / far.w)), Image.LANCZOS).convert("RGB").save(out_tex, quality=88)
    hx, hy = inner_half
    cell_px = int(round(cell_m / far.scale))
    nx, ny = far.w // cell_px, far.h // cell_px
    xs, ys = np.arange(nx + 1) * cell_px, np.arange(ny + 1) * cell_px
    gx, gy = np.meshgrid(xs, ys)
    en = far.px_to_en(np.column_stack([gx.ravel(), gy.ravel()]).astype(float))
    hgt = far.height(en) - 0.05
    vidx = np.zeros((ny + 1, nx + 1), dtype=int)
    k = 0
    for j in range(ny + 1):
        for i in range(nx + 1):
            vidx[j, i] = obj.add_vertex((en[k, 0], hgt[k], -en[k, 1]), (xs[i] / far.w, 1.0 - ys[j] / far.h))
            k += 1
    faces = []
    for j in range(ny):
        for i in range(nx):
            c = far.px_to_en(np.array([[(xs[i] + xs[i + 1]) / 2.0, (ys[j] + ys[j + 1]) / 2.0]]))[0]
            if abs(c[0]) < hx + 0.5 and abs(c[1]) < hy + 0.5:
                continue  # inside the high-resolution area
            faces.append((vidx[j + 1, i], vidx[j + 1, i + 1], vidx[j, i + 1], vidx[j, i]))
    for c in range(0, len(faces), 15000):
        obj.add_faces(f"1GRASS_far_{c // 15000:02d}", "farground", faces[c:c + 15000])
    # forest: dark green on the wide ortho, outside the inner area
    cls = far.classes()
    mask = ndi.binary_opening(cls["tree"], iterations=1)
    sp = max(int(tree_spacing_m / far.scale), 2)
    rng = np.random.default_rng(8)
    pts = []
    for py in range(sp // 2, far.h, sp):
        for px in range(sp // 2, far.w, sp):
            jx, jy = rng.integers(-sp // 3, sp // 3 + 1, 2)
            x, y = min(max(px + jx, 0), far.w - 1), min(max(py + jy, 0), far.h - 1)
            if mask[y, x]:
                e, n_ = far.px_to_en(np.array([[x, y]], float))[0]
                if abs(e) < hx + 5 and abs(n_) < hy + 5:
                    continue
                pts.append((e, n_))
    if len(pts) > max_trees:
        pts = [pts[i] for i in rng.choice(len(pts), max_trees, replace=False)]
    en_t = np.array(pts) if pts else np.zeros((0, 2))
    base = far.height(en_t) if len(en_t) else np.zeros(0)
    faces, count = [], 0
    for (e, n_), b0 in zip(en_t, base):
        hgt_t = 14.0 * rng.uniform(0.8, 1.2)  # mature pine forest around the site
        half = hgt_t * 0.32
        for ang in (0.0, math.pi / 2):
            dx, dz = math.cos(ang) * half, math.sin(ang) * half
            nrm = (-math.sin(ang), 0, math.cos(ang))
            v0 = obj.add_vertex((e - dx, b0 - 0.5, -n_ - dz), (0, 0), nrm)
            v1 = obj.add_vertex((e + dx, b0 - 0.5, -n_ + dz), (1, 0), nrm)
            v2 = obj.add_vertex((e + dx, b0 + hgt_t, -n_ + dz), (1, 1), nrm)
            v3 = obj.add_vertex((e - dx, b0 + hgt_t, -n_ - dz), (0, 1), nrm)
            faces.append((v0, v1, v2, v3))
        count += 1
        if len(faces) >= 2 * 150:
            obj.add_faces(f"TREESFAR_{count // 150:03d}", "tree", faces)
            faces = []
    if faces:
        obj.add_faces(f"TREESFAR_{count // 150 + 1:03d}", "tree", faces)
    return {"far_cells": sum(1 for _ in range(0)) , "far_trees": count, "far_extent_m": meta["half_m"]}


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
        d.rectangle([xx + 16, 120, xx + 48, 200], fill=(70, 90, 110))
    wall.save(os.path.join(folder, "building.png"))
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
