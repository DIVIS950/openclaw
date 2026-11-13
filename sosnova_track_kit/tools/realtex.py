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
LAP_PX = (1536, 512)              # rows (along, 2 cm per pixel), columns (across); twice the columns where the road is wide
LAP_MARGIN = (1.0, 0.3)           # texture overlap beyond the mesh along and across (m), so filtering never wraps
ASPH_TILE = 40.0                  # the asphalt beside the lap is cut into squares of this size (m), one texture each
ASPH_PX = 1024
ASPH_MARGIN = 3.0                 # a triangle may reach this far out of its square (m)
GROOVE_SIGMA = 1.15
GRASS_PX = 1024                   # pixels per grass tile: 10 cm per pixel, what the photo holds
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


ASPHALT = (58.0, 57.0, 55.0)        # the dark, neutral grey of the resurfaced track in the 2026 photos
GRAIN_PX, GRAIN_M = 512, 7.68       # the grain tile: 1.5 cm per pixel


def _grain() -> np.ndarray:
    """Close-up asphalt: the scan, with its contrast raised to what one sees from a car, the light stones of the
    aggregate and the dark pits between them."""
    if "grain" not in _cache:
        g = textures.scan("asphalt_track.jpg", ASPHALT, GRAIN_PX, repeat=1, desat=0.6)
        mean = g.reshape(-1, 3).mean(0)
        g = mean + (g - mean) * 1.9
        rng = np.random.default_rng(91)
        stones = (rng.random((GRAIN_PX, GRAIN_PX)) < 0.014).astype(np.float32) * rng.uniform(18, 52, (GRAIN_PX, GRAIN_PX))
        pits = (rng.random((GRAIN_PX, GRAIN_PX)) < 0.010).astype(np.float32) * rng.uniform(10, 22, (GRAIN_PX, GRAIN_PX))
        # wrap-around blur, so the tile still repeats without a seam
        blur = lambda a, sg: np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi * sg) ** 2 * (np.fft.fftfreq(GRAIN_PX)[:, None] ** 2 + np.fft.fftfreq(GRAIN_PX)[None, :] ** 2))))  # noqa: E731
        g = g + (blur(stones, 0.55) * 2.2)[..., None] * np.array([1.0, 0.98, 0.93]) - (blur(pits, 0.6) * 2.0)[..., None]
        _cache["grain"] = np.clip(g, 4, 250).astype(np.float32)
    return _cache["grain"]


def _cracks(shape: tuple[int, int], px_per_m: tuple[float, float], count: int, rng, long_m=(2.0, 9.0)) -> np.ndarray:
    """Fine cracks as a darkening mask (0 = none). shape: rows, columns; px_per_m: along rows, along columns."""
    m = np.zeros(shape, np.float32)
    for _ in range(count):
        length = rng.uniform(*long_m)
        ang = rng.choice([0.0, np.pi / 2]) + rng.normal(0, 0.35)          # mostly along or across
        n = max(4, int(length / 0.25))
        step = np.column_stack([np.cos(ang + np.cumsum(rng.normal(0, 0.22, n))), np.sin(ang + np.cumsum(rng.normal(0, 0.22, n)))]) * 0.25
        pts = np.array([rng.uniform(0, shape[1] / px_per_m[1]), rng.uniform(0, shape[0] / px_per_m[0])]) + np.cumsum(step, axis=0)
        pix = np.round(pts * [px_per_m[1], px_per_m[0]]).astype(np.int32)
        cv2.polylines(m, [pix], False, float(rng.uniform(0.25, 0.5)), 1, cv2.LINE_AA)
    return cv2.GaussianBlur(m, (0, 0), 0.5)


def lap_textures(tr, line_offset: np.ndarray):
    """Returns ({file name: jpeg}, [(first station, last station, material name)])."""
    ratio, ok = _ortho()
    grain, grain_m = _grain(), GRAIN_M
    centre_all = (tr.wl - tr.wr) / 2                                    # the middle of the road: where the two paved lanes meet
    H = LAP_PX[0]
    out, chunks = {}, []
    busy_all = 0.8 + 0.2 * np.clip(np.abs(tr.k) * 40.0, 0, 1)
    for k, a in enumerate(range(0, tr.n, LAP_CHUNK)):
        b = min(tr.n, a + LAP_CHUNK)
        st = np.arange(a, b + 1) % tr.n
        half = float(max(tr.wl[st].max(), tr.wr[st].max())) + LAP_MARGIN[1]            # this piece's own width
        W = LAP_PX[1] * (2 if half > 8.0 else 1)
        fine = 1 + 0.035 * textures.fnoise(W, 2, 5, 771)
        s = (a - LAP_MARGIN[0]) + (b - a + 2 * LAP_MARGIN[0]) * (np.arange(H) + 0.5) / H
        d = -half + 2 * half * (np.arange(W) + 0.5) / W
        ss, dd = np.meshgrid(s, d, indexing="ij")
        en = tr.en(ss.ravel(), dd.ravel()).reshape(H, W, 2)
        r = _sample(ratio, en)
        v = _sample(ok, en)
        # where the photo shows no clean asphalt, take the look of the asphalt around it
        num, den = cv2.GaussianBlur(r * v, (0, 0), 22), cv2.GaussianBlur(v, (0, 0), 22)
        fill = np.where(den > 0.03, num / np.maximum(den, 1e-4), 1.0)
        r = cv2.GaussianBlur(r * v + fill * (1 - v), (0, 0), 1.1)
        macro = 1 + 1.05 * (np.clip(r, 0.62, 1.5) - 1)
        gx = ((dd % grain_m) / grain_m * GRAIN_PX).astype(np.float32)
        gy = ((ss % grain_m) / grain_m * GRAIN_PX).astype(np.float32)
        tex = cv2.remap(grain, gx, gy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
        tex = tex * np.tile(fine, (H // W + 1, 1))[:H, :, None] * macro[..., None]
        off = tr.interp(line_offset, ss.ravel()).reshape(H, W)
        busy = tr.interp(busy_all, ss.ravel()).reshape(H, W)
        tex *= (1 - 0.17 * np.exp(-0.5 * ((dd - off) / GROOVE_SIGMA) ** 2) * busy)[..., None]     # rubber on the racing line
        # single tyre marks: pairs of dark lines a car width apart, where cars brake and turn. They begin and end
        # inside this piece of road
        rng = np.random.default_rng(7000 + k)
        turn = float(np.clip(np.abs(tr.k[st]).max() * 30.0, 0, 1))
        for _ in range(rng.poisson(1.2 + 3.0 * turn)):
            length = rng.uniform(5.0, min(20.0, b - a - 2.0))
            s0 = rng.uniform(a + 0.5, b - 0.5 - length)
            lat0 = float(tr.interp(line_offset, np.array([s0 + length / 2]))[0]) + rng.normal(0, 1.1)
            drift = rng.normal(0, 0.035)
            t_ = (ss - s0) / length
            body = np.clip(np.minimum(t_, 1 - t_) * 6.0, 0, 1) * ((t_ > 0) & (t_ < 1))
            core = dd - (lat0 + drift * (ss - s0))
            mark = np.exp(-0.5 * ((core - 0.76) / 0.085) ** 2) + np.exp(-0.5 * ((core + 0.76) / 0.085) ** 2)
            tex *= (1 - rng.uniform(0.10, 0.26) * body * mark)[..., None]
        # the seam where the two paved lanes meet, and a few fine cracks
        mid = tr.interp(centre_all, ss.ravel()).reshape(H, W) + 0.05 * np.sin(ss * 0.21)
        tex *= (1 - 0.08 * np.exp(-0.5 * ((dd - mid) / 0.035) ** 2))[..., None]
        tex *= (1 - _cracks((H, W), (H / (b - a + 2 * LAP_MARGIN[0]), W / (2 * half)), int(rng.poisson(1.0)), rng))[..., None]
        # dust along the edges, only where the asphalt really ends there
        wl_, wr_ = tr.interp(tr.wl, ss.ravel()).reshape(H, W), tr.interp(tr.wr, ss.ravel()).reshape(H, W)
        cl_, cr_ = tr.interp(1.0 - tr.open_l.astype(float), ss.ravel()).reshape(H, W), tr.interp(1.0 - tr.open_r.astype(float), ss.ravel()).reshape(H, W)
        tex *= (1 + 0.07 * cl_ * np.clip((dd - (wl_ - 0.55)) / 0.5, 0, 1) + 0.07 * cr_ * np.clip((-dd - (wr_ - 0.55)) / 0.5, 0, 1))[..., None]
        name = f"lap{k:02d}"
        out[name + ".jpg"] = _jpg(tex, 80)
        chunks.append((a, b, name, half))
    return out, chunks


def lap_uv(a: int, b: int, half: float, station: np.ndarray, lateral: np.ndarray) -> np.ndarray:
    """Texture coordinates (v upwards) of points of the lap chunk a..b whose texture reaches `half` m to each side."""
    u = (lateral + half) / (2 * half)
    v = 1.0 - (station - (a - LAP_MARGIN[0])) / (b - a + 2 * LAP_MARGIN[0])
    return np.column_stack([u, v])


def asphalt_tile(e0: float, n0: float) -> bytes:
    """Texture of the asphalt in the square whose south-west corner is (e0, n0): the real light and dark of the
    photo over the same scanned grain as the lap, so the two meet without a step."""
    ratio, ok = _ortho()
    grain, grain_m = _grain(), GRAIN_M
    ext = ASPH_TILE + 2 * ASPH_MARGIN
    t = (np.arange(ASPH_PX) + 0.5) / ASPH_PX
    ee, nn = np.meshgrid(e0 - ASPH_MARGIN + ext * t, n0 + ASPH_TILE + ASPH_MARGIN - ext * t)
    en = np.stack([ee, nn], -1)
    r, v = _sample(ratio, en), _sample(ok, en)
    sig = 22 * (ASPH_PX / ext) / (LAP_PX[0] / (LAP_CHUNK + 2 * LAP_MARGIN[0]))          # the same reach in metres as on the lap
    num, den = cv2.GaussianBlur(r * v, (0, 0), sig), cv2.GaussianBlur(v, (0, 0), sig)
    fill = np.where(den > 0.03, num / np.maximum(den, 1e-4), 1.0)
    r = cv2.GaussianBlur(r * v + fill * (1 - v), (0, 0), 0.8)
    macro = 1 + 1.05 * (np.clip(r, 0.62, 1.5) - 1)
    gx = ((ee % grain_m) / grain_m * GRAIN_PX).astype(np.float32)
    gy = ((nn % grain_m) / grain_m * GRAIN_PX).astype(np.float32)
    tex = cv2.remap(grain, gx, gy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    tex = tex * (1 + 0.035 * textures.fnoise(ASPH_PX, 2, 5, 771))[..., None] * macro[..., None]
    rng = np.random.default_rng(int(abs(e0) * 131 + abs(n0) * 17) + 5)     # the older asphalt beside the lap has more cracks
    tex *= (1 - _cracks((ASPH_PX, ASPH_PX), (ASPH_PX / ext, ASPH_PX / ext), int(rng.poisson(5.0)), rng, long_m=(3.0, 14.0)))[..., None]
    return _jpg(tex, 80)


def asphalt_uv(e0: float, n0: float, en: np.ndarray) -> np.ndarray:
    ext = ASPH_TILE + 2 * ASPH_MARGIN
    return np.column_stack([(en[:, 0] - e0 + ASPH_MARGIN) / ext, (en[:, 1] - n0 + ASPH_MARGIN) / ext])


def _grass_canvas():
    """The site photo in game colours with everything that is not vegetation filled from the vegetation around it."""
    if "grass" not in _cache:
        n = 4096
        rgb = photo.site_canvas(n)
        w = photo.classes(rgb)
        toned, _ = photo.tone(rgb, w)
        toned = toned * photo.DETAIL_MEAN
        toned = np.clip(toned + w[..., 2:3] * rgb * 0.16, 0, 1)        # straw, sand and bare earth keep their light, warm colour
        veg = cv2.GaussianBlur((w[..., 1] > 0.6).astype(np.float32), (0, 0), 1.2)
        sig = 3.5 / (2 * SITE_HALF / n)
        num = cv2.GaussianBlur(toned * veg[..., None], (0, 0), sig)
        den = cv2.GaussianBlur(veg, (0, 0), sig)[..., None]
        base = np.array(textures.GRASS_MEAN, np.float32) / 255.0
        fill = np.where(den > 0.03, num / np.maximum(den, 1e-4), base)
        # only beside the asphalt of the circuit: there the photo's road edge, paint and cars must not bleed into
        # the grass. Further away the photo stays as it is: the paddock, the yards, paths and bare earth are real
        import realmap
        from shapely.geometry import Polygon as _Pg
        near = np.zeros((n, n), np.uint8)
        P_ = realmap.asphalt().buffer(4.0)
        for g_ in getattr(P_, "geoms", [P_]):
            for k_, ring in enumerate([g_.exterior, *g_.interiors]):
                xy = np.array(ring.coords)
                px = np.round(np.column_stack([(xy[:, 0] + SITE_HALF) / (2 * SITE_HALF) * n, (SITE_HALF - xy[:, 1]) / (2 * SITE_HALF) * n])).astype(np.int32)
                cv2.fillPoly(near, [px], 1 if k_ == 0 else 0)
        near = cv2.GaussianBlur(near.astype(np.float32), (0, 0), 6.0)[..., None]
        keep = 1 - (1 - veg[..., None]) * near
        out = toned * keep + fill * (1 - keep)
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
