"""Generated textures: the close-up detail layers that go over the ground photo (asphalt, grass, bare ground),
paint, concrete, building walls, tyre barriers and trees. No third-party images."""
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


def paint(n: int = 128) -> np.ndarray:
    g = 222 + fnoise(n, 2, 12, 31) * 6 - np.clip(fnoise(n, 3, 20, 32) - 1.6, 0, 2) * 40
    return np.stack([g, g, g * 0.985], -1)


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


def build_static() -> dict[str, bytes]:
    return {
        "detail_asphalt.jpg": _jpg(detail_asphalt(), 90),
        "detail_grass.jpg": _jpg(detail_grass(), 90),
        "detail_dirt.jpg": _jpg(detail_dirt(), 90),
        "black.png": _png(np.zeros((8, 8, 3))),
        "paint.jpg": _jpg(paint()),
        "deck.jpg": _jpg(deck()),
        "concrete.jpg": _jpg(concrete()),
        "building.jpg": _jpg(building()),
        "garage.jpg": _jpg(garage()),
        "hall.jpg": _jpg(hall()),
        "hut.jpg": _jpg(np.stack([(96 + fnoise(256, 2, 20, 271, aniso=8) * 9) * c for c in (1.0, 0.82, 0.62)], -1)),
        "tyrewall.jpg": _jpg(tyrewall()),
        "softwall.jpg": _jpg(softwall()),
        "arch.jpg": _jpg(arch()),
        "fence.png": _png(fence()),
        "pylon.png": _png(pylon()),
        "trees.png": _png(trees()),
        "forest.png": _png(forest()),
    }


if __name__ == "__main__":
    out = os.path.join(WORK, "tex_preview")
    os.makedirs(out, exist_ok=True)
    for name, data in build_static().items():
        open(os.path.join(out, name), "wb").write(data)
        im = Image.open(io.BytesIO(data))
        print(f"{name:14} {im.size} {len(data) / 1024:7.0f} kB mean {np.asarray(im.convert('RGB')).reshape(-1, 3).mean(0).round(0)}")
