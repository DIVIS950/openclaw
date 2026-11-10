"""The original circuit outside the race lap, traced by hand from the 12.5 cm orthophoto (east/north metres).

The race lap uses only part of the asphalt at Sosnová. Everything else that is really paved is listed here as
clean geometry: roads are centre lines with one width, paved areas are polygons with rounded corners.
tools/design.py turns them into asphalt, tools/marks.py gives them lines and kerbs."""
from __future__ import annotations

import numpy as np
from scipy.interpolate import splev, splprep
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

# name, width (m), centre line, square end ("" / "end"). These are the roads of the circuit that the race lap does
# not use. Each runs from the lap to the lap, so nothing ends in the grass. Same asphalt, lines and kerbs as the lap.
ROADS = [
    # from turn 1 back west on the return road and right into the infield loop
    ("return", 9.0, [(187, -10.5), (170, -5.5), (155, -4.6), (140, -5.6), (120, -8.6), (100, -11.5), (80, -14), (62, -17.2), (51, -16.5),
                     (42.5, -13), (36.5, -7), (33, 1), (31, 11)], ""),
    # from the infield hairpin across to the east leg
    ("hairpin_link", 9.0, [(112, 26.5), (120, 21.5), (128, 21), (136, 24), (143, 31), (147, 39), (146.3, 47.5)], ""),
    # across the north junction
    ("north_link", 9.0, [(101, 100.5), (92, 101.5), (82, 103.5), (73, 106.5), (67.8, 111), (65.6, 118)], ""),
    # the loop south-west of the start straight
    ("sw_loop", 9.0, [(-49.5, -14), (-53.5, -30), (-56.5, -42), (-57.5, -52), (-55, -63), (-47, -70.5), (-35, -72.5), (-23, -70), (-15, -62),
                      (-12.5, -51), (-11.5, -43), (-7, -37.5), (2, -35.6), (12, -36.8)], ""),
    # the short link west of the bridge
    ("west_link", 8.0, [(-49.5, -4), (-41, -5), (-33, -8), (-28, -14.5), (-27, -23), (-26.5, -31)], ""),
]

# name, kind, corner radius (m), outline. kind: "apron" lighter asphalt, "pad" concrete, "gravel".
# Outlines that follow the lap are drawn along the lap's centre line, so the lap covers the seam.
AREAS = [
    # the big square between the west leg and the diagonal
    ("plaza", "apron", 3.0, [(-44, 100), (-33, 97), (-25, 92.5), (-18, 90.5), (2.5, 91.5), (18, 93), (30, 96), (44, 98.5), (60, 100.5), (64, 101), (64, 84), (58, 88),
                             (37, 77.4), (20, 71.5), (6.7, 67), (-12, 61), (-22, 48), (-24, 40), (-27, 37), (-32, 41), (-44, 43)]),
    # the junction between the plaza, the north leg and the infield loop
    ("north_junction", "apron", 2.5, [(60, 84), (60, 100), (63, 104), (69, 108.5), (76, 109), (82, 108), (95, 105.5), (106, 105), (106, 96), (90, 96), (82, 90),
                                      (79, 84), (72, 82.5), (64, 81)]),
    # the start area north of the start straight, up to the bridge
    ("start_area", "apron", 1.5, [(-52, -31), (-52, -24.5), (-22.5, -24.5), (-22.5, -26), (-13, -26), (-13, -12), (-23, -12), (-24, 0),
                                  (-12.5, 2.5), (-16, 10), (-21.5, 21), (-19, 28), (-10, 10), (3, -8), (20, -17), (30, -17), (46, -15.8),
                                  (63.2, -12.6), (63.6, -17), (64, -22.5), (92, -27.5), (136, -31.7), (137, -43), (146, -43), (150, -55), (100, -48), (50, -41),
                                  (0, -34)]),
    # the fan of asphalt where the east leg, the hairpin and the return leg meet
    ("east_fan", "apron", 2.0, [(147, 50), (142, 28), (135, 21), (153.5, 4.5), (153, -1), (178, -1), (176, 4), (161, 21), (150, 38)]),
    # the triangle between the infield hairpin and the east leg, and the flare where the return road leaves the hairpin
    ("hairpin_tri", "apron", 1.5, [(126, 46), (147, 50), (143, 24), (133, 20), (124, 30)]),
    ("return_flare", "apron", 1.5, [(150, -9), (168, -11.5), (172, -16), (160, -17.5), (152, -13)]),
    # where the infield loop runs out into the return road
    ("kart_fillet", "apron", 1.5, [(35.5, 6), (37.5, -2), (42, -8), (49, -11.5), (58, -12.7), (63.5, -12.5), (63.5, -17), (46, -17), (30, -18), (30, 6)]),
    # the mouths of the south-west loop, the junction to the paddock and the lane beside the west leg
    ("sw_mouth", "apron", 1.5, [(-22, -36), (4, -36), (-2, -47), (-8, -50), (-17, -50), (-20, -46)]),
    ("west_junction", "apron", 1.5, [(-63, -18), (-50, -18), (-43, -30), (-45, -47), (-52, -40), (-62, -38)]),
    ("west_lane", "apron", 1.5, [(-61, 47), (-50, 47), (-50, -20), (-60.5, -20)]),
    # the forecourt in front of the grandstand
    ("pit_entry", "apron", 1.5, [(22, -40), (58, -45), (57, -62), (26, -62)]),
    # the paddock
    ("paddock", "apron", 3.0, [(-114, 30), (-63, 30), (-63, -25), (-67.5, -45), (-68, -67), (-150, -67), (-141, -45), (-132, -30), (-125, -5)]),
    # the white concrete apron inside the east hairpin, and the gravel pocket behind it
    ("hairpin_apron", "pad", 1.0, [(146, -52), (165, -56), (182, -52), (191, -41), (193, -28), (186, -14), (178, -8.5), (167, -8.5),
                                   (172, -16), (177.8, -23.3), (178.5, -32.3), (173.3, -41.3), (160, -42.3), (146, -42.6)]),
    ("hairpin_pocket", "gravel", 1.0, [(168.5, -15), (171.5, -16.5), (177.3, -23.5), (178, -32.2), (173, -40.8), (168, -41.6), (169.5, -28)]),
    # the concrete at the foot of the bridge and the sprinkled skid pad on the plaza
    ("bridge_foot", "pad", 1.0, [(5.3, 61.5), (16.4, 62.4), (15.7, 56), (9.4, 47), (1.1, 42.2), (1.1, 47.5), (5.3, 48.5)]),
    ("skid_pad", "pad", 0.4, [(-9.3, 77.6), (-7.9, 70.3), (41.4, 82.8), (37.9, 90.4)]),
    # the lay-by on the north straight
    ("layby", "gravel", 2.0, [(-47, 188), (-46, 200), (-14, 201.5), (-12, 189)]),
]

# concrete lanes: name, width, centre line (drawn as pads)
LANES = [
    ("paddock_lane", 8.5, [(-73.5, 30), (-68.7, 60), (-64.2, 85), (-61, 99)]),
]

# barriers that belong to the original circuit: east/north polyline, width, height
BARRIERS = [
    dict(name="paddock_wall", en=[(-61.8, 28), (-61.8, -22), (-63.5, -33), (-65.8, -48), (-66.5, -60)], width=0.5, height=1.0),
]


def spline(pts, step: float = 0.5) -> np.ndarray:
    """A smooth line through hand-set points, resampled every step metres."""
    p = np.array(pts, float)
    tck, _ = splprep(p.T, s=len(p) * 0.15, k=min(3, len(p) - 1))
    q = np.column_stack(splev(np.linspace(0, 1, 400), tck))
    cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))])
    s = np.linspace(0, cum[-1], max(2, int(cum[-1] / step) + 1))
    return np.column_stack([np.interp(s, cum, q[:, 0]), np.interp(s, cum, q[:, 1])])


def rounded(pts, r: float) -> Polygon:
    p = Polygon(pts).buffer(0)
    return p.buffer(-r, quad_segs=5).buffer(2 * r, quad_segs=5).buffer(-r, quad_segs=5)


def roads() -> list[tuple[str, np.ndarray, float]]:
    return [(name, spline(pts), float(w)) for name, w, pts, _ in ROADS]


def road_polygon(en: np.ndarray, w: float, square: str):
    p = LineString(en).buffer(w / 2, cap_style="round", quad_segs=5)
    if square == "end":                                  # cut the round cap off, square to the road
        d = en[-1] - en[-4]
        d = d / np.linalg.norm(d)
        n = np.array([-d[1], d[0]])
        c = en[-1]
        p = p.difference(Polygon([c + n * w, c + n * w + d * w, c - n * w + d * w, c - n * w]))
    return p


def roads_polygon():
    return unary_union([road_polygon(en, w, sq) for (_, en, w), (_, _, _, sq) in zip(roads(), ROADS)])


def t1_lane():
    """The first turn at its real width. The real turn 1 is about 17 m wide and its outer edge sweeps round from
    the start straight into the return road; the race lap is 9 m and leaves that turn northwards. This is the
    asphalt between the two: the outside of the turn, bounded by one smooth curve. The curve follows the outer
    asphalt edge measured on the standard lap (centerline_std.json) and then the painted limit of the real turn
    into the north edge of the return road. Returns (polygon, outer curve east/north, mesh points)."""
    import json
    import os
    from common import WORK, closed_frames
    c = np.array(json.load(open(os.path.join(WORK, "centerline_std.json"), encoding="utf-8"))["en"])
    _, nrm, _, _ = closed_frames(c)
    ctrl = [c[s] - nrm[s] * d for s, d in ((110, 4.4), (114, 5.6), (118, 7.6), (122, 9.3), (126, 10.2), (132, 10.6), (138, 10.6), (144, 10.6), (149, 10.6))]
    # the painted limit of the real turn, read off the 12.5 cm photo: it leaves the outer edge and runs straight
    # into the north edge of the return road
    ctrl += [(197.6, -12.6), (193.0, -8.6), (187.0, -6.6), (181.0, -5.6), (171.0, -3.6), (161.0, -1.6), (152.0, -0.3), (144.0, -0.9), (138.0, -2.4)]
    outer = spline(ctrl)
    poly = Polygon(np.vstack([outer, c[110:206][::-1]])).buffer(0)
    rows = np.vstack([c[114:162:2] - nrm[114:162:2] * d for d in (6.0, 8.2)])
    return poly, outer, rows


def areas(kind: str):
    if kind == "road":
        return t1_lane()[0]
    out = [rounded(pts, r) for _, k, r, pts in AREAS if k == kind]
    if kind == "pad":
        out += [LineString(spline(pts)).buffer(w / 2, cap_style="flat", quad_segs=5) for _, w, pts in LANES]
    return unary_union(out) if out else Polygon()


def all_paved():
    """Everything in this file that is asphalt or concrete."""
    return unary_union([areas("apron"), areas("pad"), roads_polygon()]).buffer(0)


def road_frames() -> list[dict]:
    """Each road as points every 0.5 m with left normals, half width and signed curvature (+ = bends left)."""
    out = []
    for name, en, w in roads():
        d = np.gradient(en, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]])
        a, b = en[1:-1] - en[:-2], en[2:] - en[1:-1]
        k = np.zeros(len(en))
        k[1:-1] = (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / np.maximum(np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) * 0.5, 1e-9)
        k = np.convolve(np.pad(k, 8, mode="edge"), np.ones(17) / 17, "valid")
        out.append(dict(name=name, en=en, nrm=nrm, half=w / 2.0, k=k))
    return out
