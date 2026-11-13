"""Textures. Surfaces (asphalt, grass, gravel, concrete, plaster, sheet metal) are photo-scanned CC0 material
from Poly Haven (source/assets), brought to game brightness. Paint, barrier covers, the bridge panel, fences and
pylons are drawn here. Trees are pictures rendered from real 3D tree models (mktrees.py)."""
from __future__ import annotations

import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SRC, WORK  # noqa: E402

Image.MAX_IMAGE_PIXELS = None


def fnoise(n: int, lo: float, hi: float, seed: int, aniso: float = 1.0) -> np.ndarray:
    """Periodic band-limited noise, unit variance. lo/hi = wavelength band in pixels."""
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft2(rng.standard_normal((n, n)))
    fy = np.fft.fftfreq(n)[:, None] * aniso
    fx = np.fft.rfftfreq(n)[None, :]
    f = np.hypot(fx, fy)
    band = (f >= 1.0 / hi) & (f <= 1.0 / lo)
    out = np.fft.irfft2(spec * band, s=(n, n))
    return out / max(out.std(), 1e-9)


def _jpg(a: np.ndarray, q: int = 88) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=q, subsampling=0)
    return buf.getvalue()


def _png(a: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def paint(n: int = 256) -> np.ndarray:
    """Road paint after a few seasons: off-white, thinner towards its edges, with the asphalt showing through in
    specks and scuffs."""
    g = 208 + fnoise(n, 3, 24, 31) * 7
    worn = np.clip(fnoise(n, 2, 9, 32) * 0.6 + fnoise(n, 10, 60, 33) * 0.7 - 0.95, 0, 1.4) / 1.4
    edge = np.abs(np.linspace(-1, 1, n))[None, :] ** 6                 # u runs across the line
    worn = np.clip(worn + edge * np.clip(fnoise(n, 3, 16, 34) + 0.6, 0, 1), 0, 1)
    g = g * (1 - worn) + 70 * worn
    return np.clip(np.stack([g, g * 0.995, g * 0.97], -1), 0, 255)


def _blob_mask(n, centres, radii, seed, rough=0.22):
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    m = np.full((n, n), -5.0, np.float32)
    for (cx, cy), (rx, ry) in zip(centres, radii):
        m = np.maximum(m, 1.0 - np.hypot((xx - cx) / rx, (yy - cy) / ry))
    m += fnoise(n, n / 40, n / 12, seed) * rough * 0.35 + fnoise(n, n / 14, n / 4, seed + 1) * rough * 0.6
    return m > 0.0


def trees(n: int = 512) -> np.ndarray:
    """RGBA atlas, two cells side by side: Scots pine (left), broadleaf (right)."""
    rng = np.random.default_rng(71)
    cells = []
    for kind in ("pine", "leaf"):
        if kind == "pine":
            cen = [(n * 0.5 + rng.normal(0, n * 0.11), n * (0.12 + 0.36 * rng.random())) for _ in range(14)]
            rad = [(n * rng.uniform(0.15, 0.25), n * rng.uniform(0.08, 0.13)) for _ in cen]
            trunk_w, trunk_top, trunk_rgb = 0.030, 0.25, (118, 72, 44)
            leaf = np.array([46.0, 74.0, 40.0])
        else:
            cen = [(n * 0.5 + rng.normal(0, n * 0.13), n * (0.16 + 0.42 * rng.random())) for _ in range(12)]
            rad = [(n * rng.uniform(0.14, 0.24), n * rng.uniform(0.10, 0.17)) for _ in cen]
            trunk_w, trunk_top, trunk_rgb = 0.035, 0.5, (72, 60, 48)
            leaf = np.array([62.0, 92.0, 42.0])
        crown = _blob_mask(n, cen, rad, 72 + len(cells))
        # solid crown with a few gaps near the rim only: sparse foliage turns into haze at a distance
        core = ndi.binary_erosion(crown, iterations=max(2, n // 28))
        crown &= core | (fnoise(n, 6, 26, 80 + len(cells)) > -1.2)
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
        trunk = (np.abs(xx - n / 2) < n * trunk_w * (0.7 + 0.6 * yy / n)) & (yy > n * trunk_top)
        light = (1.15 - 0.5 * yy / n + 0.22 * fnoise(n, 3, 12, 90 + len(cells)) + 0.16 * fnoise(n, 12, 50, 91 + len(cells))
                 - 0.30 * np.clip(fnoise(n, 6, 20, 92 + len(cells)) - 0.9, 0, 1.5))          # dark gaps between leaf clumps
        rgb = np.zeros((n, n, 3), np.float32) + leaf
        rgb *= light[..., None]
        tr = np.array(trunk_rgb, np.float32) * (0.85 + 0.1 * fnoise(n, 2, 9, 95, aniso=6)[..., None])
        rgb = np.where((trunk & ~crown)[..., None], tr, rgb)
        alpha = (crown | trunk).astype(np.float32) * 255
        cells.append(np.dstack([rgb, alpha]))
    return np.hstack(cells)


def forest(w: int = 2048, h: int = 256) -> np.ndarray:
    """Distant tree line, periodic in u, RGBA."""
    sky = (fnoise(w, 8, 30, 101)[0] * 0.035 + fnoise(w, 40, 300, 102)[0] * 0.07 + fnoise(w, 300, w, 103)[0] * 0.08)
    top = np.clip(0.42 - sky, 0.05, 0.9) * h               # row of the tree tops
    yy = np.arange(h)[:, None]
    alpha = (yy >= top[None, :]) * 255.0
    shade = 0.75 + 0.5 * (1 - yy / h) + 0.10 * fnoise(w, 3, 16, 104)[:h]
    rgb = np.array([40.0, 58.0, 36.0])[None, None, :] * shade[..., None]
    haze = np.array([118.0, 132.0, 140.0])                 # distant haze
    rgb = rgb * 0.72 + haze * 0.28
    return np.dstack([rgb, alpha])


def building() -> np.ndarray:
    """Wall, 8 m x 4 m per tile: plaster with a window band and a plinth."""
    h, w = 256, 512
    a = np.zeros((h, w, 3), np.float32) + (176, 172, 162)
    a *= 0.96 + 0.03 * fnoise(512, 6, 60, 111)[:h, :, None]
    a[-36:] = (104, 102, 98)
    for k in range(4):
        x0 = 24 + k * 128
        a[70:150, x0: x0 + 80] = (52, 66, 80)
        a[70:150, x0 + 38: x0 + 42] = (210, 210, 206)
        a[66:70, x0 - 4: x0 + 84] = (214, 214, 210)
        a[150:154, x0 - 4: x0 + 84] = (214, 214, 210)
    a[:10] = (90, 92, 96)
    return a


def concrete() -> np.ndarray:
    """Cast concrete, 3 m per tile: fine grain, faint streaks running down, formwork joints."""
    n = 512
    g = 140 + fnoise(n, 1.5, 5, 151) * 3.5 + fnoise(n, 6, 30, 152) * 1.2 + fnoise(n, 200, 512, 153) * 2
    g += fnoise(n, 3, 40, 154, aniso=0.06) * 3                       # vertical weathering streaks
    g -= np.clip(fnoise(n, 3, 12, 155) - 2.0, 0, 2) * 14              # pores
    g[:, :3] -= 16
    g[:3] -= 12
    return np.stack([g, g * 0.99, g * 0.96], -1)


def detail_asphalt(n: int = 1024, seed: int = 201) -> np.ndarray:
    """Close-up asphalt grain, neutral, mean 0.8: multiplied over the ground photo by the multilayer shader."""
    g = 1.0 + fnoise(n, 1.5, 5, seed) * 0.125 + fnoise(n, 5, 20, seed + 1) * 0.05 + fnoise(n, 30, 200, seed + 2) * 0.035
    g += np.clip(fnoise(n, 2, 6, seed + 4) - 1.9, 0, 2) * 0.30
    g -= np.clip(-fnoise(n, 2, 7, seed + 5) - 2.0, 0, 2) * 0.22
    g = g / g.mean() * 204.0
    return np.stack([g, g, g * 1.01], -1)


def detail_grass(n: int = 1024, seed: int = 211) -> np.ndarray:
    px_m = n / 4.0
    v = (fnoise(n, 1.5, 4, seed, aniso=0.4) * 0.16 + fnoise(n, 4, 14, seed + 1) * 0.10 + fnoise(n, 0.4 * px_m, 1.5 * px_m, seed + 2) * 0.06)
    hue = fnoise(n, 3, 12, seed + 3) * 0.05
    rgb = np.stack([1 + v + hue, 1 + v, 1 + v - hue * 1.5], -1)
    return rgb / rgb.mean() * 204.0


def detail_dirt(n: int = 512, seed: int = 221) -> np.ndarray:
    g = 1.0 + fnoise(n, 1.5, 6, seed) * 0.13 + fnoise(n, 8, 40, seed + 1) * 0.07 + np.clip(fnoise(n, 3, 9, seed + 2) - 1.7, 0, 2) * 0.25
    g = g / g.mean() * 204.0
    return np.stack([g * 1.01, g, g * 0.97], -1)


def deck() -> np.ndarray:
    """Concrete bridge deck: slabs with joints across, 4 m per tile along (v)."""
    n = 512
    g = 118 + fnoise(n, 2, 8, 231) * 5 + fnoise(n, 20, 120, 232) * 6
    for row in (0, n // 2):
        g[row: row + 5] -= 38
    g[:, :10] -= 22
    g[:, -10:] -= 22
    return np.stack([g, g * 0.99, g * 0.96], -1)


def garage() -> np.ndarray:
    """Pit garage front: white wall with grey roller doors, 8 m x 4 m per tile."""
    h, w = 256, 512
    a = np.zeros((h, w, 3), np.float32) + (188, 188, 184)
    a *= 0.96 + 0.03 * fnoise(512, 6, 60, 241)[:h, :, None]
    for k in range(2):
        x0 = 28 + k * 256
        door = np.zeros((176, 200, 3), np.float32) + (92, 98, 106)
        door[np.arange(176) % 11 < 2] *= 0.8
        a[70:246, x0: x0 + 200] = door
        a[64:70, x0 - 6: x0 + 206] = (70, 72, 76)
    a[:14] = (30, 72, 140)                                  # the venue's blue trim
    a[-10:] = (96, 96, 94)
    return a


def hall() -> np.ndarray:
    """Sheet-metal hall wall, 8 m x 4 m per tile."""
    h, w = 256, 512
    g = 150 + fnoise(512, 30, 200, 251)[:h] * 5
    g = g - (np.arange(w) % 20 < 3)[None, :] * 18
    a = np.stack([g * 0.97, g, g * 1.04], -1)
    a[-22:] = (98, 98, 96)
    a[:8] *= 0.75
    return a


def tyrewall() -> np.ndarray:
    """Tyre barrier, stacked tyres: one tile = 4 tyres along (2.6 m) and the full height (v)."""
    h, w = 256, 512
    yy = (np.arange(h) + 0.5) / h * 4 % 1.0
    xx = (np.arange(w) + 0.5) / w * 4 % 1.0
    prof = np.sin(np.pi * yy)[:, None] ** 0.6 * (0.55 + 0.45 * np.sin(np.pi * xx)[None, :] ** 0.5)
    g = 12 + 34 * prof + fnoise(512, 2, 10, 261)[:h] * 2.0
    a = np.stack([g, g, g * 1.03], -1)
    top = (np.arange(h) < h // 4)[:, None] & np.ones(w, bool)[None, :]
    white = 150 + 60 * prof
    a[top & (np.arange(w)[None, :] % 256 < 128)] = np.stack([white, white, white], -1)[top & (np.arange(w)[None, :] % 256 < 128)]
    return a


def softwall() -> np.ndarray:
    """Green and yellow padded barrier modules as on the 2026 circuit photos: u along (2 modules = 4 m), v up."""
    h, w = 128, 512
    a = np.zeros((h, w, 3), np.float32)
    a[:, : w // 2] = (28, 118, 62)
    a[:, w // 2:] = (224, 196, 30)
    y = np.linspace(1, 0, h)[:, None, None]
    a = a * (0.74 + 0.26 * y) * (0.94 + 0.05 * fnoise(512, 3, 30, 281)[:h, :, None])
    for x0 in (0, w // 2):
        a[:, x0: x0 + 5] *= 0.45
        a[:, (x0 - 5) % w: (x0 - 5) % w + 5] *= 0.45
    a[-12:] *= 0.65
    a[:6] *= 1.12
    return a


def arch() -> np.ndarray:
    """Green side panel of the bridge arch with a white band (no lettering), 8 m per tile."""
    h, w = 128, 512
    a = np.zeros((h, w, 3), np.float32) + (22, 122, 68)
    a *= 0.95 + 0.04 * fnoise(512, 4, 60, 291)[:h, :, None]
    a[52:76, 40: w - 40] = (232, 236, 232)
    a[:6] = (200, 204, 200)
    a[-6:] = (14, 70, 40)
    a[:, :3] *= 0.6
    return a


def fence() -> np.ndarray:
    """Welded mesh railing, RGBA, 2 m x 1.1 m per tile."""
    h, w = 128, 256
    a = np.zeros((h, w, 4), np.float32)
    a[..., :3] = (150, 156, 160)
    wire = (np.arange(w)[None, :] % 16 < 2) | (np.arange(h)[:, None] % 32 < 2)
    a[..., 3] = wire * 255
    a[:6, :, 3] = 255
    a[-5:, :, 3] = 255
    a[:, :5, 3] = 255
    return a


def pylon() -> np.ndarray:
    """Lattice power pylon silhouette, RGBA: the cell is 16 m wide and 32 m tall."""
    from PIL import ImageDraw
    w, h = 256, 512
    im = Image.new("RGBA", (w, h), (120, 124, 128, 0))
    d = ImageDraw.Draw(im)
    steel = (128, 132, 136, 255)
    px = lambda x, y: (w / 2 + x / 16.0 * w, h - y / 32.0 * h)
    half = lambda y: 3.2 - 2.6 * min(y, 26.0) / 26.0 if y < 26 else 0.6
    levels = [0, 5, 10, 14.5, 18.5, 22, 25, 27.5, 30, 32]
    for a_, b_ in zip(levels[:-1], levels[1:]):
        for sgn in (-1, 1):
            d.line([px(sgn * half(a_), a_), px(sgn * half(b_), b_)], fill=steel, width=4)
        d.line([px(-half(a_), a_), px(half(b_), b_)], fill=steel, width=2)
        d.line([px(half(a_), a_), px(-half(b_), b_)], fill=steel, width=2)
        d.line([px(-half(b_), b_), px(half(b_), b_)], fill=steel, width=2)
    for y, reach in ((19.5, 6.5), (24.0, 7.6), (28.5, 5.2)):                 # cross-arms
        for sgn in (-1, 1):
            d.line([px(sgn * half(y), y), px(sgn * reach, y)], fill=steel, width=4)
            d.line([px(sgn * half(y + 2.2), y + 2.2), px(sgn * reach, y)], fill=steel, width=2)
            d.line([px(sgn * reach, y), px(sgn * reach, y - 1.4)], fill=(60, 62, 66, 255), width=3)
    a = np.asarray(im, np.float32).copy()
    yy = (h - np.arange(h)) / h * 32.0
    band = (yy > 26)[:, None] & (a[..., 3] > 0)                              # red and white aviation marking on top
    red = ((yy // 1.5) % 2 == 0)[:, None]
    a[band & red] = (196, 40, 34, 255)
    a[band & ~red] = (232, 232, 228, 255)
    return a


ASSETS = os.path.join(SRC, "assets")
GRASS_MEAN = (84.0, 97.0, 50.0)                 # the grass tile and the distant ground photo share this colour
TILE_M = {"road": 24.0, "apron": 24.0, "pad": 6.0, "grass": 40.0, "gravel": 4.0, "shoulder": 6.0}     # metres covered by one texture


def scan(name: str, target, px: int, repeat: int = 1, desat: float = 0.0, patchy: float = 0.0, seed: int = 0) -> np.ndarray:
    """A photo-scanned CC0 texture from source/assets, brought to game brightness.

    target: mean brightness (number) or mean colour (r, g, b). repeat: the scan is laid repeat x repeat times into
    one texture; `patchy` then adds slow light/dark variation over the whole texture so the repeat does not show."""
    im = Image.open(os.path.join(ASSETS, name)).convert("RGB").resize((px // repeat, px // repeat), Image.LANCZOS)
    a = np.tile(np.asarray(im, np.float32), (repeat, repeat, 1))
    if desat:
        a = a * (1 - desat) + a.mean(-1, keepdims=True) * desat
    t = np.asarray(target, np.float32)
    a = a * (t / a.mean()) if t.ndim == 0 else a * (t / a.reshape(-1, 3).mean(0))
    if patchy:
        n = a.shape[0]
        a = a * (1 + patchy * (0.6 * fnoise(n, n / 6, n, seed + 1) + 0.4 * fnoise(n, n / 16, n / 5, seed + 2)))[..., None]
    return a


def natural(name: str, target, px: int, repeat: int, desat: float = 0.0, seed: int = 0, vary: float = 0.08, patches: int = 0,
            tint=None, tint_amount: float = 0.0) -> np.ndarray:
    """A scanned surface as it looks outdoors over a large area: the scan is tiled into one big texture and then
    broken up the way weather and use break up a real surface. vary: light/dark drift at three scales. patches:
    rectangular repairs with a sealed joint (asphalt). tint: a second colour that takes over in slow patches
    (dry grass, dust). All of it is periodic, so the big tile still repeats without a seam."""
    a = scan(name, target, px, repeat=repeat, desat=desat)
    n = a.shape[0]
    drift = 0.50 * fnoise(n, n / 3.0, n, seed + 1) + 0.33 * fnoise(n, n / 12, n / 3.5, seed + 2) + 0.17 * fnoise(n, n / 60, n / 14, seed + 3)
    a = a * (1 + vary * drift)[..., None]
    if tint is not None:
        m = np.clip(0.5 + 0.9 * fnoise(n, n / 5.0, n / 1.2, seed + 4) + 0.35 * fnoise(n, n / 30, n / 8, seed + 5), 0, 1)[..., None] * tint_amount
        lum = a.mean(-1, keepdims=True) / max(float(np.mean(target)), 1.0)
        a = a * (1 - m) + np.asarray(tint, np.float32) * lum * m
    rng = np.random.default_rng(seed + 9)
    for _ in range(patches):                                   # repairs: a rectangle of slightly different asphalt
        w, h = int(rng.uniform(0.05, 0.22) * n), int(rng.uniform(0.04, 0.16) * n)
        x0, y0 = int(rng.uniform(0, n - w - 8)) + 4, int(rng.uniform(0, n - h - 8)) + 4
        a[y0: y0 + h, x0: x0 + w] *= rng.uniform(0.88, 1.09)
        for sl in ((slice(y0, y0 + 3), slice(x0, x0 + w)), (slice(y0 + h - 3, y0 + h), slice(x0, x0 + w)),
                   (slice(y0, y0 + h), slice(x0, x0 + 3)), (slice(y0, y0 + h), slice(x0 + w - 3, x0 + w))):
            a[sl] *= 0.72                                       # the sealed joint
    return np.clip(a, 0, 255)


def shoulder() -> np.ndarray:
    """The worn strip where asphalt meets grass: dry grass, bare soil and grit (6 m tile)."""
    n = 1024
    g = scan("grass_ground.jpg", (104, 104, 62), n, repeat=2)
    soil = scan("gravel_floor_02.jpg", (104, 96, 80), n, repeat=2)
    m = np.clip(0.45 + 0.8 * fnoise(n, n / 14, n / 3, 911) + 0.4 * fnoise(n, n / 60, n / 16, 912), 0, 1)[..., None]
    return np.clip(g * (1 - m) + soil * m, 0, 255)


def bags() -> np.ndarray:
    """Yellow soft barrier bags as used at Sosnova: four bags along 4 m (u), with folds, seams and dirt at the foot."""
    h, w = 256, 1024
    a = np.full((h, w, 3), (206, 170, 34), np.float32)
    a *= (1 + 0.07 * fnoise(1024, 40, 300, 77)[:h, :w] + 0.04 * fnoise(1024, 6, 30, 78)[:h, :w])[..., None]
    yy = np.linspace(0, 1, h)[:, None, None]
    a *= 0.80 + 0.28 * np.sin(np.pi * np.clip(yy, 0, 1)) ** 0.6       # rounded: darker towards top edge and foot
    a[-36:] = a[-36:] * 0.72 + 14                                     # dirt at the foot
    for x in range(0, w, 256):                                        # the gap between two bags
        a[:, x: x + 7] *= 0.38
        a[:, x + 7: x + 16] *= 0.8
    return np.clip(a, 0, 255)


def cone() -> np.ndarray:
    """Traffic cone: orange with one white band (v runs up the cone)."""
    a = np.full((128, 64, 3), (226, 92, 22), np.float32)
    a[44:74] = (232, 230, 222)
    a[:10] = (40, 40, 42)
    a *= (1 + 0.05 * fnoise(128, 4, 30, 55)[:, :64])[..., None]
    return np.clip(a[::-1], 0, 255)


def wall(kind: str) -> np.ndarray:
    """Building fronts on real plaster / sheet metal: 8 m x 4 m per tile."""
    h, w = 512, 1024
    if kind == "hall":
        a = np.tile(scan("corrugated_iron.jpg", (150, 156, 162), 512), (1, 2, 1))
        a[-44:] = a[-44:] * 0.45 + 40
        a[:14] *= 0.7
        return a
    a = np.tile(scan("painted_plaster_wall.jpg", (196, 194, 186), 512), (1, 2, 1))
    a[-52:] = a[-52:] * 0.52                                      # plinth
    if kind == "garage":
        for k in range(2):
            x0 = 56 + k * 512
            door = np.zeros((352, 400, 3), np.float32) + (104, 110, 118)
            door[np.arange(352) % 22 < 3] *= 0.78
            a[140:492, x0: x0 + 400] = door
            a[128:140, x0 - 12: x0 + 412] = (70, 72, 78)
        a[:28] = (30, 72, 140)                                    # the venue's blue trim
    else:
        for k in range(4):
            x0 = 48 + k * 256
            a[150:300, x0: x0 + 160] = (48, 62, 78)
            a[150:300, x0 + 76: x0 + 84] = (208, 208, 204)
            a[142:150, x0 - 8: x0 + 168] = (214, 214, 210)
            a[300:308, x0 - 8: x0 + 168] = (214, 214, 210)
        a[:18] = (96, 98, 102)
    return a


def kerb() -> np.ndarray:
    """Kerb blocks with old paint on real concrete: one tile is 2 m along (v): 1 m red, 1 m white. The paint is
    faded and scuffed, with tyre rubber dragged along it and dirt in the joints."""
    base = scan("gravel_concrete_03.jpg", 128, 512)
    grain = (base.mean(-1, keepdims=True) / 128.0)[:, :128]
    a = np.zeros((512, 128, 3), np.float32)
    a[:256] = (146, 40, 36)
    a[256:] = (198, 196, 186)
    a = a * (0.50 + 0.50 * grain)
    wear = np.clip(fnoise(512, 3, 20, 61)[:, :128] * 0.7 + fnoise(512, 20, 120, 62)[:, :128] * 0.6 - 0.8, 0, 1)[..., None]
    a = a * (1 - 0.55 * wear) + base[:, :128] * 0.9 * (0.55 * wear)        # bare concrete where the paint is gone
    rubber = np.clip(fnoise(512, 6, 300, 63, aniso=14.0)[:, :128] - 0.9, 0, 1.2)[..., None] / 1.2
    a = a * (1 - 0.6 * rubber) + 22 * 0.6 * rubber                           # dark streaks along the kerb
    for row in (0, 256):                                                    # joints between the blocks
        a[row: row + 5] *= 0.5
        a[row - 5 if row else 507: row if row else 512] *= 0.5
    return np.clip(a, 0, 255)


def barricade() -> np.ndarray:
    """Plastic road barricades and barrier tape: 2 m red, 2 m white along (u)."""
    a = np.zeros((128, 512, 3), np.float32)
    a[:, :256] = (198, 34, 30)
    a[:, 256:] = (232, 230, 224)
    a *= np.linspace(1.0, 0.78, 128)[:, None, None]
    for x in range(0, 512, 128):
        a[:, x: x + 3] *= 0.55
    return np.clip(a, 0, 255)


def tyres() -> np.ndarray:
    """A stack of four tyres: black rubber with tread, the top tyre painted yellow (v runs up the stack)."""
    a = np.full((256, 128, 3), (26, 26, 28), np.float32)
    rng = np.random.default_rng(3)
    a += rng.normal(0, 3.0, a.shape)
    for k in range(4):
        y0 = 256 - (k + 1) * 64
        a[y0: y0 + 64] *= rng.uniform(0.85, 1.2)                # tyres of different age
        a[y0 + 20: y0 + 44] += 5                                # the sidewall bulge catches the light
        a[y0: y0 + 5] *= 0.45                                  # the gap between two tyres
        a[y0 + 59: y0 + 64] *= 0.6
        for x in range(0, 128, 16):                            # tread blocks
            a[y0 + 14: y0 + 50, x: x + 2] *= 0.7
    return np.clip(a, 0, 255)


def lights() -> np.ndarray:
    """Start light panel: five pairs of lamps on a black board, 4:1."""
    from PIL import ImageDraw
    im = Image.new("RGB", (512, 128), (14, 14, 16))
    d = ImageDraw.Draw(im)
    for k in range(5):
        cx = 60 + k * 98
        d.rounded_rectangle([cx - 36, 10, cx + 36, 118], radius=10, fill=(30, 30, 34), outline=(70, 70, 76), width=3)
        for cy in (40, 90):
            d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=(120, 14, 12), outline=(46, 8, 8), width=3)
            d.ellipse([cx - 9, cy - 12, cx + 1, cy - 2], fill=(190, 60, 50))
    return np.asarray(im, np.float32)


def boards() -> np.ndarray:
    """Brake distance boards 150 / 100 / 50, three square cells side by side."""
    from PIL import ImageDraw, ImageFont
    im = Image.new("RGB", (768, 256), (236, 236, 232))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 104)
    for k, t in enumerate(("150", "100", "50")):
        x0 = k * 256
        d.rectangle([x0 + 4, 4, x0 + 251, 251], outline=(16, 16, 18), width=12)
        d.text((x0 + 128 - d.textlength(t, font=f) / 2, 64), t, font=f, fill=(16, 16, 18))
    return np.asarray(im, np.float32)


def foliage(kind: str) -> np.ndarray:
    """The body of a tree seen from outside: clumps of needles or leaves with dark gaps between them, in the colours
    of the tree pictures. v runs up the tree: darker inside and below, lighter at the tips."""
    n = 256
    base = np.array((52.0, 64.0, 38.0) if kind == "conifer" else (76.0, 92.0, 56.0))
    clump = fnoise(n, 6, 28, 401 if kind == "conifer" else 411, aniso=0.6 if kind == "conifer" else 1.0)
    fine = fnoise(n, 2, 6, 402 if kind == "conifer" else 412)
    lum = 1.0 + 0.30 * np.clip(clump, -1.6, 1.6) / 1.6 + 0.16 * fine
    lum *= (0.82 + 0.3 * np.linspace(1, 0, n))[:, None]                 # image rows run from the tip (top) down
    gaps = np.clip(0.5 - clump, 0, 1) ** 2 * 0.5
    a = base[None, None, :] * (lum * (1 - gaps))[..., None]
    a[..., 0] += 6 * np.clip(fine, 0, 2)                                  # a trace of yellow in the lit tips
    return np.clip(a, 0, 255)


def bark() -> np.ndarray:
    n = 128
    ridges = fnoise(n, 3, 40, 421, aniso=0.12)                           # long vertical ridges
    a = np.array((74.0, 62.0, 50.0))[None, None, :] * (1.0 + 0.28 * ridges + 0.08 * fnoise(n, 2, 5, 422))[..., None]
    return np.clip(a, 0, 255)


def lattice() -> np.ndarray:
    """One storey of a lattice pylon, RGBA: legs, a cross of braces and a girder. Bottom half grey steel, top half
    with the red and white aviation marking (the two halves are used for the lower and the upper storeys)."""
    from PIL import ImageDraw
    w, h = 128, 256
    im = Image.new("RGBA", (w, h), (128, 132, 136, 0))
    d = ImageDraw.Draw(im)
    for k, col in enumerate(((128, 132, 136, 255), (128, 132, 136, 255))):
        y0, y1 = k * h // 2, (k + 1) * h // 2 - 1
        for x in (3, w - 4):
            d.line([(x, y0), (x, y1)], fill=col, width=7)
        d.line([(3, y0), (w - 4, y1)], fill=col, width=4)
        d.line([(w - 4, y0), (3, y1)], fill=col, width=4)
        d.line([(0, y1 - 1), (w, y1 - 1)], fill=col, width=4)
    a = np.asarray(im, np.float32).copy()
    upper = np.zeros((h, w), bool)
    upper[: h // 2] = True                                               # image top = v 0.5 .. 1
    solid = a[..., 3] > 0
    red = ((np.arange(h) // 22) % 2 == 0)[:, None] & upper & solid
    a[red] = (196, 40, 34, 255)
    a[upper & solid & ~red] = (232, 232, 228, 255)
    return a


def banners() -> np.ndarray:
    """Advertising boards as they stand along the real barriers: six boards side by side (u), each 3 m by 0.95 m.
    The designs are made up: colour fields, stripes, chevrons and the name of the place. No real brand is shown."""
    from PIL import ImageDraw, ImageFont
    cw, ch = 384, 128
    im = Image.new("RGB", (cw * 6, ch), (255, 255, 255))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default(size=54)
        small = ImageFont.load_default(size=34)
    except TypeError:                                                  # an older Pillow: the small built-in font
        font = small = ImageFont.load_default()

    def text(k, s, fill, f=None, dy=0):
        f = f or font
        box = d.textbbox((0, 0), s, font=f)
        d.text((k * cw + (cw - (box[2] - box[0])) / 2, (ch - (box[3] - box[1])) / 2 - box[1] + dy), s, fill=fill, font=f)
    blue, green, yellow, dark, white, red = (22, 62, 140), (20, 120, 70), (236, 196, 28), (24, 26, 30), (240, 240, 236), (186, 36, 30)
    d.rectangle([0, 0, cw - 1, ch], fill=blue)
    text(0, "SOSNOVÁ", white)
    d.rectangle([cw, 0, 2 * cw - 1, ch], fill=green)
    d.rectangle([cw, ch - 22, 2 * cw - 1, ch], fill=white)
    text(1, "AUTODROM", white, dy=-8)
    d.rectangle([2 * cw, 0, 3 * cw - 1, ch], fill=white)
    for x in range(-ch, cw, 64):                                       # green chevrons
        d.polygon([(2 * cw + x, ch), (2 * cw + x + 32, ch), (2 * cw + x + 32 + ch // 2, ch // 2), (2 * cw + x + 32, 0), (2 * cw + x, 0), (2 * cw + x + ch // 2, ch // 2)], fill=green)
    d.rectangle([2 * cw, 0, 2 * cw + 3, ch], fill=white)
    d.rectangle([3 * cw, 0, 4 * cw - 1, ch], fill=yellow)
    text(3, "SOSNOVÁ", dark)
    d.rectangle([4 * cw, 0, 5 * cw - 1, ch], fill=white)
    d.rectangle([4 * cw, 0, 5 * cw - 1, 26], fill=blue)
    d.rectangle([4 * cw, ch - 26, 5 * cw - 1, ch], fill=blue)
    text(4, "AUTODROM", blue, small)
    d.rectangle([5 * cw, 0, 6 * cw - 1, ch], fill=dark)
    d.rectangle([5 * cw + 20, 48, 6 * cw - 20, 80], fill=red)
    text(5, "14.11.2026", white, small)
    a = np.asarray(im, np.float32)
    for k in range(6):                                                 # the frame of each board
        a[:, k * cw: k * cw + 3] *= 0.55
        a[:, (k + 1) * cw - 3: (k + 1) * cw] *= 0.55
    a[:4] *= 0.6
    a[-6:] *= 0.5                                                      # dirt at the foot
    dirt = np.clip(fnoise(512, 8, 80, 451)[: ch, :], -1.5, 1.5)
    a *= (0.93 + 0.05 * np.tile(dirt, (1, cw * 6 // 512 + 1))[:, : cw * 6])[..., None]
    return np.clip(a, 0, 255)


def build_static() -> dict[str, bytes]:
    out = {
        "road.jpg": _jpg(natural("asphalt_track.jpg", (49, 50, 53), 2048, 12, desat=0.5, seed=301, vary=0.075, patches=7), 90),
        "apron.jpg": _jpg(natural("asphalt_pit_lane.jpg", (72, 72, 73), 2048, 12, desat=0.6, seed=311, vary=0.10, patches=12), 90),
        "road_g1.jpg": _jpg(natural("asphalt_track.jpg", (46.5, 47.5, 50), 2048, 12, desat=0.6, seed=301, vary=0.075, patches=7), 88),
        "road_g2.jpg": _jpg(natural("asphalt_track.jpg", (43.5, 44, 46.5), 2048, 12, desat=0.7, seed=301, vary=0.075, patches=7), 88),
        "road_g3.jpg": _jpg(natural("asphalt_track.jpg", (40.5, 41, 43), 2048, 12, desat=0.8, seed=301, vary=0.075, patches=7), 88),
        "lights.jpg": _jpg(lights(), 92),
        "metal.jpg": _jpg(np.stack([(62 + fnoise(64, 2, 16, 131) * 3) * c for c in (1.0, 1.0, 1.05)], -1)),
        "boards.jpg": _jpg(boards(), 92),
        "pad.jpg": _jpg(scan("gravel_concrete_03.jpg", 150, 1024, repeat=2, patchy=0.04, seed=321), 90),          # the concrete strips
        "padwhite.jpg": _jpg(128 + (scan("gravel_concrete_03.jpg", 128, 1024, repeat=2, patchy=0.03, seed=322) - 128) * 0.45 + 78, 90),  # the white pad
        "grass.jpg": _jpg(natural("grass_ground.jpg", GRASS_MEAN, 2048, 12, seed=331, vary=0.15, tint=(118, 112, 62), tint_amount=0.55), 90),
        "shoulder.jpg": _jpg(shoulder(), 88),
        "bags.jpg": _jpg(bags(), 90),
        "cone.jpg": _jpg(cone(), 90),
        "gravel.jpg": _jpg(scan("gravel_floor_02.jpg", (172, 161, 136), 1024, repeat=2, patchy=0.09, seed=341), 90),        # the pale sand of the run-offs
        "concrete.jpg": _jpg(scan("gravel_concrete_03.jpg", 132, 1024), 90),
        "building.jpg": _jpg(wall("building"), 90),
        "garage.jpg": _jpg(wall("garage"), 90),
        "hall.jpg": _jpg(wall("hall"), 90),
        "paint.jpg": _jpg(paint()),
        "kerb.jpg": _jpg(kerb(), 90),
        "barricade.jpg": _jpg(barricade(), 90),
        "tyres.jpg": _jpg(tyres(), 90),
        "banner.jpg": _jpg(banners(), 92),
        "tyredark.jpg": _jpg(np.full((16, 16, 3), (9.0, 9.0, 10.0)) + fnoise(16, 2, 8, 431)[..., None] * 1.5, 90),      # the inside of a tyre stack
        "foliage_c.jpg": _jpg(foliage("conifer"), 90),
        "foliage_l.jpg": _jpg(foliage("leaf"), 90),
        "bark.jpg": _jpg(bark(), 90),
        "lattice.png": _png(lattice()),
        "hut.jpg": _jpg(np.stack([(96 + fnoise(256, 2, 20, 271, aniso=8) * 9) * c for c in (1.0, 0.82, 0.62)], -1)),
        "softwall.jpg": _jpg(softwall()),
        "arch.jpg": _jpg(arch()),
        "fence.png": _png(fence()),
        "pylon.png": _png(pylon()),
        "forest.png": _png(forest()),
    }
    for name in sorted(os.listdir(ASSETS)):                       # tree pictures rendered from real 3D models
        if name.startswith("tree_") and name.endswith(".png"):
            out[name] = open(os.path.join(ASSETS, name), "rb").read()
    return out


if __name__ == "__main__":
    out = os.path.join(WORK, "tex_preview")
    os.makedirs(out, exist_ok=True)
    for name, data in build_static().items():
        open(os.path.join(out, name), "wb").write(data)
        im = Image.open(io.BytesIO(data))
        print(f"{name:14} {im.size} {len(data) / 1024:7.0f} kB mean {np.asarray(im.convert('RGB')).reshape(-1, 3).mean(0).round(0)}")
