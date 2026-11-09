"""Procedural textures (tileable asphalt, grass, paint, kerbs, barriers, trees, signs) and the
colour-matched orthophoto ground textures. Everything is generated; no third-party images."""
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
GRASS_RGB = np.array([82.0, 98.0, 46.0])     # mean colour of the tiled grass; the photos are matched to it
ROAD_TILE_M = 12.0                            # road texture: u across (centred), v along
APRON_TILE_M = 6.0
GRASS_TILE_M = 8.0
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


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


def _cracks(n: int, count: int, seed: int, width: float = 1.2) -> np.ndarray:
    """Thin wandering dark lines (sealed cracks), periodic. Returns 0..1 coverage."""
    rng = np.random.default_rng(seed)
    im = Image.new("L", (n * 3, n * 3), 0)
    d = ImageDraw.Draw(im)
    for _ in range(count):
        p = rng.uniform(0, n, 2) + n
        ang = rng.uniform(0, 2 * np.pi)
        pts = [tuple(p)]
        for _ in range(int(rng.integers(25, 70))):
            ang += rng.normal(0, 0.13)
            p = p + np.array([np.cos(ang), np.sin(ang)]) * n / 90
            pts.append(tuple(p))
        d.line(pts, fill=255, width=int(round(width * 3)) or 1)
    a = np.asarray(im, np.float32) / 255.0
    a = a.reshape(3, n, 3, n).sum(axis=(0, 2))            # wrap into one tile
    a = ndi.zoom(np.clip(a, 0, 1), 1, order=1)
    return np.clip(ndi.gaussian_filter(a, 0.6, mode="wrap"), 0, 1)


def asphalt(n: int, tile_m: float, base: float, seed: int, groove: bool, crack_count: int) -> np.ndarray:
    px_m = n / tile_m
    g = np.full((n, n), base, np.float32)
    g += fnoise(n, 1.5, 5, seed) * 7.5                     # aggregate
    g += fnoise(n, 5, 20, seed + 1) * 3.0
    g += fnoise(n, 0.25 * px_m, 1.5 * px_m, seed + 2) * 3.2  # mottling
    g += fnoise(n, 2.0 * px_m, n, seed + 3) * 2.6          # large patches
    stones = fnoise(n, 2, 6, seed + 4)
    g += np.clip(stones - 1.9, 0, 2) * 26                  # light stones
    g -= np.clip(-fnoise(n, 2, 7, seed + 5) - 2.0, 0, 2) * 14  # pores
    if groove:
        u = (np.arange(n) + 0.5) / n * tile_m - tile_m / 2  # metres from the centre
        band = np.exp(-0.5 * (u / 1.9) ** 2)
        streak = 1.0 + 0.25 * fnoise(n, 0.5 * px_m, 4 * px_m, seed + 6, aniso=0.08)
        g -= 7.0 * band[None, :] * streak
        g = np.where(np.abs(u)[None, :] < 0.012 + 0 * g, g - 10, g)   # paving joint on the crown
    if crack_count:
        g -= _cracks(n, crack_count, seed + 7) * 9
    rgb = np.stack([g * 1.0, g * 1.0, g * 1.03], -1)
    return rgb


def grass(n: int, seed: int) -> np.ndarray:
    px_m = n / GRASS_TILE_M
    v = (fnoise(n, 1.5, 4, seed, aniso=0.45) * 0.10 + fnoise(n, 4, 16, seed + 1) * 0.08
         + fnoise(n, 0.3 * px_m, 1.5 * px_m, seed + 2) * 0.07 + fnoise(n, 2 * px_m, n, seed + 3) * 0.05)
    hue = fnoise(n, 0.5 * px_m, 3 * px_m, seed + 4) * 0.5 + fnoise(n, 3, 10, seed + 5) * 0.3
    base = GRASS_RGB[None, None, :] * (1.0 + v[..., None])
    dry = np.array([14.0, 6.0, -6.0])                      # yellowish / dry patches
    rgb = base + dry[None, None, :] * hue[..., None]
    dirt = np.clip(fnoise(n, 0.6 * px_m, 2.5 * px_m, seed + 6) - 2.0, 0, 1)[..., None]
    rgb = rgb * (1 - dirt * 0.5) + np.array([96.0, 84.0, 60.0]) * dirt * 0.5
    return rgb * (GRASS_RGB.mean() / rgb.mean())


def paint(n: int = 128) -> np.ndarray:
    g = 222 + fnoise(n, 2, 12, 31) * 6 - np.clip(fnoise(n, 3, 20, 32) - 1.6, 0, 2) * 40
    return np.stack([g, g, g * 0.985], -1)


def kerb() -> np.ndarray:
    h, w = 256, 64
    a = np.zeros((h, w, 3), np.float32)
    a[: h // 2] = (178, 32, 30)
    a[h // 2:] = (214, 212, 204)
    a[h // 2 - 2: h // 2 + 2] *= 0.75
    a[:2] *= 0.75
    a[-2:] *= 0.75
    wear = fnoise(256, 3, 30, 41)[:, :w, None]
    return a * (0.92 + 0.06 * wear) - np.clip(wear - 1.3, 0, 2) * 18


def barrier() -> np.ndarray:
    """Red / white water-filled barrier modules: u along (2 modules = 4 m), v up."""
    h, w = 128, 512
    a = np.zeros((h, w, 3), np.float32)
    a[:, : w // 2] = (186, 30, 28)
    a[:, w // 2:] = (218, 216, 210)
    y = np.linspace(1, 0, h)[:, None, None]               # row 0 = top
    shade = 0.78 + 0.22 * y
    shade = shade - 0.10 * np.exp(-((y - 0.55) / 0.06) ** 2)   # moulded groove
    a = a * shade
    for x0 in (0, w // 2):                                 # joints between modules
        a[:, x0: x0 + 4] *= 0.35
        a[:, x0 - 4 + (w if x0 == 0 else 0): x0 + (w if x0 == 0 else 0)] *= 0.35
    a[-10:] *= 0.7                                         # dirty foot
    a *= 0.95 + 0.04 * fnoise(512, 4, 40, 51)[:h, :, None]
    return a


def tyre() -> np.ndarray:
    """Stack of four tyres, v up; the right 1/8 of the texture is plain rubber for the top."""
    h, w = 256, 256
    y = (np.arange(h) + 0.5) / h * 4 % 1.0                 # position inside one tyre
    prof = np.sin(np.pi * y) ** 0.6                        # rounded sidewall
    g = 14 + 30 * prof
    a = np.repeat(g[:, None], w, 1)
    tread = (np.sin(np.arange(w) / w * 2 * np.pi * 24) > 0.6)[None, :] & (np.abs(y - 0.5) < 0.3)[:, None]
    a = a - tread * 9
    a += fnoise(256, 2, 10, 61) * 2.0
    a[: h // 4, : w - w // 8] = 170 + 40 * prof[: h // 4, None] + fnoise(256, 2, 10, 62)[: h // 4, : w - w // 8] * 4   # top tyre painted white
    a[:, -w // 8:] = 24
    return np.stack([a, a, a * 1.02], -1)


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


def roof(base: float = 92.0) -> np.ndarray:
    n = 256
    g = base + fnoise(n, 4, 40, 121) * 4 + (np.arange(n) % 16 < 2)[None, :] * -14
    return np.stack([g, g * 1.01, g * 1.04], -1)


def concrete() -> np.ndarray:
    n = 256
    g = 150 + fnoise(n, 2, 8, 151) * 5 + fnoise(n, 20, 120, 152) * 7 - np.clip(fnoise(n, 6, 40, 153) - 1.5, 0, 2) * 16
    return np.stack([g, g * 0.99, g * 0.96], -1)


def metal() -> np.ndarray:
    g = 60 + fnoise(64, 2, 16, 131) * 3
    return np.stack([g, g, g * 1.05], -1)


def signs() -> np.ndarray:
    """1024 x 512 atlas. Cells (u0, v0, u1, v1) are listed in SIGN_UV (v measured upwards)."""
    im = Image.new("RGB", (1024, 512), (20, 20, 22))
    d = ImageDraw.Draw(im)
    # chevron, pointing left: 256 x 128 at (0, 0)
    d.rectangle([0, 0, 255, 127], fill=(238, 196, 16))
    for k in range(3):
        x = 30 + k * 80
        d.polygon([(x + 50, 10), (x + 80, 10), (x + 30, 64), (x + 80, 118), (x + 50, 118), (x, 64)], fill=(16, 16, 18))
    # brake boards 100 / 50 at (256, 0) and (384, 0): 128 x 128
    f = ImageFont.truetype(FONT, 58)
    for k, t in enumerate(("100", "50")):
        x0 = 256 + k * 128
        d.rectangle([x0, 0, x0 + 127, 127], fill=(236, 236, 232), outline=(16, 16, 18), width=6)
        tw = d.textlength(t, font=f)
        d.text((x0 + 64 - tw / 2, 30), t, font=f, fill=(16, 16, 18))
    # checker at (512, 0): 128 x 128
    for i in range(8):
        for j in range(8):
            if (i + j) % 2 == 0:
                d.rectangle([512 + i * 16, j * 16, 527 + i * 16, 15 + j * 16], fill=(236, 236, 232))
    # pit sign at (640, 0)
    d.rectangle([640, 0, 767, 127], fill=(20, 60, 150), outline=(236, 236, 232), width=6)
    f2 = ImageFont.truetype(FONT, 50)
    d.text((640 + 64 - d.textlength("PIT", font=f2) / 2, 36), "PIT", font=f2, fill=(236, 236, 232))
    # start / finish banner at (0, 128): 1024 x 128
    d.rectangle([0, 128, 1023, 255], fill=(18, 30, 62))
    for i in range(8):
        for j in range(8):
            if (i + j) % 2 == 0:
                for x0 in (0, 896):
                    d.rectangle([x0 + i * 16, 128 + j * 16, x0 + i * 16 + 15, 143 + j * 16], fill=(236, 236, 232))
    f3 = ImageFont.truetype(FONT, 54)
    t = "SOSNOVÁ  START / FINISH"
    d.text((512 - d.textlength(t, font=f3) / 2, 160), t, font=f3, fill=(240, 240, 236))
    return np.asarray(im, np.float32)


# name: (u0, v0, u1, v1) with v upwards
SIGN_UV = {
    "chevron": (0.0, 0.75, 0.25, 1.0),
    "b100": (0.25, 0.75, 0.375, 1.0),
    "b50": (0.375, 0.75, 0.5, 1.0),
    "checker": (0.5, 0.75, 0.625, 1.0),
    "pit": (0.625, 0.75, 0.75, 1.0),
    "banner": (0.0, 0.5, 1.0, 0.75),
    "dark": (0.02, 0.02, 0.04, 0.04),
}


def _match(photo: np.ndarray, gain: np.ndarray) -> np.ndarray:
    return np.clip(photo * gain[None, None, :], 0, 255)


def ortho_textures(zone_mask_025: np.ndarray, blend_m: float = 22.0) -> tuple[bytes, bytes]:
    """Near and far ground photos, colour-matched to the tiled grass.

    zone_mask_025: boolean raster (0.25 m/px, north up) of the area covered by tiled grass / asphalt meshes.
    Just outside it the photo is faded into the plain grass colour so the change of texture is not a hard line."""
    cls = np.load(os.path.join(WORK, "classes.npz"))
    near = np.asarray(Image.open(os.path.join(WORK, "ortho_025.png")).convert("RGB"), np.float32)
    veg = ~(cls["asphalt"] | cls["roof"] | cls["tree"])
    veg &= (near[..., 1] > near[..., 0]) & (near[..., 1] > near[..., 2])
    gain = GRASS_RGB / near[veg].mean(0)
    gain = np.clip(gain, 0.4, 1.3)
    near = _match(near, gain)
    dist = ndi.distance_transform_edt(~zone_mask_025) * 0.25
    t = np.clip(1.0 - dist / blend_m, 0, 1)
    t = (t * t * (3 - 2 * t))[..., None]
    flat = GRASS_RGB[None, None, :] * (1 + 0.05 * ndi.zoom(fnoise(256, 8, 64, 141), (near.shape[0] / 256, near.shape[1] / 256), order=1)[..., None])
    near = near * (1 - t) + flat * t
    near_im = Image.fromarray(near.astype(np.uint8)).resize((4096, 4096), Image.LANCZOS)
    near_im = near_im.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    buf = io.BytesIO()
    near_im.save(buf, "JPEG", quality=86)
    far = np.asarray(Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB"), np.float32)
    far_im = Image.fromarray(_match(far, gain).astype(np.uint8)).resize((2048, 2048), Image.LANCZOS)
    buf2 = io.BytesIO()
    far_im.save(buf2, "JPEG", quality=86)
    return buf.getvalue(), buf2.getvalue()


def build_static() -> dict[str, bytes]:
    return {
        "road.jpg": _jpg(asphalt(2048, ROAD_TILE_M, 57, 1, True, 0)),
        "apron.jpg": _jpg(asphalt(1024, APRON_TILE_M, 68, 11, False, 2)),
        "grass.jpg": _jpg(grass(1024, 21)),
        "paint.jpg": _jpg(paint()),
        "kerb.jpg": _jpg(kerb()),
        "barrier.jpg": _jpg(barrier()),
        "tyre.jpg": _jpg(tyre()),
        "trees.png": _png(trees()),
        "forest.png": _png(forest()),
        "building.jpg": _jpg(building()),
        "roof.jpg": _jpg(roof()),
        "roofwhite.jpg": _jpg(roof(196.0)),
        "concrete.jpg": _jpg(concrete()),
        "metal.jpg": _jpg(metal()),
        "signs.jpg": _jpg(signs(), 92),
    }


if __name__ == "__main__":
    out = os.path.join(WORK, "tex_preview")
    os.makedirs(out, exist_ok=True)
    for name, data in build_static().items():
        open(os.path.join(out, name), "wb").write(data)
        im = Image.open(io.BytesIO(data))
        print(f"{name:14} {im.size} {len(data) / 1024:7.0f} kB mean {np.asarray(im.convert('RGB')).reshape(-1, 3).mean(0).round(0)}")
