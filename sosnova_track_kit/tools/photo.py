"""Ground photo textures. The aerial photo gives the real look of the place (surfaces, markings, patches);
it is toned to game brightness, cleaned around the bridge and paired with a mask that tells the shader
which close-up detail (asphalt, grass, bare ground) to lay over each pixel."""
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
GRASS_TARGET = np.array([82.0, 100.0, 46.0]) / 255.0
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


def clean_bridge(rgb: np.ndarray, w: np.ndarray) -> None:
    """The photo shows the deck of the overpass and its shadow where the game needs the ground underneath.
    The opening gets plain asphalt; the shadow is lifted to the brightness of its surroundings."""
    n = rgb.shape[0]
    lum = rgb.mean(-1)
    deck = _poly_mask(n, bg.footprint(grow=0.8))
    shadow = _poly_mask(n, bg.shadow_polygon()) & ~deck
    ring = ndi.binary_dilation(deck | shadow, iterations=int(10 * n / (2 * SITE_HALF))) & ~ndi.binary_dilation(deck | shadow, iterations=6)
    # in the shadow the colours are unreliable, so every pixel borrows the class of the nearest lit pixel
    idx = ndi.distance_transform_edt(deck | shadow, return_distances=False, return_indices=True)
    w[shadow] = w[idx[0][shadow], idx[1][shadow]]
    for cls in (0, 1, 2):
        inside, outside = shadow & (w[..., cls] > 0.6), ring & (w[..., cls] > 0.8)
        if inside.sum() > 50 and outside.sum() > 50:
            gain = np.median(rgb[outside], axis=0) / np.maximum(np.median(rgb[inside], axis=0), 1e-3)
            rgb[inside] = np.clip(rgb[inside] * np.minimum(gain, 3.5), 0, 1)
    asph = np.median(rgb[ring & (w[..., 0] > 0.9)], axis=0)
    noise = ndi.gaussian_filter(np.random.default_rng(3).standard_normal((n, n)), 6) * 0.25
    under = _poly_mask(n, bg.footprint(bg.SPAN[0] - 3.0, bg.SPAN[1] + 3.0, grow=1.2))
    soft = ndi.gaussian_filter(under.astype(np.float32), 2.0)[..., None]
    rgb[:] = rgb * (1 - soft) + (asph[None, None, :] * (1 + noise[..., None])) * soft
    w[under] = (1.0, 0.0, 0.0)


def build(n: int = PHOTO_PX) -> dict[str, bytes]:
    rgb = site_canvas(n)
    w = classes(rgb)
    # under tree canopy the photo is dark and colourless; the surface model says it is vegetation
    canopy = np.load(os.path.join(WORK, "survey.npz"))["canopy"] > 0
    rows = int(round(n * HALF_N / SITE_HALF))
    cv = np.asarray(Image.fromarray(canopy.astype(np.uint8) * 255).resize((int(round(n * HALF_E / SITE_HALF)), rows), Image.BILINEAR), np.float32) / 255.0
    pad = (n - rows) // 2
    c = np.zeros((n, n), np.float32)
    c[pad: pad + rows, (n - cv.shape[1]) // 2: (n - cv.shape[1]) // 2 + cv.shape[1]] = cv
    w = w * (1 - c[..., None]) + np.array([0.0, 1.0, 0.0], np.float32) * c[..., None]
    clean_bridge(rgb, w)
    toned, ref = tone(rgb, w)
    out = {}
    buf = io.BytesIO()
    Image.fromarray((toned * 255).astype(np.uint8)).save(buf, "JPEG", quality=90)
    out["ground_photo.jpg"] = buf.getvalue()
    buf = io.BytesIO()
    Image.fromarray((w * 255).round().astype(np.uint8)).resize((n // 2, n // 2), Image.BOX).save(buf, "PNG", optimize=True)
    out["ground_mask.png"] = buf.getvalue()
    # roofs keep the look of the photo; only the overall level is matched
    buf = io.BytesIO()
    Image.fromarray((np.clip(site_canvas(2048) * 0.78, 0, 1) * 255).astype(np.uint8)).save(buf, "JPEG", quality=88)
    out["roof_photo.jpg"] = buf.getvalue()
    far = np.asarray(Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB").resize((2048, 2048), Image.LANCZOS), np.float32) / 255.0
    far_toned = np.clip(far * (GRASS_TARGET / np.array(ref["grass"]))[None, None, :], 0, 1)     # distant ground: level match only
    buf = io.BytesIO()
    Image.fromarray((far_toned * 255).astype(np.uint8)).save(buf, "JPEG", quality=86)
    out["ground_far.jpg"] = buf.getvalue()
    return out


if __name__ == "__main__":
    d = os.path.join(WORK, "tex_preview")
    os.makedirs(d, exist_ok=True)
    for name, data in build().items():
        open(os.path.join(d, name), "wb").write(data)
        im = Image.open(io.BytesIO(data))
        print(f"{name:18} {im.size} {im.mode} {len(data) / 1e6:.1f} MB")
