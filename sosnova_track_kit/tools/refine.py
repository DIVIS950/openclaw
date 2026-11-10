"""Step: put the lap exactly on the real asphalt. The lap line comes from a hand-drawn route; where it cuts a
corner over grass it is moved sideways onto the road seen in the photo, and its edges are the real asphalt
edges of the photo.  Reads source/work/centerline_route.json, writes source/work/centerline.json"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge_geom as bg  # noqa: E402
from common import HALF_E, HALF_N, WORK, closed_frames, closed_resample, periodic_gauss  # noqa: E402

GSD = 0.25
REACH, STEP = 11.0, 0.25
MIN_HALF, MAX_HALF = 2.6, 5.25       # half width of the racing surface while the line is being moved (m)
EDGE_GAP = 0.15                      # keep the mesh edge this far inside the photo's asphalt edge
WIDE_REACH = 17.0                    # how far the real edge is searched for the final widths (m)
OPEN_AT = 13.0                       # no edge within this distance: the lap runs beside open asphalt there
OPEN_HALF = 5.0                      # half width of the lap beside open asphalt (m)
REAL_MIN, REAL_MAX = 3.0, 12.5       # limits of a real half width (m)


def drivable_mask() -> np.ndarray:
    hard = np.load(os.path.join(WORK, "survey.npz"))["hard"]
    paint = np.load(os.path.join(WORK, "paint_mask.npz"))["paint"]
    paint = paint.reshape(hard.shape[0], 2, hard.shape[1], 2).any(axis=(1, 3))
    m = (hard | paint).astype(np.uint8)
    for pg in (bg.footprint(grow=1.5), bg.shadow_polygon()):          # the road under the bridge is hidden in the photo
        cv2.fillPoly(m, [np.round(np.column_stack([(pg[:, 0] + HALF_E) / GSD, (HALF_N - pg[:, 1]) / GSD])).astype(np.int32)], 1)
    return ndi.binary_closing(m.astype(bool), iterations=4)


def white_concrete() -> np.ndarray:
    """Bright concrete slabs seen in the photo (the apron inside the east hairpin): paved, but not the racing surface."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    hsv = cv2.cvtColor(np.asarray(Image.open(os.path.join(WORK, "ortho_025.png")).convert("RGB")), cv2.COLOR_RGB2HSV)
    w = ndi.binary_opening((hsv[..., 2] > 205) & (hsv[..., 1] < 45), iterations=5)       # slabs, not painted lines
    lab, n = ndi.label(w)
    area = ndi.sum(np.ones_like(lab), lab, np.arange(1, n + 1)) * GSD ** 2
    return ndi.binary_dilation(np.concatenate([[False], area > 150.0])[lab], iterations=5)


def intervals(c: np.ndarray, nrm: np.ndarray, mask: np.ndarray, reach: float = REACH):
    """For every station: lateral extent (a, b) of the asphalt strip that holds, or is nearest to, the line."""
    d = np.arange(-reach, reach + 1e-6, STEP)
    en = c[:, None, :] + nrm[:, None, :] * d[None, :, None]
    px = np.clip(((en[..., 0] + HALF_E) / GSD).astype(int), 0, mask.shape[1] - 1)
    py = np.clip(((HALF_N - en[..., 1]) / GSD).astype(int), 0, mask.shape[0] - 1)
    on = mask[py, px]
    mid = len(d) // 2
    a, b = np.zeros(len(c)), np.zeros(len(c))
    for i in range(len(c)):
        row = on[i]
        k = mid
        if not row[k]:
            idx = np.where(row)[0]
            if len(idx) == 0:
                a[i], b[i] = -MIN_HALF, MIN_HALF
                continue
            k = idx[np.argmin(np.abs(idx - mid))]
        lo = hi = k
        while lo > 0 and row[lo - 1]:
            lo -= 1
        while hi < len(d) - 1 and row[hi + 1]:
            hi += 1
        a[i], b[i] = d[lo], d[hi]
    return a, b


def main() -> None:
    from common import lap_file
    src = json.load(open(lap_file("centerline_route", "json"), encoding="utf-8"))
    c = np.array(src["en"])
    start = c[0].copy()
    mask = drivable_mask()
    moved = np.zeros(len(c))
    for _ in range(8):
        _, nrm, _, _ = closed_frames(c)
        a, b = intervals(c, nrm, mask)
        room = b - a
        want = np.where(room < 2 * MIN_HALF, (a + b) / 2, np.clip(0.0, a + MIN_HALF, b - MIN_HALF))
        want = periodic_gauss(want, 2.5)
        c = c + nrm * (0.7 * want)[:, None]
        moved += np.abs(0.7 * want)
        c = periodic_gauss(c, 1.2)
    for _ in range(6):                                        # round off kinks: no bend tighter than the road is wide
        c = closed_resample(c, 1.0)
        _, _, k, _ = closed_frames(c)
        tight = ndi.maximum_filter1d((np.abs(periodic_gauss(k, 1.5)) > 1.0 / 8.5).astype(float), 9, mode="wrap")
        if not tight.any():
            break
        w = periodic_gauss(tight, 3.0)[:, None]
        c = c * (1 - w) + periodic_gauss(c, 3.0) * w
    c = closed_resample(c, 1.0)
    k0 = int(np.argmin(np.linalg.norm(c - start, axis=1)))               # keep the start/finish point where it was
    c = np.roll(c, -k0, axis=0)
    c[0] = start
    t, nrm, curv, seg = closed_frames(c)
    # final widths: the real asphalt edges seen in the photo. Where no edge lies within OPEN_AT (a junction, the
    # square, the pit apron) the lap keeps a lane of OPEN_HALF and the side is marked open.
    slabs = white_concrete()
    a, b = intervals(c, nrm, mask & ~slabs[: mask.shape[0], : mask.shape[1]], WIDE_REACH)
    open_l, open_r = b >= OPEN_AT, -a >= OPEN_AT
    open_l = ndi.binary_opening(ndi.binary_closing(np.tile(open_l, 3), iterations=4), iterations=3)[len(c): 2 * len(c)]
    open_r = ndi.binary_opening(ndi.binary_closing(np.tile(open_r, 3), iterations=4), iterations=3)[len(c): 2 * len(c)]
    wl = np.where(open_l, OPEN_HALF, np.clip(b - EDGE_GAP, REAL_MIN, REAL_MAX))
    wr = np.where(open_r, OPEN_HALF, np.clip(-a - EDGE_GAP, REAL_MIN, REAL_MAX))
    wl = periodic_gauss(ndi.median_filter(wl, 9, mode="wrap"), 4.0)
    wr = periodic_gauss(ndi.median_filter(wr, 9, mode="wrap"), 4.0)
    s_ = np.arange(len(c), dtype=float)
    s_ = np.where(s_ > len(c) / 2, s_ - len(c), s_)
    open_l = open_l | ((s_ >= -36.0) & (s_ <= 74.0))                       # the pit apron
    print(f"real widths: {np.mean(wl + wr):.2f} m on average, {(wl + wr).min():.2f}..{(wl + wr).max():.2f} m; "
          f"open asphalt beside the lap: left {open_l.mean() * 100:.0f} %, right {open_r.mean() * 100:.0f} % of the lap")
    out = dict(src)
    lap = float(np.linalg.norm(np.roll(c, -1, axis=0) - c, axis=1).sum())
    out.update(en=c.tolist(), s=np.arange(len(c)).astype(float).tolist(), curv=periodic_gauss(curv, 2.0).tolist(), wl=wl.tolist(), wr=wr.tolist(),
               edge_l=(c + nrm * wl[:, None]).tolist(), edge_r=(c - nrm * wr[:, None]).tolist(), open_l=open_l.tolist(), open_r=open_r.tolist(),
               lap_m=lap, step=lap / len(c))
    json.dump(out, open(lap_file("centerline", "json"), "w"))
    old = np.array(src["en"])
    from scipy.spatial import cKDTree
    shift = cKDTree(old).query(c)[0]
    en = c[:, None, :] + nrm[:, None, :] * np.stack([wl, -wr], 1)[..., None]
    px = np.clip(((en[..., 0] + HALF_E) / GSD).astype(int), 0, mask.shape[1] - 1)
    py = np.clip(((HALF_N - en[..., 1]) / GSD).astype(int), 0, mask.shape[0] - 1)
    print(f"lap {src['lap_m']:.1f} -> {lap:.1f} m, {len(c)} stations; moved more than 1 m at {(shift > 1).sum()} stations, most {shift.max():.1f} m")
    print(f"half widths {min(wl.min(), wr.min()):.2f}..{max(wl.max(), wr.max()):.2f} m, mean total {np.mean(wl + wr):.2f} m; "
          f"edges on asphalt {mask[py, px].mean() * 100:.1f} %; min radius {1 / np.abs(curv).max():.1f} m")


if __name__ == "__main__":
    main()
