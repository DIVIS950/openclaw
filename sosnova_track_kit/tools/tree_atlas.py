"""Cut the tree renders made by mktrees.py into single trees and pack them into textures for the game.
usage: python3 tree_atlas.py <name> <render.png> [<render.png> ...]
Writes source/assets/tree_<name>.png and adds the cells to source/assets/trees.json"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SRC  # noqa: E402

ASSETS = os.path.join(SRC, "assets")
SIZE = 1024


def single_trees(path: str) -> list[np.ndarray]:
    """Split a render that shows several trees side by side at the gaps between them."""
    a = np.asarray(Image.open(path).convert("RGBA"), np.float32)
    col = (a[..., 3] > 40).sum(0)
    runs, start = [], None
    for x, c in enumerate(col):
        if c > 6 and start is None:
            start = x
        if c <= 6 and start is not None:
            if x - start > 20:
                runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, len(col)))
    out = []
    for x0, x1 in runs:
        t = a[:, x0:x1]
        rows = np.where((t[..., 3] > 40).any(1))[0]
        out.append(t[rows[0]: rows[-1] + 1])
    return out


def prepare(t: np.ndarray, w: int, h: int) -> np.ndarray:
    """Fit a tree into a cell (bottom centre), make thin foliage survive distance, bleed colour into the clear part."""
    im = Image.fromarray(t.astype(np.uint8), "RGBA")
    k = min(w / im.width, h / im.height) * 0.98
    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    cell = np.zeros((h, w, 4), np.float32)
    x0 = (w - im.width) // 2
    cell[h - im.height:, x0: x0 + im.width] = np.asarray(im, np.float32)
    alpha = np.clip(ndi.gaussian_filter(cell[..., 3], 0.7) * 1.9, 0, 255)
    solid = cell[..., 3] > 128
    idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    rgb = cell[..., :3][idx[0], idx[1]]                      # nearest opaque colour everywhere: no dark fringes
    rgb = np.where(solid[..., None], cell[..., :3], rgb)
    return np.dstack([rgb, alpha]), im.width / im.height


def main() -> None:
    name, files = sys.argv[1], sys.argv[2:]
    trees = [t for f in files for t in single_trees(f)]
    n = len(trees)
    cw = SIZE // n
    atlas = np.zeros((SIZE, SIZE, 4), np.float32)
    cells = []
    for k, t in enumerate(trees):
        cell, aspect = prepare(t, cw, SIZE)
        atlas[:, k * cw: (k + 1) * cw] = cell
        used_w = aspect * 0.98 * SIZE if aspect * SIZE < cw else cw * 0.98
        # texture rectangle that tightly holds the tree, and its width / height in the real world
        u_mid = (k + 0.5) * cw / SIZE
        half = min(cw, used_w / 0.98) / 2 / SIZE
        cells.append(dict(u0=round(u_mid - half, 4), u1=round(u_mid + half, 4), aspect=round(float(min(cw, used_w / 0.98) / SIZE), 4)))
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(ASSETS, f"tree_{name}.png"), optimize=True)
    path = os.path.join(ASSETS, "trees.json")
    data = json.load(open(path)) if os.path.exists(path) else {}
    data[name] = cells
    json.dump(data, open(path, "w"), indent=1)
    print(name, n, "trees", cells)


if __name__ == "__main__":
    main()
