"""Building footprints: clean roof detections from the orthophoto plus the pit complex measured by hand
from the photo (world coordinates: x = metres left of the start straight, z = metres along it).
Writes source/buildings.json (footprints as east/north polygons)."""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, SRC, WORK  # noqa: E402
from track import Track  # noqa: E402

# (x0, x1, z0, z1, height, roof)
PIT_COMPLEX = [
    (-20.0, -12.0, 50.0, 78.0, 4.2, "white"),     # pit garages
    (-20.0, -12.0, 83.0, 109.0, 4.2, "white"),
    (-20.0, -12.0, 113.0, 131.0, 4.2, "white"),
    (-25.0, -12.0, 41.5, 48.5, 6.0, "white"),
    (-30.0, -12.0, 26.0, 41.0, 7.0, "dark"),      # main building
    (-20.0, -14.0, 19.0, 26.0, 3.5, "dark"),
    (-25.0, -13.0, 6.5, 16.0, 5.0, "white"),      # covered grandstand
    (-20.0, -13.5, 0.0, 5.5, 4.0, "white"),
    (-20.0, -13.0, -14.0, -5.0, 4.0, "white"),
    (-36.0, -28.5, -6.5, 1.0, 3.5, "white"),      # tent
    (-41.0, -35.0, 22.0, 40.0, 3.5, "dark"),
]
# roof detections worth keeping: (minimum area m2, centre world x, z, height)
AUTO_KEEP = [(126, 86, 4.0), (107, 114, 8.0), (84, 142, 4.0), (-107, -67, 7.0), (-106, -58, 7.0), (-106, -45, 7.0),
             (-142, -125, 5.0), (-126, 33, 5.0), (-164, -67, 7.0), (-173, -4, 7.0), (-185, -66, 6.0), (-202, 1, 7.0),
             (-204, -36, 4.0), (-55, -183, 3.5), (-64, -186, 3.5), (-66, 105, 3.5)]


def main() -> None:
    tr = Track()
    fr = tr.fr
    out = []
    for x0, x1, z0, z1, h, roof in PIT_COMPLEX:
        corners = np.array([(x0, z0), (x1, z0), (x1, z1), (x0, z1)])
        en = fr.o + corners[:, :1] * fr.l + corners[:, 1:] * fr.f
        out.append(dict(en=en.round(2).tolist(), height=h, roof=roof))
    roof_mask = np.load(os.path.join(WORK, "classes.npz"))["roof"].astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(roof_mask, connectivity=8)
    keep = np.array([(a, b) for a, b, _ in AUTO_KEEP], float)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] * 0.0625 < 40:
            continue
        pts = np.column_stack(np.where(lab == i))[:, ::-1].astype(np.float32)
        rect = cv2.minAreaRect(pts)
        box = cv2.boxPoints(rect)
        en = np.column_stack([(box[:, 0] + 0.5) * 0.25 - HALF_E, HALF_N - (box[:, 1] + 0.5) * 0.25])
        xz = fr.xz(en.mean(0, keepdims=True))[0]
        d = np.hypot(*(keep - xz).T)
        if d.min() < 4.0:
            out.append(dict(en=en.round(2).tolist(), height=AUTO_KEEP[int(d.argmin())][2], roof="white"))
    json.dump(out, open(os.path.join(SRC, "buildings.json"), "w"), indent=1)
    print(len(out), "buildings")


if __name__ == "__main__":
    main()
