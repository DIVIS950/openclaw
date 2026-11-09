"""Height model: a smooth road surface (centre profile + camber) and a ground raster that blends into it.

The LiDAR terrain model (CUZK DMR 5G, 1 m) carries about 0.1 m of noise, which is what made the first
version bumpy. Here the road is an analytic surface: height along the lap z(s) and cross-fall camber(s),
both fitted to the terrain across the full road width and smoothed along the lap. The ground next to
the road is the terrain plus a correction that fades out over 25 m, so nothing steps at the road edge.

Writes source/work/heights.npz
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, META_FAR, SRC, WORK, closed_frames, periodic_gauss  # noqa: E402

G_GSD = 0.5          # ground raster resolution (m)
Z_SIGMA = 9.0        # smoothing of the centre profile along the lap (m)
CAMBER_SIGMA = 12.0  # smoothing of the cross-fall along the lap (m)
CAMBER_MAX = 0.035   # cross-fall clamp (3.5 %)
FADE_M = 25.0        # distance over which the ground returns to the raw terrain
DEM_SIGMA = 3.5      # terrain smoothing for the ground (m)
EDGE_MARGIN = 2.0    # the ground keeps the plane of the road this far beyond the road edge (m)


class Raster:
    """North-up raster centred on the site; pixel centres at half-pixel offsets."""

    def __init__(self, a: np.ndarray, half_e: float, half_n: float, gsd: float):
        self.a, self.half_e, self.half_n, self.gsd = a, half_e, half_n, gsd
        self.rows, self.cols = a.shape

    def sample(self, en: np.ndarray) -> np.ndarray:
        en = np.atleast_2d(en)
        px = np.clip((en[:, 0] + self.half_e) / self.gsd - 0.5, 0, self.cols - 1.001)
        py = np.clip((self.half_n - en[:, 1]) / self.gsd - 0.5, 0, self.rows - 1.001)
        x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
        fx, fy = px - x0, py - y0
        a = self.a
        return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
                + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)

    def centres(self) -> np.ndarray:
        x = (np.arange(self.cols) + 0.5) * self.gsd - self.half_e
        y = self.half_n - (np.arange(self.rows) + 0.5) * self.gsd
        xx, yy = np.meshgrid(x, y)
        return np.column_stack([xx.ravel(), yy.ravel()])


def load_dem(path: str) -> np.ndarray:
    a = np.asarray(Image.open(path), dtype=np.float64)
    a = np.where(a < -9000, np.nan, a)
    if np.isnan(a).any():
        idx = ndi.distance_transform_edt(np.isnan(a), return_distances=False, return_indices=True)
        a = a[tuple(idx)]
    return a


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def main() -> None:
    cl = json.load(open(os.path.join(WORK, "centerline.json"), encoding="utf-8"))
    c = np.array(cl["en"])
    wl, wr = np.array(cl["wl"]), np.array(cl["wr"])
    n_st = len(c)
    _, nrm, _, _ = closed_frames(c)

    raw = load_dem(os.path.join(SRC, "cuzk", "dem.tif"))
    dem_fit = Raster(ndi.gaussian_filter(raw, 1.5), HALF_E, HALF_N, 1.0)
    dem_gnd = Raster(ndi.gaussian_filter(raw, DEM_SIGMA), HALF_E, HALF_N, 1.0)

    # ---- road: least-squares line across the width at every station, then smoothing along the lap
    z0, cam = np.zeros(n_st), np.zeros(n_st)
    for i in range(n_st):
        d = np.linspace(-(wr[i] - 0.8), wl[i] - 0.8, 9)
        h = dem_fit.sample(c[i] + nrm[i] * d[:, None])
        a, b = np.polyfit(d, h, 1)
        cam[i], z0[i] = a, b
    z = periodic_gauss(z0, Z_SIGMA)
    camber = np.clip(periodic_gauss(cam, CAMBER_SIGMA), -CAMBER_MAX, CAMBER_MAX)
    camber = periodic_gauss(camber, 3.0)
    grade = (np.roll(z, -1) - np.roll(z, 1)) / 2.0
    bend = np.roll(z, -1) - 2 * z + np.roll(z, 1)
    print(f"road height {z.min():.2f}..{z.max():.2f} m a.s.l. (span {np.ptp(z):.2f} m)")
    print(f"gradient {grade.min() * 100:+.2f}..{grade.max() * 100:+.2f} %, camber {camber.min() * 100:+.2f}..{camber.max() * 100:+.2f} %")
    print(f"vertical curvature max {np.abs(bend).max():.5f} 1/m; fit residual to terrain rms {np.sqrt(np.mean((z - z0) ** 2)):.3f} m")

    # ---- ground raster
    rows, cols = int(2 * HALF_N / G_GSD), int(2 * HALF_E / G_GSD)
    g = Raster(np.zeros((rows, cols)), HALF_E, HALF_N, G_GSD)
    pts = g.centres()
    # centreline densified to 0.25 m for a clean nearest-station lookup
    m = 4
    idx = np.arange(n_st * m) / m
    i0 = np.floor(idx).astype(int) % n_st
    f = (idx - np.floor(idx))[:, None]
    lerp = lambda v: v[i0] * (1 - f[:, 0]) + v[(i0 + 1) % n_st] * f[:, 0]  # noqa: E731
    cd = c[i0] * (1 - f) + c[(i0 + 1) % n_st] * f
    nd = nrm[i0] * (1 - f) + nrm[(i0 + 1) % n_st] * f
    nd /= np.linalg.norm(nd, axis=1, keepdims=True)
    zd, camd, wld, wrd = lerp(z), lerp(camber), lerp(wl), lerp(wr)
    dist, j = cKDTree(cd).query(pts)
    lat = np.einsum("ij,ij->i", pts - cd[j], nd[j])
    inside = (lat <= wld[j] + EDGE_MARGIN) & (lat >= -wrd[j] - EDGE_MARGIN) & (dist < 14)
    road = zd[j] + camd[j] * np.clip(lat, -wrd[j] - EDGE_MARGIN, wld[j] + EDGE_MARGIN)
    terr = dem_gnd.sample(pts)
    inside2 = inside.reshape(rows, cols)
    delta = np.where(inside2, (road - terr).reshape(rows, cols), 0.0)
    sig = 4.0 / G_GSD
    num = ndi.gaussian_filter(delta, sig)
    den = ndi.gaussian_filter(inside2.astype(float), sig)
    ext = np.where(den > 1e-4, num / np.maximum(den, 1e-4), 0.0)
    out_d = ndi.distance_transform_edt(~inside2) * G_GSD
    fade = smoothstep(1.0 - out_d / FADE_M)
    ground = np.where(inside2, road.reshape(rows, cols), terr.reshape(rows, cols) + fade * ext)
    # soften the small step that is left where the road plane hands over to the terrain
    ground = np.where(inside2, ground, ndi.gaussian_filter(ground, 1.5 / G_GSD))
    print(f"ground raster {cols}x{rows} at {G_GSD} m; road/terrain correction rms {np.sqrt(np.mean(delta[inside2] ** 2)):.3f} m, max {np.abs(delta).max():.3f} m")

    far = ndi.gaussian_filter(load_dem(os.path.join(SRC, "cuzk_far", "dem.tif")), 1.0)
    np.savez_compressed(os.path.join(WORK, "heights.npz"), z=z, camber=camber, ground=ground.astype(np.float32),
                        far=far.astype(np.float32), z_raw=z0, camber_raw=cam)
    print("wrote", os.path.join(WORK, "heights.npz"))


class Heights:
    """Loader used by the builder."""

    def __init__(self):
        d = np.load(os.path.join(WORK, "heights.npz"))
        self.z, self.camber = d["z"], d["camber"]
        self.g = Raster(d["ground"].astype(np.float64), HALF_E, HALF_N, G_GSD)
        fh = META_FAR["half_m"]
        self.far = Raster(d["far"].astype(np.float64), fh[0], fh[1], META_FAR["dem_gsd"])

    def road(self, i: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """Road surface height (m a.s.l.) at station index i (may be fractional) and lateral offset (+ left)."""
        n = len(self.z)
        i = np.asarray(i, float)
        a = np.floor(i).astype(int) % n
        f = i - np.floor(i)
        b = (a + 1) % n
        return (self.z[a] * (1 - f) + self.z[b] * f) + (self.camber[a] * (1 - f) + self.camber[b] * f) * lat

    def ground(self, en: np.ndarray) -> np.ndarray:
        return self.g.sample(en)

    def far_ground(self, en: np.ndarray) -> np.ndarray:
        return self.far.sample(en)


if __name__ == "__main__":
    main()
