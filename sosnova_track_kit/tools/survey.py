"""Step 2: what stands on the ground. Combines the surface model (DMP 1G), the terrain model (DMR 5G) and the
orthophoto into working rasters: object height, buildings, tree canopy, drivable hard surface.
Writes source/work/survey.npz"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, SRC, WORK  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
H_GSD = 0.5       # raster resolution of the height products (m)
C_GSD = 0.25      # raster resolution of the colour classes (m)


def colour_classes(rgb: np.ndarray):
    """rgb float 0..1 -> (vegetation, grey hard surface, brightness, saturation)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    bri, sat = rgb.mean(-1), rgb.max(-1) - rgb.min(-1)
    veg = (g > b + 0.02) & (g >= r - 0.012)                       # green or yellow-green, also when dark
    grey = (sat < 0.075) & (r - b < 0.035) & ~((g > r + 0.012) & (g > b + 0.012)) & (bri > 0.12)
    return veg, grey, bri, sat


def main() -> None:
    dsm = np.asarray(Image.open(os.path.join(SRC, "cuzk", "dsm.tif")), dtype=np.float64)
    dtm = np.asarray(Image.open(os.path.join(SRC, "cuzk", "dem.tif")), dtype=np.float64)
    dtm = ndi.zoom(dtm, dsm.shape[0] / dtm.shape[0], order=1)
    ndsm = np.where(dsm < -9000, 0.0, dsm - dtm)
    photo = np.asarray(Image.open(os.path.join(WORK, "ortho_025.png")).convert("RGB"), np.float32) / 255.0
    photo = ndi.uniform_filter(photo, size=(3, 3, 1))
    veg, grey, bri, sat = colour_classes(photo)
    up = lambda a: np.repeat(np.repeat(a, 2, 0), 2, 1)                       # 0.5 m -> 0.25 m
    # buildings are tall and smooth on top, trees are tall and rough
    smooth_top = ndi.grey_opening(ndsm, size=3)
    mean = ndi.uniform_filter(ndsm, 5)
    rough = np.sqrt(np.maximum(ndi.uniform_filter(ndsm ** 2, 5) - mean ** 2, 0))
    flat_roof = (smooth_top > 2.2) & (ndi.grey_erosion(rough, size=3) < 0.45)
    flat_roof = ndi.binary_opening(flat_roof, iterations=2)
    lab, n = ndi.label(ndi.binary_dilation(flat_roof, iterations=2) & (smooth_top > 1.8))
    area = ndi.sum(np.ones_like(lab), lab, np.arange(1, n + 1)) * H_GSD ** 2
    greenness = ndi.mean(ndi.zoom(veg.astype(np.float32), 0.5, order=1), lab, np.arange(1, n + 1))
    keep = np.concatenate([[False], (area > 30) & (greenness < 0.35) & (area < 4000)])
    building = up(keep[lab])
    tall = up(ndsm) > 3.0
    canopy = np.where(tall & ~ndi.binary_dilation(building, iterations=6), up(ndsm), 0.0)
    hard = grey & ~ndi.binary_dilation(building, iterations=3) & (up(ndsm) < 1.0)
    hard = ndi.binary_closing(ndi.binary_opening(hard, iterations=2), iterations=6)
    hard &= ~ndi.binary_dilation(building, iterations=2)
    np.savez_compressed(os.path.join(WORK, "survey.npz"), ndsm=ndsm.astype(np.float32), building=building, canopy=canopy.astype(np.float32),
                        hard=hard)
    print("ndsm %dx%d; buildings %.1f%%, canopy %.1f%%, hard surface %.1f%% of the site"
          % (ndsm.shape[1], ndsm.shape[0], building.mean() * 100, (canopy > 0).mean() * 100, hard.mean() * 100))
    dbg = (photo * 255 * 0.55).astype(np.uint8)
    dbg[hard] = (dbg[hard] * 0.5 + np.array([90, 90, 140])).astype(np.uint8)
    dbg[building] = (255, 80, 60)
    dbg[canopy > 0] = (dbg[canopy > 0] * 0.4 + np.array([0, 150, 0])).astype(np.uint8)
    Image.fromarray(dbg).resize((1280, 1160), Image.BOX).save(os.path.join(WORK, "survey_debug.png"))


if __name__ == "__main__":
    main()
