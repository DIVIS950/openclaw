"""The original circuit outside the race lap, traced by hand from the 12.5 cm orthophoto (east/north metres).

The race lap uses only part of the asphalt at Sosnová. Everything else that is really paved is listed here as
clean geometry: roads are centre lines with one width, paved areas are polygons with rounded corners.
tools/design.py turns them into asphalt, tools/marks.py gives them lines and kerbs."""
from __future__ import annotations

import numpy as np
from scipy.interpolate import splev, splprep
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

# name, width (m), centre line, square end ("" / "end"). Roads carry the same dark asphalt, white edge lines and kerbs
# as the lap. A road normally runs on into the lap; a square end is a clean seam where it meets a paved area.
ROADS = [
    # the return leg of the permanent circuit: from the east hairpin back west to the start area
    ("return", 9.5, [(186, -8.3), (170, -5.5), (155, -4.6), (140, -5.6), (120, -8.6), (100, -11.5), (80, -14), (62, -17.5)], "end"),
    # the loop south-west of the start straight
    ("sw_loop", 8.5, [(-49, -30), (-55.5, -40), (-57.5, -52), (-55, -63), (-47, -70.5), (-35, -72.5), (-23, -70), (-15, -62), (-12.5, -51),
                      (-12.5, -42), (-9.5, -35)], ""),
    # the short link west of the bridge
    ("west_link", 7.0, [(-49.5, -4), (-41, -5), (-33, -8), (-28, -14.5), (-27, -23), (-26.5, -31)], ""),
    # the outer line of the infield hairpin, joining the east leg
    ("hairpin_outer", 8.0, [(147, 50), (146.5, 38), (142, 28), (133, 22), (124, 22.5), (117, 26)], ""),
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
    # the wide outside of the east hairpin
    ("hairpin_outside", "apron", 2.5, [(172, -57), (180, -66), (196, -60), (205, -48), (209, -34), (206, -18), (199, -5), (190, 2), (184, -6),
                                       (193, -28), (189, -46)]),
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


def areas(kind: str):
    out = [rounded(pts, r) for _, k, r, pts in AREAS if k == kind]
    if kind == "pad":
        out += [LineString(spline(pts)).buffer(w / 2, cap_style="flat", quad_segs=5) for _, w, pts in LANES]
    return unary_union(out) if out else Polygon()


def all_paved():
    """Everything in this file that is asphalt or concrete."""
    return unary_union([areas("apron"), areas("pad"), roads_polygon()]).buffer(0)
