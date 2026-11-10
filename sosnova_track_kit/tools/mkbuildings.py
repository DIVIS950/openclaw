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
    json.dump(out, open(os.path.join(SRC, "buildings.json"), "w"), indent=1)
    print(len(out), "buildings; heights", sorted(b["height"] for b in out))


if __name__ == "__main__":
    main()
