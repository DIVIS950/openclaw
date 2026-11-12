"""Building footprints and heights. Footprints come from the surface model (tall, flat-topped objects) and,
for the pit complex whose roofs the model merges, from measurements on the orthophoto (world coordinates:
x = metres left of the start straight, z = metres along it). Heights are read from the surface model.
Writes source/buildings.json (footprints as east/north polygons)."""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import Point, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, SRC, WORK  # noqa: E402
from track import Track  # noqa: E402

# (x0, x1, z0, z1, fallback height, wall style)
PIT_COMPLEX = [
    (-20.0, -12.0, 50.0, 78.0, 4.2, "garage"),
    (-20.0, -12.0, 83.0, 109.0, 4.2, "garage"),
    (-20.0, -12.0, 113.0, 131.0, 4.2, "garage"),
    (-25.0, -12.0, 41.5, 48.5, 6.0, "building"),
    (-30.0, -12.0, 26.0, 41.0, 7.0, "building"),      # main building
    (-20.0, -14.0, 19.0, 26.0, 3.5, "building"),
    (-25.0, -13.0, 6.5, 16.0, 5.0, "hall"),           # covered grandstand
    (-20.0, -13.5, 0.0, 5.5, 4.0, "hall"),
    (-20.0, -13.0, -14.0, -5.0, 4.0, "hall"),
    (-36.0, -28.5, -6.5, 1.0, 3.5, "hall"),           # tent
    (-41.0, -35.0, 22.0, 40.0, 3.5, "building"),
]
# small objects the surface model does not show: (east, north of the centre, length, width, rotation deg, height, style)
EXTRA = [(5.3, 34.6, 6.2, 3.6, -14.0, 2.7, "hut")]


def _axes(en: np.ndarray):
    c = en.mean(0)
    e0, e1 = en[1] - en[0], en[2] - en[1]
    l0, l1 = float(np.linalg.norm(e0)), float(np.linalg.norm(e1))
    (u, lu), (v, lv) = ((e0 / l0, l0), (e1 / l1, l1)) if l0 >= l1 else ((e1 / l1, l1), (e0 / l0, l0))
    return c, u, lu, v, lv


def _heights(ndsm: np.ndarray, p: np.ndarray) -> np.ndarray:
    px, py = (p[..., 0] + HALF_E) / 0.5 - 0.5, (HALF_N - p[..., 1]) / 0.5 - 0.5
    return cv2.remap(ndsm.astype(np.float32), px.astype(np.float32), py.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def refine_rect(en: np.ndarray, ndsm: np.ndarray) -> np.ndarray:
    """Move the sides of a footprint to where the surface model puts the walls. The model smears a wall over about
    3 m, evenly to both sides, so the wall stands where the height passes half of the roof height."""
    en = np.asarray(en, float)
    c, u, lu, v, lv = _axes(en)
    ext = {}
    for name, a, la, b, lb in (("u", u, lu, v, lv), ("v", v, lv, u, lu)):
        t = np.arange(-la / 2 - 3.0, la / 2 + 3.0 + 1e-6, 0.25)
        w = np.arange(-lb / 4, lb / 4 + 1e-6, 0.5)                    # the middle half of the other direction
        prof = np.median(_heights(ndsm, c + t[:, None, None] * a + w[None, :, None] * b), axis=1)
        top = float(np.median(prof[prof > 0.6 * prof.max()])) if prof.max() > 1.5 else 0.0
        on = np.where(prof > 0.5 * top)[0]
        if top < 1.5 or len(on) < 8:
            return en
        ext[name] = (float(t[on[0]]), float(t[on[-1]]))
    (u0, u1), (v0, v1) = ext["u"], ext["v"]
    if not (0.6 * lu <= u1 - u0 <= 1.25 * lu and 0.6 * lv <= v1 - v0 <= 1.25 * lv):
        return en
    return np.array([c + u0 * u + v0 * v, c + u1 * u + v0 * v, c + u1 * u + v1 * v, c + u0 * u + v1 * v])


def roof_shape(en: np.ndarray, ndsm: np.ndarray, height: float) -> dict:
    """The shape of a roof, read from the laser-scanned surface model (0.5 m grid of heights above the ground).

    The heights inside the footprint, 2 m in from the walls where the model is smeared, are averaged along the long
    side of the building, which leaves the profile across it. A profile with a peak in the middle is a gable roof
    (ridge along the building), a tilted one is a single-pitch roof, anything else is flat. Returns heights above
    the ground: one per corner of the footprint, and the ridge (two end points east/north and its height) for a
    gable roof."""
    en = np.asarray(en, float)
    c, u, lu, v, lv = _axes(en)
    flat = dict(type="flat", corner_h=[round(height, 2)] * 4)
    if lv < 10.0 or lu < 10.0:                                          # too small to tell a pitch from the smear of the model
        return flat
    us = np.arange(-lu / 2 + 2.5, lu / 2 - 2.5 + 1e-6, 0.5)
    vs = np.arange(-lv / 2 + 2.0, lv / 2 - 2.0 + 1e-6, 0.5)
    h = _heights(ndsm, c + us[:, None, None] * u + vs[None, :, None] * v)
    pv = np.median(h, axis=0)                                           # profile across the building
    k = len(pv)
    if np.median(pv) < 2.2:                                             # the model does not show this building
        return flat
    if k < 6 or pv.min() < 0.6 * np.median(pv):                         # a lower part or a yard inside the footprint
        return dict(type="flat", corner_h=[round(float(np.median(pv)), 2)] * 4)
    q = max(1, k // 5)
    lo, hi, mid = float(pv[:q].mean()), float(pv[-q:].mean()), float(pv[k // 2 - 1: k // 2 + 2].mean())
    peak, tilt = mid - (lo + hi) / 2, hi - lo
    corner_v = (en - c) @ v
    if peak > 0.35 and peak > 0.7 * abs(tilt):
        half = vs < 0
        left, right = np.polyfit(vs[half], pv[half], 1), np.polyfit(vs[~half], pv[~half], 1)
        ridge = max(float(np.polyval(left, 0) + np.polyval(right, 0)) / 2, float(pv.max()))
        eave = float(np.polyval(left, -lv / 2) + np.polyval(right, lv / 2)) / 2
        if 0.5 <= ridge - eave <= 0.7 * lv / 2 and eave >= 2.2:
            return dict(type="gable", corner_h=[round(eave, 2)] * 4, ridge_h=round(ridge, 2),
                        ridge_en=[(c - u * lu / 2).round(2).tolist(), (c + u * lu / 2).round(2).tolist()])
    if abs(tilt) > 0.6:
        hh = np.polyval(np.polyfit(vs, pv, 1), corner_v)
        if np.ptp(hh) <= max(3.0, 0.35 * lv) and hh.min() >= 2.2:
            return dict(type="shed", corner_h=[round(float(x), 2) for x in hh])
    return dict(type="flat", corner_h=[round(float(np.median(pv)), 2)] * 4)


def main() -> None:
    tr = Track()
    fr = tr.fr
    sv = np.load(os.path.join(WORK, "survey.npz"))
    ndsm, mask = sv["ndsm"], sv["building"]

    def model_height(poly: Polygon, fallback: float) -> float:
        x0, y0, x1, y1 = poly.bounds
        c0, c1 = int((x0 + HALF_E) / 0.5), int((x1 + HALF_E) / 0.5) + 1
        r0, r1 = int((HALF_N - y1) / 0.5), int((HALF_N - y0) / 0.5) + 1
        v = ndsm[max(r0, 0):r1, max(c0, 0):c1].ravel()
        v = v[v > 2.0]
        return float(np.percentile(v, 60)) if len(v) > 8 else fallback

    out, manual = [], []
    for x0, x1, z0, z1, h, style in PIT_COMPLEX:
        corners = np.array([(x0, z0), (x1, z0), (x1, z1), (x0, z1)])
        en = fr.o + corners[:, :1] * fr.l + corners[:, 1:] * fr.f
        p = Polygon(en)
        manual.append(p.buffer(3.0))
        out.append(dict(en=en.round(2).tolist(), height=round(model_height(p, h), 1), style=style))
    for e, n, ln, wd, rot, h, style in EXTRA:
        a = np.radians(rot)
        ax, ay = np.array([np.cos(a), np.sin(a)]), np.array([-np.sin(a), np.cos(a)])
        en = np.array([e, n]) + np.array([-ax * ln / 2 - ay * wd / 2, ax * ln / 2 - ay * wd / 2, ax * ln / 2 + ay * wd / 2, -ax * ln / 2 + ay * wd / 2])
        out.append(dict(en=en.round(2).tolist(), height=h, style=style))
    lab, n = ndi.label(mask)
    for i in range(1, n + 1):
        comp = lab == i
        area = comp.sum() * 0.0625
        if area < 30:
            continue
        pts = np.column_stack(np.where(comp))[:, ::-1].astype(np.float32)
        rect = cv2.minAreaRect(pts)
        (w, h) = rect[1]
        fill = area / max(w * h * 0.0625, 1e-6)
        box = cv2.boxPoints(rect)
        en = np.column_stack([(box[:, 0] + 0.5) * 0.25 - HALF_E, HALF_N - (box[:, 1] + 0.5) * 0.25])
        rows, cols = np.where(comp[::2, ::2])
        height = float(np.percentile(ndsm[rows, cols], 60))
        c = en.mean(0)
        if fill < 0.62 or not (2.2 <= height <= 13.0) or min(w, h) * 0.25 < 3.5 or abs(c[0]) > HALF_E - 6 or abs(c[1]) > HALF_N - 6 or c[0] < -230:
            continue
        if any(m.contains(Point(c)) for m in manual) or Polygon(en).distance(Polygon(tr.edge_en(-1))) < 0.5 and Polygon(tr.edge_en(-1)).contains(Point(c)) and Polygon(en).distance(Polygon(tr.edge_en(1)).exterior) < 2:
            continue
        out.append(dict(en=en.round(2).tolist(), height=round(height, 1), style="hall" if area > 250 else "building"))
    moved = 0
    for k_, b in enumerate(out):
        if k_ >= len(PIT_COMPLEX) + len(EXTRA):                         # the hand-measured footprints stay
            new = refine_rect(np.array(b["en"]), ndsm)
            moved += int(np.abs(new - np.array(b["en"])).max() > 0.5)
            b["en"] = new.round(2).tolist()
        b["roof"] = roof_shape(np.array(b["en"]), ndsm, b["height"])
        b["height"] = round(float(b["roof"].get("ridge_h", max(b["roof"]["corner_h"]))), 2)
    print("footprints moved to the walls of the surface model:", moved)
    json.dump(out, open(os.path.join(SRC, "buildings.json"), "w"), indent=1)
    kinds = [b["roof"]["type"] for b in out]
    print(len(out), "buildings; heights", sorted(b["height"] for b in out))
    print("roofs:", {k: kinds.count(k) for k in ("gable", "shed", "flat")})
    for b in out:
        if b["roof"]["type"] != "flat":
            r = b["roof"]
            print("  %-5s at (%4.0f, %4.0f): eave %s, ridge %s" % (r["type"], *np.mean(b["en"], 0), sorted(set(r["corner_h"])), r.get("ridge_h", "-")))


if __name__ == "__main__":
    main()
