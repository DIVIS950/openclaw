"""Step 2: clean centre line, road half-widths and the world frame.

The registered event route is only a guide (it was traced from a hand-drawn line). Here it is
  1. pre-smoothed,
  2. measured against the asphalt mask (left / right edge distance at every station),
  3. re-solved as a bounded least-squares "elastic band": minimum bending, pulled to the measured road
     centre where both edges are visible, never more than a small distance from the measured position,
     with the start straight forced truly straight,
  4. resampled at 1 m starting exactly on the start/finish line.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy import sparse
from scipy.optimize import lsq_linear
from scipy.spatial import cKDTree

from common import SRC, WORK, Frame, closed_frames, closed_resample, periodic_gauss, px_to_en

MASK_GSD = 0.25
MAX_HALF = 5.25   # widest ribbon half-width (m); wider asphalt becomes apron
MIN_HALF = 3.25
RAY = 13.0
SF_BEFORE_END = 75  # start/finish line this many metres before the end of the start straight


class Mask:
    def __init__(self, m: np.ndarray, gsd: float = MASK_GSD):
        self.m, self.gsd = m, gsd
        self.h, self.w = m.shape

    def at(self, en: np.ndarray) -> np.ndarray:
        en = np.atleast_2d(en)
        x = np.clip((en[:, 0] / self.gsd + self.w / 2).astype(int), 0, self.w - 1)
        y = np.clip((self.h / 2 - en[:, 1] / self.gsd).astype(int), 0, self.h - 1)
        return self.m[y, x]


def edge_distance(mask: Mask, c: np.ndarray, n: np.ndarray, sign: float) -> np.ndarray:
    """Distance from each centre point along +-normal to the first 0.75 m run of non-asphalt."""
    steps = np.arange(0.0, RAY + 1.0, 0.25)
    out = np.full(len(c), RAY)
    for i in range(len(c)):
        pts = c[i] + sign * steps[:, None] * n[i]
        on = mask.at(pts)
        run = 0
        for j, v in enumerate(on):
            run = 0 if v else run + 1
            if run >= 3:
                out[i] = steps[j - 2]
                break
    return out


def solve_band(c: np.ndarray, n: np.ndarray, target: np.ndarray, w_data: np.ndarray, lo: np.ndarray, hi: np.ndarray,
               w_bend: np.ndarray) -> np.ndarray:
    """min sum w_bend |D2 (c + d n)|^2 + sum w_data (d - target)^2, lo <= d <= hi (closed loop)."""
    m = len(c)
    rows, cols, vals, rhs = [], [], [], []
    r = 0
    for i in range(m):
        a, b = (i - 1) % m, (i + 1) % m
        wb = np.sqrt(w_bend[i])
        for ax in (0, 1):
            for j, coef in ((a, 1.0), (i, -2.0), (b, 1.0)):
                rows.append(r); cols.append(j); vals.append(wb * coef * n[j, ax])
            rhs.append(-wb * (c[a, ax] - 2 * c[i, ax] + c[b, ax]))
            r += 1
    for i in range(m):
        if w_data[i] > 0:
            rows.append(r); cols.append(i); vals.append(np.sqrt(w_data[i])); rhs.append(np.sqrt(w_data[i]) * target[i])
            r += 1
    A = sparse.csr_matrix((vals, (rows, cols)), shape=(r, m))
    res = lsq_linear(A, np.array(rhs), bounds=(lo, hi), lsmr_tol="auto", max_iter=200)
    return res.x


GATE_CLEAR = 3.8   # centre line passes at least this far from a slalom tyre stack (m)
REF_LIM = 1.8     # largest correction of the traced route where no road edge is visible (m)
GATE_NEAR = 9.0    # cones closer than this to the traced route act as gates


def cone_lateral(c: np.ndarray, n: np.ndarray, cones: np.ndarray):
    """Nearest station and signed lateral offset (+ = left) of every cone."""
    tree = cKDTree(c)
    _, idx = tree.query(cones)
    lat = np.einsum("ij,ij->i", cones - c[idx], n[idx])
    return idx, lat


def main() -> None:
    route = json.load(open(os.path.join(SRC, "cuzk", "route_ortho.json"), encoding="utf-8"))
    raw = px_to_en(np.array(route["route_px"]))
    cones = px_to_en(np.array(route["cones_px"]))
    cls = np.load(os.path.join(WORK, "classes.npz"))
    hard = Mask(cls["asphalt"] | cls["roof"])  # bright concrete run-off counts as hard surface

    # which side of each cone the event route passes: taken from the traced line before any correction
    r1 = periodic_gauss(closed_resample(raw, 1.0), 1.5)
    _, n1, _, _ = closed_frames(r1)
    _, lat0 = cone_lateral(r1, n1, cones)
    gate = np.abs(lat0) < GATE_NEAR
    cone_left = lat0 > 0  # cone is on the driver's left, so the car passes on its right

    step = 2.0
    c = closed_resample(raw, step)
    c = periodic_gauss(c, 2.5)  # 5 m: removes the hand-tracing wobble only
    c = closed_resample(c, step)
    ref = closed_resample(c, 0.5)
    ref_tree = cKDTree(ref)
    for it in range(5):
        m = len(c)
        t, n, k, _ = closed_frames(c)
        dl = edge_distance(hard, c, n, +1.0)
        dr = edge_distance(hard, c, n, -1.0)
        both = (dl < RAY - 0.5) & (dr < RAY - 0.5) & (dl + dr > 5.0) & (dl + dr < 16.0)
        mid = np.where(both, (dl - dr) / 2.0, 0.0)
        mid = periodic_gauss(np.clip(mid, -3.0, 3.0), 3.0)  # no step changes in the target: they cause kinks
        # where the road edges are not both visible the traced route is the only evidence: stay within
        # REF_LIM of it (measured against the pre-smoothed trace, so the band cannot creep across passes)
        _, ri = ref_tree.query(c)
        e = np.einsum("ij,ij->i", c - ref[ri], n)
        mid = np.where(both, mid, -e)
        w_data = np.where(both, 0.02, 0.006)
        lo = np.where(both, mid - 1.0, np.minimum(-REF_LIM - e, 0.0))
        hi = np.where(both, mid + 1.0, np.maximum(REF_LIM - e, 0.0))
        # slalom gates: free the band around them and force the side
        idx, lat = cone_lateral(c, n, cones)
        for ci in np.where(gate)[0]:
            for j in range(-12, 13):
                q = (idx[ci] + j) % m
                lo[q], hi[q], w_data[q], mid[q] = min(lo[q], -8.0), max(hi[q], 8.0), 0.002, 0.0
        for ci in np.where(gate)[0]:
            for j in range(-1, 2):
                q = (idx[ci] + j) % m
                if cone_left[ci]:
                    hi[q] = min(hi[q], lat[ci] - GATE_CLEAR)
                else:
                    lo[q] = max(lo[q], lat[ci] + GATE_CLEAR)
        bad = lo > hi
        lo[bad] = hi[bad] - 0.2
        # start straight: very stiff where the pre-smoothed line is already nearly straight around station 0
        ks = np.abs(periodic_gauss(k, 6.0))
        stiff = np.ones(m)
        i = 0
        while ks[i % m] < 1 / 250 and i < m // 3:
            stiff[i % m] = 60.0
            i += 1
        i = -1
        while ks[i % m] < 1 / 250 and -i < m // 3:
            stiff[i % m] = 60.0
            i -= 1
        d = solve_band(c, n, mid, w_data, lo, hi, stiff)
        c = closed_resample(c + d[:, None] * n, step)
        print(f"pass {it}: both-edges {both.mean()*100:.0f}%  shift rms {np.sqrt((d**2).mean()):.2f} m  max {np.abs(d).max():.2f} m")

    # final 1 m line
    c = closed_resample(c, 1.0)
    c = periodic_gauss(c, 2.5)
    c = closed_resample(c, 1.0)
    t, n, k, _ = closed_frames(c)
    ks = np.abs(periodic_gauss(k, 4.0))
    # start straight = longest run with radius > 400 m
    straight = ks < 1 / 400
    m = len(c)
    best, cur, start = (0, 0), 0, 0
    for i in range(2 * m):
        if straight[i % m]:
            if cur == 0:
                start = i
            cur += 1
            if cur > best[0] and cur < m:
                best = (cur, start)
        else:
            cur = 0
    ln, st = best
    print(f"start straight: {ln} m from index {st % m}")
    run = np.array([(st + j) % m for j in range(ln)])
    p = c[run]
    # total least squares line through the run, then pull the run exactly onto it (20 m blends at both ends)
    mean = p.mean(axis=0)
    _, _, vt = np.linalg.svd(p - mean)
    fwd = vt[0] if vt[0] @ (p[-1] - p[0]) > 0 else -vt[0]
    nl = np.array([-fwd[1], fwd[0]])
    e = (p - mean) @ nl
    j = np.arange(ln)
    ramp = np.clip(np.minimum(j, ln - 1 - j) / 20.0, 0.0, 1.0)
    w = ramp * ramp * (3 - 2 * ramp)
    c[run] = p - (w * e)[:, None] * nl
    print(f"straight: max offset removed {np.abs(e).max():.2f} m")
    sf = (st + ln - SF_BEFORE_END) % m
    c = closed_resample(np.roll(c, -sf, axis=0), 1.0)
    m = len(c)
    t, n, k, seg = closed_frames(c)
    print("straight direction (deg, 0=east, ccw):", np.degrees(np.arctan2(fwd[1], fwd[0])).round(2))
    print("tangent at S/F vs straight (deg):", np.degrees(np.arccos(np.clip(t[0] @ fwd, -1, 1))).round(4))

    # widths on the final line
    dl = edge_distance(hard, c, n, +1.0)
    dr = edge_distance(hard, c, n, -1.0)
    wl = np.clip(dl - 0.15, MIN_HALF, MAX_HALF)
    wr = np.clip(dr - 0.15, MIN_HALF, MAX_HALF)
    # never wider than the inside radius allows, never overlapping another part of the lap
    rad = 1.0 / np.maximum(np.abs(periodic_gauss(k, 2.0)), 1e-6)
    wl = np.where(k > 0, np.minimum(wl, rad - 2.0), wl)
    wr = np.where(k < 0, np.minimum(wr, rad - 2.0), wr)
    tree = cKDTree(c)
    for i in range(m):
        near = np.array(tree.query_ball_point(c[i], 2 * MAX_HALF + 1.0))
        gap = np.minimum(np.abs(near - i), m - np.abs(near - i))
        other = near[gap > 40]
        if len(other):
            dv = c[other] - c[i]
            side = dv @ n[i]
            dist = np.linalg.norm(dv, axis=1)
            if (side > 0).any():
                wl[i] = min(wl[i], dist[side > 0].min() / 2 - 0.3)
            if (side < 0).any():
                wr[i] = min(wr[i], dist[side < 0].min() / 2 - 0.3)
    # tyre stacks stand just outside the ribbon
    idx, lat = cone_lateral(c, n, cones)
    for ci in range(len(cones)):
        for j in range(-7, 8):
            q = (idx[ci] + j) % m
            if lat[ci] > 0:
                wl[q] = min(wl[q], lat[ci] - 1.1)
            else:
                wr[q] = min(wr[q], -lat[ci] - 1.1)
    wl = np.maximum(wl, 2.4)
    wr = np.maximum(wr, 2.4)
    # smooth, but never above the measured limit
    for _ in range(3):
        wl = np.minimum(wl, periodic_gauss(wl, 4.0))
        wr = np.minimum(wr, periodic_gauss(wr, 4.0))
    wl, wr = periodic_gauss(wl, 1.5), periodic_gauss(wr, 1.5)
    open_l = dl > wl + 2.0  # asphalt continues beyond the ribbon: needs delimiting
    open_r = dr > wr + 2.0
    clear = np.where(lat > 0, lat - wl[idx], -lat - wr[idx])
    print("cone clearance outside ribbon edge (m): min %.2f; centre clearance of gates min %.2f" % (
        clear.min(), np.abs(lat[gate]).min()))

    s = np.concatenate([[0], np.cumsum(seg)])[:-1]
    out = {
        "step": 1.0, "lap_m": float(seg.sum()),
        "en": c.tolist(), "s": s.tolist(), "curv": k.tolist(),
        "wl": wl.tolist(), "wr": wr.tolist(), "edge_l": dl.tolist(), "edge_r": dr.tolist(),
        "open_l": open_l.tolist(), "open_r": open_r.tolist(),
        "sf_en": c[0].tolist(), "fwd_en": fwd.tolist(),
        "cones_en": cones.tolist(), "cone_station": idx.tolist(), "cone_lat": lat.tolist(),
        "straight_m": [int(SF_BEFORE_END - ln), int(SF_BEFORE_END)],
    }
    json.dump(out, open(os.path.join(WORK, "centerline.json"), "w"))
    ksm = np.abs(periodic_gauss(k, 1.0))
    print(f"lap {seg.sum():.1f} m, {m} points; min radius {1/np.abs(k).max():.1f} m (smoothed {1/ksm.max():.1f}); "
          f"width {np.min(wl+wr):.1f}..{np.max(wl+wr):.1f} m (mean {np.mean(wl+wr):.1f}); open L {open_l.mean()*100:.0f}% R {open_r.mean()*100:.0f}%")
    order = np.argsort(-np.abs(k))[:400]
    seen = []
    for i in order:
        if all(min(abs(i - j), m - abs(i - j)) > 15 for j in seen):
            seen.append(i)
        if len(seen) >= 14:
            break
    print("tightest:", ", ".join(f"s{i} R{1/abs(k[i]):.1f}" for i in seen))


if __name__ == "__main__":
    main()
