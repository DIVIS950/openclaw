"""Step 1: classify the orthophoto into working rasters (0.25 m/px): asphalt, trees, roofs."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from common import SRC, WORK

Image.MAX_IMAGE_PIXELS = None


def main() -> None:
    os.makedirs(WORK, exist_ok=True)
    im = Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("RGB")
    half = im.resize((im.width // 2, im.height // 2), Image.BOX)  # 0.25 m/px
    half.save(os.path.join(WORK, "ortho_025.png"))
    a = np.asarray(half).astype(np.float32) / 255.0
    a = ndi.uniform_filter(a, size=(3, 3, 1))
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    sat, bri = a.max(-1) - a.min(-1), a.mean(-1)
    asphalt = (sat < 0.075) & (bri > 0.40) & (bri < 0.70) & (g - r < 0.035) & (r - b < 0.03)
    asphalt = ndi.binary_closing(ndi.binary_opening(asphalt, iterations=2), iterations=4)
    tree = (g > r + 0.01) & (g > b + 0.04) & (bri < 0.42) & ~asphalt
    tree = ndi.binary_opening(tree, iterations=3)
    roof = (sat < 0.12) & (bri >= 0.72)
    roof = ndi.binary_opening(roof, iterations=3)
    np.savez_compressed(os.path.join(WORK, "classes.npz"), asphalt=asphalt, tree=tree, roof=roof)
    print("asphalt %.1f%% tree %.1f%% roof %.1f%%" % (asphalt.mean() * 100, tree.mean() * 100, roof.mean() * 100))


if __name__ == "__main__":
    main()
