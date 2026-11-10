"""Step: the standard circuit of Autodrom Sosnova (turns 1 to 12) as a second lap.

The race route of 14.11.2026 lies inside the standard circuit and shares most of its asphalt with it. The standard
lap is put together from pieces of the surveyed race line and four hand-traced links (east/north metres, traced
on the 12.5 cm orthophoto):
  A  after turn 1 back west on the return road and right into the infield loop (turn 2)
     ... the infield loop is then driven against the direction of the race route (turns 3 and 4)
  B  from the infield hairpin across to the east leg
  C  across the north junction to the north leg (turns 5 and 6)
  D  at the end of the west leg down and round the south-west loop (turns 11 and 12) onto the start straight
Reads source/work/centerline.json and centerline_route.json, writes source/work/centerline_route_std.json.
Run refine.py, edgescan.py and heights.py with SOSNOVA_LAP=_std afterwards."""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK, closed_resample, periodic_gauss  # noqa: E402

A = [(170, -5.5), (155, -4.6), (140, -5.6), (120, -8.6), (100, -11.5), (80, -14), (62, -17.2), (51, -16.5), (42.5, -13), (36.5, -7), (33, 1)]
B = [(120, 21.5), (128, 21), (136, 24), (143, 31), (147, 39)]
C = [(92, 101.5), (82, 103.5), (73, 106.5), (67.8, 111)]
D = [(-50.5, -18), (-53.5, -30), (-56.5, -42), (-57.5, -52), (-55, -63), (-47, -70.5), (-35, -72.5), (-23, -70), (-15, -62), (-12.5, -51),
     (-11.5, -43), (-7, -37.5), (2, -35.6)]
# where each link leaves and rejoins the race line: a point near the race line before and after the link
JOIN = dict(A=((186.7, -12), (31, 11)), B=((113, 26), (146, 47)), C=((100.5, 100.5), (65.5, 118)), D=((-49, -8), (14, -37)))


def main() -> None:
    ev = np.array(json.load(open(os.path.join(WORK, "centerline.json"), encoding="utf-8"))["en"])
    src = json.load(open(os.path.join(WORK, "centerline_route.json"), encoding="utf-8"))
    at = lambda p: int(np.argmin(np.linalg.norm(ev - np.array(p), axis=1)))
    a0, a1 = at(JOIN["A"][0]), at(JOIN["A"][1])
    b0, b1 = at(JOIN["B"][0]), at(JOIN["B"][1])
    c0, c1 = at(JOIN["C"][0]), at(JOIN["C"][1])
    d0, d1 = at(JOIN["D"][0]), at(JOIN["D"][1])
    assert a0 < b1 < c0 < b0 < a1 < c1 < d0 < d1, (a0, b1, c0, b0, a1, c1, d0, d1)
    parts = [ev[:a0 + 1], np.array(A, float), ev[a1:b0 - 1:-1], np.array(B, float), ev[b1:c0 + 1], np.array(C, float), ev[c1:d0 + 1], np.array(D, float), ev[d1:]]
    c = closed_resample(np.vstack(parts), 1.0)
    w = np.zeros(len(c))                                     # smooth only near the eight joins
    for p in (ev[a0], ev[a1], ev[b0], ev[b1], ev[c0], ev[c1], ev[d0], ev[d1]):
        w = np.maximum(w, np.exp(-0.5 * (np.linalg.norm(c - p, axis=1) / 9.0) ** 2))
    c = c * (1 - w[:, None]) + periodic_gauss(c, 3.0) * w[:, None]
    k0 = int(np.argmin(np.linalg.norm(c - ev[0], axis=1)))
    c = np.roll(c, -k0, axis=0)
    c[0] = ev[0]
    out = dict(src)
    lap = float(np.linalg.norm(np.roll(c, -1, axis=0) - c, axis=1).sum())
    out.update(en=c.tolist(), lap_m=lap)
    json.dump(out, open(os.path.join(WORK, "centerline_route_std.json"), "w"))
    print(f"standard circuit: {lap:.0f} m; race line stations used: 0-{a0}, {a1}-{b0} reversed, {b1}-{c0}, {c1}-{d0}, {d1}-{len(ev) - 1}")


if __name__ == "__main__":
    main()
