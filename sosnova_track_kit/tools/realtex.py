"""Textures that are copies of the real place: the 12.5 cm aerial photo decides how every metre looks.

  * the lap: one texture for every 28 m of road. The light and dark pattern of the real asphalt (patches, joints,
    old and new surface, tyre marks) comes from the photo; the grain comes from a close-up scan of asphalt, because
    an aerial photo has none. The rubbered racing line is added on top.
  * the grass around the circuit: one texture per ground tile, with the real colours of the photo (mown and unmown
    grass, dry patches, paths, tree shadows) and scanned grass grain.

Nothing here is drawn by hand. Places where the photo does not show asphalt or grass (paint, cars, buildings, the
shadow of the bridge) are filled from their surroundings."""
from __future__ import annotations

import io
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge_geom as bg  # noqa: E402
import photo  # noqa: E402
import textures  # noqa: E402
from common import HALF_E, HALF_N, SITE_HALF, SRC, WORK  # noqa: E402

GSD = 0.125
LAP_CHUNK = 28                    # stations (metres) of road per lap texture: 1764 m = 63 textures
LAP_PX = (2048, 512)              # rows (along), columns (across)
LAP_MARGIN = (1.0, 0.3)           # texture overlap beyond the mesh along and across (m), so filtering never wraps
LAP_HALF = 4.5
GROOVE_SIGMA = 1.15
GRASS_PX = 1536                   # pixels per grass tile
GRASS_MARGIN = 9.0                # a ground triangle may reach this far out of its tile (m)

_cache: dict = {}


def _jpg(a: np.ndarray, q: int = 85) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=q)
    return buf.getvalue()


def _ortho():
    """(luminance 0..1 of the photo, mask of real asphalt) at 12.5 cm, north up."""
    if "ortho" not in _cache:
        Image.MAX_IMAGE_PIXELS = None
        rgb = np.asarray(Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("RGB"), np.float32) / 255.0
        lum = cv2.GaussianBlur(rgb.mean(-1), (0, 0), 0.8)
        sat = rgb.max(-1) - rgb.min(-1)
        hard = np.load(os.path.join(WORK, "survey.npz"))["hard"]
        hard = cv2.resize(hard.astype(np.uint8), (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
        ref = float(np.median(lum[hard & (sat < 0.09)]))
        ok = hard & (sat < 0.10) & (lum > 0.50 * ref) & (lum < 1.42 * ref)          # no paint, cars, deep shadow, grass
        for pg in (bg.footprint(grow=2.5), bg.shadow_polygon()):                     # the bridge hides the road under it
            cv2.fillPoly(ok.view(np.uint8), [np.round(np.column_stack([(pg[:, 0] + HALF_E) / GSD, (HALF_N - pg[:, 1]) / GSD])).astype(np.int32)], 0)
        ok = ndi.binary_erosion(ok, iterations=2)
        _cache["ortho"] = (lum / ref, ok.astype(np.float32))
    return _cache["ortho"]


def _sample(img: np.ndarray, en: np.ndarray, interp=cv2.INTER_LINEAR) -> np.ndarray:
    """img: north-up raster at 12.5 cm over the surveyed site; en: (..., 2) east/north."""
    mx = ((en[..., 0] + HALF_E) / GSD - 0.5).astype(np.float32)
    my = ((HALF_N - en[..., 1]) / GSD - 0.5).astype(np.float32)
    return cv2.remap(img, mx, my, interp, borderMode=cv2.BORDER_REFLECT)


def lap_textures(tr, line_offset: np.ndarray):
    """Returns ({file name: jpeg}, [(first station, last station, material name)])."""
    ratio, ok = _ortho()
    grain = textures.scan("asphalt_track.jpg", (49.0, 50.0, 53.0), 384, repeat=1, desat=0.5)        # 5.6 m of scanned asphalt
    grain_m = 5.6
    fine = 1 + 0.035 * textures.fnoise(512, 2, 5, 771)
    H, W = LAP_PX
    out, chunks = {}, []
    busy_all = 0.8 + 0.2 * np.clip(np.abs(tr.k) * 40.0, 0, 1)
    for k, a in enumerate(range(0, tr.n, LAP_CHUNK)):
        b = min(tr.n, a + LAP_CHUNK)
        s = (a - LAP_MARGIN[0]) + (b - a + 2 * LAP_MARGIN[0]) * (np.arange(H) + 0.5) / H
        d = -(LAP_HALF + LAP_MARGIN[1]) + 2 * (LAP_HALF + LAP_MARGIN[1]) * (np.arange(W) + 0.5) / W
        ss, dd = np.meshgrid(s, d, indexing="ij")
        en = tr.en(ss.ravel(), dd.ravel()).reshape(H, W, 2)
        r = _sample(ratio, en)
        v = _sample(ok, en)
        # where the photo shows no clean asphalt, take the look of the asphalt around it
        num, den = cv2.GaussianBlur(r * v, (0, 0), 22), cv2.GaussianBlur(v, (0, 0), 22)
        fill = np.where(den > 0.03, num / np.maximum(den, 1e-4), 1.0)
        r = cv2.GaussianBlur(r * v + fill * (1 - v), (0, 0), 1.6)
        macro = 1 + 0.95 * (np.clip(r, 0.66, 1.45) - 1)
        gx = ((dd % grain_m) / grain_m * 384).astype(np.float32)
        gy = ((ss % grain_m) / grain_m * 384).astype(np.float32)
        tex = cv2.remap(grain, gx, gy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
        tex = tex * np.tile(fine, (H // 512, 1))[..., None] * macro[..., None]
        off = tr.interp(line_offset, ss.ravel()).reshape(H, W)
        busy = tr.interp(busy_all, ss.ravel()).reshape(H, W)
        tex *= (1 - 0.17 * np.exp(-0.5 * ((dd - off) / GROOVE_SIGMA) ** 2) * busy)[..., None]     # rubber on the racing line
        tex *= (1 + 0.07 * np.clip((np.abs(dd) - (LAP_HALF - 0.55)) / 0.5, 0, 1))[..., None]       # dust along the edges
        name = f"lap{k:02d}"
        out[name + ".jpg"] = _jpg(tex, 86)
        chunks.append((a, b, name))
    return out, chunks


def lap_uv(a: int, b: int, station: np.ndarray, lateral: np.ndarray) -> np.ndarray:
    """Texture coordinates (v upwards) of points of the lap chunk a..b."""
    u = (lateral + LAP_HALF + LAP_MARGIN[1]) / (2 * (LAP_HALF + LAP_MARGIN[1]))
    v = 1.0 - (station - (a - LAP_MARGIN[0])) / (b - a + 2 * LAP_MARGIN[0])
    return np.column_stack([u, v])


def _grass_canvas():
    """The site photo in game colours with everything that is not vegetation filled from the vegetation around it."""
    if "grass" not in _cache:
        n = 4096
        rgb = photo.site_canvas(n)
        w = photo.classes(rgb)
        toned, _ = photo.tone(rgb, w)
        toned = toned * photo.DETAIL_MEAN
        veg = cv2.GaussianBlur((w[..., 1] > 0.6).astype(np.float32), (0, 0), 1.2)
        sig = 3.5 / (2 * SITE_HALF / n)
        num = cv2.GaussianBlur(toned * veg[..., None], (0, 0), sig)
        den = cv2.GaussianBlur(veg, (0, 0), sig)[..., None]
        base = np.array(textures.GRASS_MEAN, np.float32) / 255.0
        fill = np.where(den > 0.03, num / np.maximum(den, 1e-4), base)
        out = toned * veg[..., None] + fill * (1 - veg[..., None])
        lum = out.mean(-1, keepdims=True)
        out = out * np.clip(lum, 0.5 * base.mean(), None) / np.maximum(lum, 1e-4)        # tree shadows stay, but not black
        _cache["grass"] = (out * 255.0).astype(np.float32)
    return _cache["grass"]


def grass_tile(e0: float, n0: float, size: float) -> bytes:
    """Texture of the square ground tile whose south-west corner is (e0, n0); it reaches GRASS_MARGIN beyond it."""
    canvas = _grass_canvas()
    n = canvas.shape[0]
    ext = size + 2 * GRASS_MARGIN
    t = (np.arange(GRASS_PX) + 0.5) / GRASS_PX
    ee, nn = np.meshgrid(e0 - GRASS_MARGIN + ext * t, n0 + size + GRASS_MARGIN - ext * t)
    mx = ((ee + SITE_HALF) / (2 * SITE_HALF) * n - 0.5).astype(np.float32)
    my = ((SITE_HALF - nn) / (2 * SITE_HALF) * n - 0.5).astype(np.float32)
    col = cv2.remap(canvas, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    if "blades" not in _cache:
        g = textures.scan("grass_ground.jpg", 128.0, 256, repeat=1).mean(-1) / 128.0          # 14 m of scanned grass
        _cache["blades"] = g.astype(np.float32)
    bm = 14.0
    gx = ((ee % bm) / bm * 256).astype(np.float32)
    gy = ((nn % bm) / bm * 256).astype(np.float32)
    blades = cv2.remap(_cache["blades"], gx, gy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    col = col * (0.55 + 0.45 * blades)[..., None] * (1 + 0.10 * textures.fnoise(GRASS_PX, 2, 5, 881) + 0.06 * textures.fnoise(GRASS_PX, 5, 14, 882))[..., None]
    return _jpg(col, 84)


def grass_uv(e0: float, n0: float, size: float, en: np.ndarray) -> np.ndarray:
    ext = size + 2 * GRASS_MARGIN
    return np.column_stack([(en[:, 0] - e0 + GRASS_MARGIN) / ext, (en[:, 1] - n0 + GRASS_MARGIN) / ext])
