"""Step 1 for a race layout: put the organiser's route on the aerial photo.

Reads source/trace/route_5-12-2026.json:
  pixels    the red line of the organiser's map as an ordered closed loop of pixel positions, starting at the red
            start arrow and running in the direction of travel
  dots_px   the centres of the yellow dots (tyre stacks)
  A         the similarity [[a, b, tx], [c, d, ty]] that takes a pixel of the map (source/trace/aerial_5-12-2026.png)
            to a pixel of the orthophoto (source/cuzk/ortho.png, 12.5 cm per pixel)
The route and the dots were each read from the map twice, by different methods, and the map was laid on the photo
two ways (directly, and through the map of the earlier race); the results were compared before they were written here.

Writes source/cuzk/route_ortho.json for geom.py.

    python3 place_route.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EVENT, GSD, ORTHO_H, ORTHO_W, SRC  # noqa: E402

TRACE = os.path.join(SRC, "trace", "route_5-12-2026.json")


def main() -> None:
    src = json.load(open(TRACE, encoding="utf-8"))
    A = np.array(src["A"], float)

    def place(p):
        p = np.array(p, float).reshape(-1, 2)
        return p @ A[:, :2].T + A[:, 2]

    route, dots = place(src["pixels"]), place(src["dots_px"])
    lap = float(np.linalg.norm(np.roll(route, -1, axis=0) - route, axis=1).sum() * GSD)
    scale = float(np.sqrt(abs(np.linalg.det(A[:, :2]))) * GSD)
    turn = float(np.degrees(np.arctan2(A[1, 0], A[0, 0])))
    inside = (route[:, 0] > 0) & (route[:, 0] < ORTHO_W) & (route[:, 1] > 0) & (route[:, 1] < ORTHO_H)
    assert inside.all(), "the route leaves the orthophoto"
    out = dict(name=EVENT, route_px=route.round(2).tolist(), cones_px=dots.round(2).tolist(), start_px=route[0].round(2).tolist(),
               gsd=GSD, ortho_size=[ORTHO_W, ORTHO_H], lap_m=lap, map_m_per_px=scale, map_turn_deg=turn)
    json.dump(out, open(os.path.join(SRC, "cuzk", "route_ortho.json"), "w", encoding="utf-8"))
    print(f"{EVENT}: {len(route)} route points, {len(dots)} dots; the map is {scale:.4f} m per pixel, turned {turn:+.2f} deg; "
          f"drawn route {lap:.0f} m")


if __name__ == "__main__":
    main()
