"""What the aerial photo is used for: the ground far from the track, the roofs, and telling surfaces apart
(dark asphalt, ordinary asphalt, concrete, gravel). Close to the track the ground carries scanned materials."""
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
from common import HALF_E, HALF_N, META_FAR, PHOTO_PX, SITE_HALF, SRC, WORK  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
DETAIL_MEAN = 0.8                               # close-up detail textures average this; the photo is divided by it
ASPHALT_TARGET = 0.25                           # brightness of ordinary asphalt in the game (0..1, as shown on screen)
GRASS_TARGET = np.array([78.0, 98.0, 44.0]) / 255.0
DIRT_GAIN = 0.62


def classes(rgb: np.ndarray):
    """Soft per-pixel weights (asphalt, vegetation, bare ground) from colour. rgb float 0..1."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    sat = rgb.max(-1) - rgb.min(-1)
    veg = ((g > b + 0.02) & (g >= r - 0.012)).astype(np.float32)
    grey = ((sat < 0.085) & (r - b < 0.04)).astype(np.float32) * (1 - veg)
    w = np.stack([grey, veg, np.clip(1 - grey - veg, 0, 1)], -1)
    w = ndi.gaussian_filter(w, (1.0, 1.0, 0))
    return w / np.maximum(w.sum(-1, keepdims=True), 1e-6)


def tone(rgb: np.ndarray, w: np.ndarray, ref: dict | None = None):
    """Photo -> game brightness. Returns (toned rgb 0..1 before the detail layer, reference medians)."""
    lum = rgb.mean(-1)
    if ref is None:
        a, v = w[..., 0] > 0.9, w[..., 1] > 0.9
        ref = dict(asphalt=float(np.median(lum[a])), grass=np.median(rgb[v], axis=0).astype(float).tolist())
    # asphalt: keep the real light/dark pattern, a little stronger, and let painted lines come out white
    ratio = lum / ref["asphalt"]
    base = ASPHALT_TARGET * np.clip(ratio, 0.25, 2.2) ** 1.45
    k = max(3, int(round(1.2 / (2 * SITE_HALF / rgb.shape[1]))) | 1)
    tophat = lum - ndi.grey_opening(lum, size=(k * 2 + 1, k * 2 + 1))
    paint = np.clip((tophat - 0.07) / 0.10, 0, 1) * np.clip((ratio - 1.12) / 0.25, 0, 1)
    asph_l = base * (1 - paint) + 0.86 * paint
    grey = rgb / np.maximum(lum[..., None], 1e-4)
    asph = (0.35 * grey + 0.65) * asph_l[..., None]                    # mostly neutral, a trace of the real tint
    veg = rgb * (GRASS_TARGET / np.array(ref["grass"]))[None, None, :]
    veg = np.maximum(veg, 0.0) ** 1.08
    dirt = rgb * DIRT_GAIN
    out = w[..., :1] * asph + w[..., 1:2] * veg + w[..., 2:3] * dirt
    return np.clip(out / DETAIL_MEAN, 0, 1), ref


def _en_to_px(en: np.ndarray, n: int) -> np.ndarray:
    en = np.atleast_2d(en)
    return np.column_stack([(en[:, 0] + SITE_HALF) / (2 * SITE_HALF) * n, (SITE_HALF - en[:, 1]) / (2 * SITE_HALF) * n])


def _poly_mask(n: int, poly_en: np.ndarray) -> np.ndarray:
    m = np.zeros((n, n), np.uint8)
    cv2.fillPoly(m, [np.round(_en_to_px(poly_en, n)).astype(np.int32)], 1)
    return m.astype(bool)


def site_canvas(n: int = PHOTO_PX) -> np.ndarray:
    """Orthophoto resampled onto the square site canvas (north up); the strips the detailed photo does not
    cover are filled from the wide-area photo."""
    far = Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB")
    fe, fn = META_FAR["half_m"]
    fpx = far.width / (2 * fe)
    box = ((fe - SITE_HALF) * fpx, (fn - SITE_HALF) * fpx, (fe + SITE_HALF) * fpx, (fn + SITE_HALF) * fpx)
    canvas = far.resize((n, n), Image.BICUBIC, box=box)
    near = Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("RGB")
    w = int(round(n * HALF_E / SITE_HALF))
    h = int(round(n * HALF_N / SITE_HALF))
    canvas.paste(near.resize((w, h), Image.LANCZOS), ((n - w) // 2, (n - h) // 2))
    return np.asarray(canvas, np.float32) / 255.0


def surface_kinds() -> np.ndarray:
    """What the hard surface is made of, per 0.25 m pixel of the site, judged by how light it is in the photo:
    0 = dark asphalt, 1 = ordinary asphalt, 2 = light concrete-like surface."""
    rgb = np.asarray(Image.open(os.path.join(WORK, "ortho_025.png")).convert("RGB"), np.float32) / 255.0
    lum = rgb.mean(-1)
    hard = np.load(os.path.join(WORK, "survey.npz"))["hard"]
    num = ndi.gaussian_filter(np.where(hard, lum, 0.0), 6)
    den = ndi.gaussian_filter(hard.astype(np.float32), 6)
    level = np.where(den > 0.2, num / np.maximum(den, 1e-3), np.nan)
    ratio = level / np.nanmedian(level[hard])
    kind = np.where(ratio < 0.90, 0, np.where(ratio > 1.18, 2, 1)).astype(np.uint8)
    kind = ndi.median_filter(kind, size=13)
    return np.where(np.isnan(level), 1, kind).astype(np.uint8)


def bare_ground() -> np.ndarray:
    """Light gravel and bare sandy ground (run-off areas), per 0.25 m pixel of the site."""
    rgb = np.asarray(Image.open(os.path.join(WORK, "ortho_025.png")).convert("RGB"), np.float32) / 255.0
    rgb = ndi.uniform_filter(rgb, size=(3, 3, 1))
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    sv = np.load(os.path.join(WORK, "survey.npz"))
    veg = (g > b + 0.02) & (g >= r - 0.012)
    tall = ndi.binary_dilation(sv["building"] | (sv["canopy"] > 0), iterations=6)
    m = ~veg & ~sv["hard"] & ~tall & (r - b > 0.03) & (rgb.mean(-1) > 0.42) & (rgb.max(-1) - rgb.min(-1) < 0.32)
    return ndi.binary_closing(ndi.binary_opening(m, iterations=3), iterations=4)


def build(covered: np.ndarray, grass_rgb, n: int = PHOTO_PX, blend_m: float = 22.0) -> dict[str, bytes]:
    """Ground photo for everything further than the tiled surfaces reach, the wide-area photo, and the roofs.

    covered: boolean raster (0.25 m, north up, the surveyed site) of the ground that carries tiled textures.
    Next to it the photo fades into the plain grass colour so the change of texture is not a hard line."""
    rgb = site_canvas(n)
    w = classes(rgb)
    toned, ref = tone(rgb, w)
    toned = toned * DETAIL_MEAN
    rows, cols = int(round(n * HALF_N / SITE_HALF)), int(round(n * HALF_E / SITE_HALF))
    cv = np.asarray(Image.fromarray(covered.astype(np.uint8) * 255).resize((cols, rows), Image.NEAREST)) > 0
    full = np.zeros((n, n), bool)
    full[(n - rows) // 2: (n - rows) // 2 + rows, (n - cols) // 2: (n - cols) // 2 + cols] = cv
    dist = ndi.distance_transform_edt(~full) * (2 * SITE_HALF / n)
    t = np.clip(1.0 - dist / blend_m, 0, 1)
    t = (t * t * (3 - 2 * t))[..., None]
    toned = toned * (1 - t) + (np.asarray(grass_rgb, np.float32) / 255.0)[None, None, :] * t
    out = {}
    buf = io.BytesIO()
    Image.fromarray((np.clip(toned, 0, 1) * 255).astype(np.uint8)).save(buf, "JPEG", quality=88)
    out["ground_photo.jpg"] = buf.getvalue()
    buf = io.BytesIO()
    Image.fromarray((np.clip(site_canvas(2048) * 0.78, 0, 1) * 255).astype(np.uint8)).save(buf, "JPEG", quality=88)
    out["roof_photo.jpg"] = buf.getvalue()
    far = np.asarray(Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB").resize((2048, 2048), Image.LANCZOS), np.float32) / 255.0
    far_toned = np.clip(far * (GRASS_TARGET / np.array(ref["grass"]))[None, None, :], 0, 1)
    buf = io.BytesIO()
    Image.fromarray((far_toned * 255).astype(np.uint8)).save(buf, "JPEG", quality=86)
    out["ground_far.jpg"] = buf.getvalue()
    return out
