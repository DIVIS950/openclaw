"""Step: trace the painted markings (lines, start boxes, kerb stones) and the tyre barriers from the orthophoto.
Thin paint becomes centre lines with a width, broad paint becomes outlines. The game shows them as sharp
geometry on top of the photo.  Writes source/work/paint.json and source/work/tyre_walls.json"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge_geom as bg  # noqa: E402
from common import HALF_E, HALF_N, SRC, WORK  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
GSD = 0.125


def to_en(xy: np.ndarray) -> np.ndarray:
    xy = np.asarray(xy, float)
    return np.column_stack([(xy[:, 0] + 0.5) * GSD - HALF_E, HALF_N - (xy[:, 1] + 0.5) * GSD])


def trace(skel: np.ndarray) -> list[np.ndarray]:
    """Skeleton pixels -> polylines (pixel x, y). Branch points split the lines."""
    sk = skel.astype(np.uint8)
    nb = ndi.convolve(sk, np.ones((3, 3), int), mode="constant") - sk
    nodes = (sk == 1) & (nb != 2)
    ys, xs = np.where(sk == 1)
    todo = set(zip(ys.tolist(), xs.tolist()))
    out = []

    def neighbours(p):
        y, x = p
        return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (y + dy, x + dx) in pix]

    pix = set(todo)
    starts = [p for p in pix if nodes[p]]
    used_edge = set()
    for s in starts:
        for q in neighbours(s):
            if (s, q) in used_edge:
                continue
            path, prev, cur = [s, q], s, q
            used_edge.add((s, q))
            while not nodes[cur]:
                nxt = [r for r in neighbours(cur) if r != prev and r not in path[-3:]]
                if not nxt:
                    break
                prev, cur = cur, min(nxt, key=lambda r: abs(r[0] - cur[0]) + abs(r[1] - cur[1]))
                path.append(cur)
            used_edge.add((cur, path[-2]))
            todo.difference_update(path)
            out.append(np.array([(x, y) for y, x in path], float))
    while todo:                                           # closed loops without a node
        s = todo.pop()
        path, prev, cur = [s], None, s
        while True:
            nxt = [r for r in neighbours(cur) if r != prev and r in todo]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            todo.discard(cur)
            path.append(cur)
        if len(path) > 3:
            path.append(s)
            out.append(np.array([(x, y) for y, x in path], float))
    return out


def smooth_line(p: np.ndarray, sigma: float = 2.0) -> np.ndarray:
    if len(p) < 6:
        return p
    closed = np.allclose(p[0], p[-1])
    q = ndi.gaussian_filter1d(p, sigma, axis=0, mode="wrap" if closed else "nearest")
    if not closed:
        q[0], q[-1] = p[0], p[-1]
    else:
        q[-1] = q[0]
    return q


def main() -> None:
    rgb = np.asarray(Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("RGB"), np.float32) / 255.0
    lum = rgb.mean(-1)
    sat = rgb.max(-1) - rgb.min(-1)
    sv = np.load(os.path.join(WORK, "survey.npz"))
    up = lambda a: np.repeat(np.repeat(a, 2, 0), 2, 1)
    hard = ndi.binary_dilation(up(sv["hard"]), iterations=5)
    # ---- paint: clearly brighter than the asphalt around it, and thin
    local = ndi.median_filter(ndi.zoom(lum, 0.25, order=1), size=21)             # asphalt level, 0.5 m px, 10 m window
    local = ndi.zoom(local, 4, order=1)[: lum.shape[0], : lum.shape[1]]
    tophat = lum - ndi.grey_opening(lum, size=(11, 11))
    paint = hard & (tophat > 0.085) & (lum > local * 1.17) & (sat < 0.20)
    paint = ndi.binary_closing(paint, iterations=1)
    lab, n = ndi.label(paint, structure=np.ones((3, 3)))
    area = ndi.sum(paint, lab, np.arange(1, n + 1)) * GSD ** 2
    paint = np.concatenate([[False], area >= 0.12])[lab]
    dist = ndi.distance_transform_edt(paint) * GSD
    lab, n = ndi.label(paint, structure=np.ones((3, 3)))
    thick = np.concatenate([[False], ndi.maximum(dist, lab, np.arange(1, n + 1)) > 0.34])[lab]
    lines, areas = [], []
    for p in trace(skeletonize(paint & ~thick)):
        if len(p) < 3:
            continue
        ln = float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) * GSD
        if ln < 0.5:
            continue
        ix, iy = p[:, 0].astype(int), p[:, 1].astype(int)
        w = float(np.clip(2.0 * np.median(dist[iy, ix]) + 0.02, 0.10, 0.34))
        q = smooth_line(p)
        q = cv2.approxPolyDP(q.astype(np.float32).reshape(-1, 1, 2), 0.35, False).reshape(-1, 2)
        if len(q) >= 2:
            lines.append(dict(en=to_en(q).round(3).tolist(), width=round(w, 2)))
    cs, _ = cv2.findContours(thick.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for c in cs:
        if cv2.contourArea(c) * GSD ** 2 < 0.2:
            continue
        ring = ndi.gaussian_filter1d(c.reshape(-1, 2).astype(np.float32), 1.6, axis=0, mode="wrap")   # take the pixel steps out
        q = cv2.approxPolyDP(ring.reshape(-1, 1, 2), 0.3, True).reshape(-1, 2)
        if len(q) >= 3:
            areas.append(to_en(q).round(3).tolist())
    json.dump(dict(lines=lines, areas=areas), open(os.path.join(WORK, "paint.json"), "w"))
    np.savez_compressed(os.path.join(WORK, "paint_mask.npz"), paint=paint)
    print(f"paint: {len(lines)} lines ({sum(np.linalg.norm(np.diff(np.array(l['en']), axis=0), axis=1).sum() for l in lines):.0f} m), {len(areas)} areas")

    # ---- tyre barriers: black and neutral (shadows are bluish and smooth), narrow, long
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dark = (lum < 0.34) & (b - r < 0.085) & (sat < 0.095) & ~((g > b + 0.02) & (g >= r - 0.012))
    tall = ndi.binary_dilation(up(sv["canopy"] > 0) | up(sv["building"]), iterations=24)       # 3 m around trees and buildings
    sh = np.zeros(lum.shape, np.uint8)
    for pg in (bg.shadow_polygon(), bg.footprint(grow=1.0)):
        cv2.fillPoly(sh, [np.round(np.column_stack([(pg[:, 0] + HALF_E) / GSD, (HALF_N - pg[:, 1]) / GSD])).astype(np.int32)], 1)
    dark &= ~tall & ~sh.astype(bool)
    dark = ndi.binary_closing(ndi.binary_opening(dark, iterations=1), iterations=4)
    dark = ndi.binary_opening(dark, iterations=2)
    lab, n = ndi.label(dark, structure=np.ones((3, 3)))
    walls = []
    d2 = ndi.distance_transform_edt(dark) * GSD

    def longest_path(sk: np.ndarray) -> np.ndarray:
        pix = set(zip(*np.where(sk)))
        if len(pix) < 3:
            return np.zeros((0, 2))

        def bfs(start):
            prev, order = {start: None}, [start]
            for p in order:
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        q = (p[0] + dy, p[1] + dx)
                        if q in pix and q not in prev:
                            prev[q] = p
                            order.append(q)
            return order[-1], prev

        a_, _ = bfs(next(iter(pix)))
        b_, prev = bfs(a_)
        path = []
        while b_ is not None:
            path.append((b_[1], b_[0]))
            b_ = prev[b_]
        return np.array(path, float)

    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        comp = lab[sl] == i
        a_m2 = comp.sum() * GSD ** 2
        halfw = float(d2[sl][comp].max())
        if a_m2 < 1.5 or not (0.3 <= halfw <= 1.4):
            continue
        p = longest_path(skeletonize(comp))
        if len(p) < 2:
            continue
        ln = float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) * GSD
        if ln < 3.0 or a_m2 / ln > 2.6:                                  # too short, or a blob rather than a wall
            continue
        q = smooth_line(p + [sl[1].start, sl[0].start], 5.0)
        q = cv2.approxPolyDP(q.astype(np.float32).reshape(-1, 1, 2), 1.5, False).reshape(-1, 2)
        walls.append(dict(en=to_en(q).round(2).tolist(), width=round(float(np.clip(a_m2 / ln, 0.6, 1.5)), 2), height=0.9))
    veg = (g > b + 0.02) & (g >= r - 0.012)
    kept = []
    for w in walls:
        p = np.array(w["en"])
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        m = max(3, int(cum[-1]))
        q = np.column_stack([np.interp(np.linspace(0, cum[-1], m), cum, p[:, 0]), np.interp(np.linspace(0, cum[-1], m), cum, p[:, 1])])
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]])
        frac = []
        for side in (2.2, -2.2):
            e = q + nrm * side
            px = np.clip(((e[:, 0] + HALF_E) / GSD).astype(int), 0, lum.shape[1] - 1)
            py = np.clip(((HALF_N - e[:, 1]) / GSD).astype(int), 0, lum.shape[0] - 1)
            frac.append(float(veg[py, px].mean()))
        if max(frac) >= 0.6:                                              # grass on at least one side
            kept.append(w)
    json.dump(dict(tyre_walls=kept), open(os.path.join(WORK, "tyre_walls.json"), "w"))
    print(f"tyre barriers: {len(kept)} of {len(walls)} candidates kept ({sum(np.linalg.norm(np.diff(np.array(w['en']), axis=0), axis=1).sum() for w in kept):.0f} m)")


if __name__ == "__main__":
    main()
