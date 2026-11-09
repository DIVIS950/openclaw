#!/usr/bin/env python3
"""Trace a hand-drawn route line (red) on a north-up aerial image into an ordered pixel loop.

Usage: python trace_route.py source/trace/aerial.png --out source/trace/route_pixels.json --start 770,604 --east-at 480,900,560
  --start   pixel near which the lap starts
  --east-at xmin,xmax,ymin : a stretch of the route where travel is towards +x (east); fixes the direction
Needs: pip install numpy pillow scikit-image scipy
"""
import argparse, json
import numpy as np
from PIL import Image
from scipy.ndimage import convolve, label, sum as ndsum
from skimage.morphology import skeletonize, closing, disk, remove_small_objects

ap = argparse.ArgumentParser()
ap.add_argument("image"); ap.add_argument("--out", default="route_pixels.json")
ap.add_argument("--start", default="0,0"); ap.add_argument("--east-at", default=None)
a = ap.parse_args()

im = np.asarray(Image.open(a.image).convert("RGB")).astype(int)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
red = (r > 170) & (g < 110) & (b < 110) & (r - g > 80)
red = closing(red, disk(3)); red = remove_small_objects(red, max_size=200)
lab, n = label(red); sizes = ndsum(red, lab, range(1, n + 1)); sk = skeletonize(lab == (np.argmax(sizes) + 1))
for _ in range(300):  # prune spurs (arrow heads) until only the cycle is left
    nb = convolve(sk.astype(int), np.ones((3, 3)), mode="constant") - sk
    ends = np.argwhere(sk & (nb == 1))
    if not len(ends): break
    for y, x in ends: sk[y, x] = False
pts = np.argwhere(sk); cur = tuple(pts[0]); path = [cur]; seen = {cur}
while True:
    y, x = cur
    nxt = [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and 0 <= y + dy < sk.shape[0] and 0 <= x + dx < sk.shape[1] and sk[y + dy, x + dx] and (y + dy, x + dx) not in seen]
    if not nxt: break
    nxt.sort(key=lambda p: abs(p[0] - y) + abs(p[1] - x)); cur = nxt[0]; seen.add(cur); path.append(cur)
P = np.array([(x, y) for y, x in path], float)[::3]
if a.east_at:
    x0, x1, y0 = map(float, a.east_at.split(","))
    idx = np.where((P[:, 0] > x0) & (P[:, 0] < x1) & (P[:, 1] > y0))[0]
    if len(idx) > 2 and np.sum(np.diff(P[idx], axis=0)[:, 0]) < 0: P = P[::-1]
sx, sy = map(float, a.start.split(",")); P = np.roll(P, -int(np.argmin(np.linalg.norm(P - [sx, sy], axis=1))), axis=0)
# yellow dots = cone chicanes; keep their centroids too
yellow = (r > 190) & (g > 165) & (b < 115) & (r - b > 100)
yl, yn = label(remove_small_objects(yellow, max_size=11))
cones = [[float(c[1]), float(c[0])] for c in __import__("scipy.ndimage", fromlist=["center_of_mass"]).center_of_mass(yellow, yl, range(1, yn + 1))]
json.dump({"pixels": P.tolist(), "image": a.image, "cones_px": cones}, open(a.out, "w"))
print(f"{len(cones)} cone dots")
print(f"{len(P)} points, perimeter {np.sum(np.linalg.norm(np.diff(np.vstack([P, P[:1]]), axis=0), axis=1)):.0f} px -> {a.out}")
