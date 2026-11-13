"""The real asphalt of the circuit, straight from the survey: one clean outline of everything that is paved.

The outline comes from the hard-surface mask of the aerial photo (survey.py, paint.py; refine.drivable_mask). It is cut to the circuit, cleaned
of cars, paint and shadows, and smoothed by a quarter of a metre. The lap, the plaza, the junctions and the
connecting roads are all part of it, with the widths they really have.

    python3 realmap.py      writes source/work/realmap.wkb and a check picture
"""
from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from shapely import wkb
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, WORK  # noqa: E402

GSD = 0.25
_cache: dict = {}
REACH = 62.0            # asphalt further than this from the lap is not part of the circuit model (m)
# The circuit, traced loosely by hand (east/north, m). It runs through grass wherever it can; where it has to cut
# through paving (the gate, the paddock, the car park) or through bare earth that the mask takes for asphalt
# (north straight, north-east corner) it follows the real edge.
REGION = [
    (-156, 154), (-149, 155.5), (-142, 157.5), (-137, 160), (-128, 163.5), (-120, 168.5), (-110, 176), (-101, 181.5), (-92, 185),
    (-83, 187.5), (-74, 187.5), (-66, 186.5), (-55, 186.5), (-45, 189.5), (-38, 192), (-30, 199), (-20, 203), (0, 208), (15, 204),
    (22, 199.5), (30, 187.5), (36.8, 180.3), (42.3, 173.2), (47.3, 165.5), (51.4, 158.7), (55, 151.4), (58.6, 145), (62.3, 138.7),
    (65.9, 132.3), (68.9, 127.5), (71.5, 123), (73, 121.5), (76, 117.5), (84, 112), (93, 106.5), (102, 106.5), (112, 110), (119, 110.5),
    (124, 109), (127, 100), (132, 89.3), (138, 78), (144.5, 67.9), (152, 53.6), (160.5, 39.3), (174, 25), (188, 10.7), (202, -3.6),
    (210, -17.9), (214, -32), (211, -46.4), (204, -60), (190, -70), (175, -68.5), (150, -65), (120, -61.5), (95, -59), (73, -53),
    (50, -49.5), (32, -47.5), (20, -50), (5, -63), (-8, -69.5), (-12, -74), (-16, -78.5), (-58, -79), (-63, -70), (-62, -25),
    (-58.5, -25), (-58.5, 33), (-70.5, 33), (-70.5, 45), (-75, 50), (-105, 60), (-113, 48), (-118, 32.5), (-125.5, 18), (-135, 3.5),
    (-141, -8), (-146, -22), (-153, -35), (-160, -46), (-168, -56), (-185, -58), (-215, -56), (-238, -40), (-240, 60), (-236, 105),
    (-218, 138), (-178, 151),
]
# hand corrections, east/north (m): places the mask gets wrong
ADD: list[list[tuple[float, float]]] = []
CUT: list[list[tuple[float, float]]] = []


def _to_polys(mask: np.ndarray):
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_TC89_L1)
    if hier is None:
        return Polygon()

    def en(c):
        c = c.reshape(-1, 2).astype(float)
        return np.column_stack([(c[:, 0] + 0.5) * GSD - HALF_E, HALF_N - (c[:, 1] + 0.5) * GSD])
    out = []
    for k, c in enumerate(cs):
        if hier[0][k][3] != -1 or len(c) < 4:
            continue
        holes, ch = [], hier[0][k][2]
        while ch != -1:
            if len(cs[ch]) >= 4:
                holes.append(en(cs[ch]))
            ch = hier[0][ch][0]
        p = Polygon(en(c), holes).buffer(0)
        if not p.is_empty:
            out.append(p)
    return unary_union(out)


def _smooth(ring, step: float = 0.5, sigma_m: float = 1.6, flat: bool = False) -> np.ndarray:
    """A ring of the outline without the wiggle of the 25 cm mask: resampled and smoothed along its length.
    flat: use the filter 2G - GG instead of the plain Gaussian G. It takes out the same wiggle but leaves bends
    of a few metres radius where they are, so a strong smoothing does not pull corners inwards."""
    from scipy.ndimage import gaussian_filter1d
    k = max(12, int(ring.length / step))
    xy = np.array([ring.interpolate(j / k, normalized=True).coords[0] for j in range(k)])
    sig = min(sigma_m / step, k / 12.0)                              # a small island keeps its shape
    g = gaussian_filter1d(xy, sig, axis=0, mode="wrap")
    return 2 * g - gaussian_filter1d(g, sig, axis=0, mode="wrap") if flat else g


def _smooth_line(pts, sigma_m: float = 1.5, step: float = 0.5) -> np.ndarray:
    """An open traced line (paint, a tyre wall) without its wiggle. Both ends stay where they are."""
    from scipy.ndimage import gaussian_filter1d
    p = np.asarray(pts, float)
    cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    if cum[-1] < 4 * step:
        return p
    t = np.linspace(0, cum[-1], max(5, int(cum[-1] / step) + 1))
    q = np.column_stack([np.interp(t, cum, p[:, 0]), np.interp(t, cum, p[:, 1])])
    sig = min(sigma_m / step, len(q) / 6.0)
    g = gaussian_filter1d(q, sig, axis=0, mode="nearest")
    g = 2 * g - gaussian_filter1d(g, sig, axis=0, mode="nearest")
    fade = np.clip(np.minimum(t, cum[-1] - t) / max(2 * sigma_m, 1e-6), 0, 1)[:, None]      # the ends are fixed points
    return q * (1 - fade) + g * fade


def _mask() -> np.ndarray:
    """Hard, flat ground of the photo at 25 cm (survey.py) with the painted markings on it (paint.py)."""
    if "mask" not in _cache:
        import refine
        _cache["mask"] = refine.drivable_mask()
    return _cache["mask"]


def _colours():
    """(brightness relative to asphalt, warmth) of the photo at 25 cm. Asphalt is bluish grey (warmth -0.08), sand is
    warm (+0.1 and more), the concrete of the hairpin is white (brightness 1.6)."""
    im = cv2.imread(os.path.join(WORK, "ortho_025.png"))[:, :, ::-1].astype(np.float32) / 255.0
    im = cv2.GaussianBlur(im, (0, 0), 1.0)
    lum = im.mean(-1)
    m = _mask()
    ref = float(np.median(lum[m & ((im.max(-1) - im.min(-1)) < 0.09)]))
    return lum / ref, (im[..., 0] - im[..., 2]) / np.maximum(lum, 1e-3)


def _sand_mask() -> np.ndarray:
    bright, warm = _colours()
    return (warm > 0.045) & (bright > SAND_BRIGHT) & (bright < 1.5)


def paint_areas(P0):
    """The bright patches traced from the photo (paint.json), sorted into what they are:
    strips - solid pale concrete on or beside the asphalt: the real kerbs of Sosnova are flat concrete strips;
    boxes  - painted outlines (start boxes, bays): rings to draw as lines."""
    bright, _ = _colours()
    data = json.load(open(os.path.join(WORK, "paint.json"), encoding="utf-8"))
    region = Polygon(REGION).buffer(3.0)
    strips, boxes = [], []
    for ring in data["areas"]:
        if len(ring) < 3:
            continue
        g = Polygon(ring).buffer(0)
        if g.is_empty or g.geom_type != "Polygon" or not (1.5 < g.area < 400.0) or not region.contains(g.representative_point()) or g.distance(P0) > 0.8:
            continue
        px = np.round(np.column_stack([(np.array(g.exterior.coords)[:, 0] + HALF_E) / GSD, (HALF_N - np.array(g.exterior.coords)[:, 1]) / GSD])).astype(np.int32)
        x0, y0 = px.min(0)
        x1, y1 = px.max(0) + 1
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.fillPoly(m, [px - [x0, y0]], 1)
        fill = float((bright[y0:y1, x0:x1][m > 0] > 1.12).mean()) if m.any() else 0.0
        if fill >= 0.55:
            strips.append(g.buffer(0.25).buffer(-0.25))
        elif g.area > 3.0:                                           # a painted box is a rectangle: draw it as one
            rect = cv2.minAreaRect(np.array(g.exterior.coords, np.float32))
            if g.area >= 0.45 * rect[1][0] * rect[1][1] and 2.0 <= min(rect[1]) and max(rect[1]) <= 40.0:
                r_ = cv2.boxPoints(rect)
                boxes.append(np.vstack([r_, r_[:1]]).round(2).tolist())
            # anything else that is bright only along its rim is the trace of a line or an edge, not a box
    return (unary_union(strips) if strips else Polygon()), boxes


def pale_concrete(P0):
    """Pale, colourless ground on or right beside the asphalt: concrete. Asphalt is bluish and darker, sand and dry
    grass are warm, paint is too thin to pass. This is how the wide concrete kerbs of the infield are found."""
    bright, warm = _colours()
    m = ((bright > 1.02) & (bright < 1.6) & (warm > -0.045) & (warm < 0.05)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    # only what lies outside the asphalt outline counts: pale patches inside it are old asphalt, and the photo
    # texture shows them as they are
    C = _to_polys(m).intersection(Polygon(REGION).buffer(3.0)).intersection(P0.buffer(3.5)).difference(P0.buffer(-0.25))
    C = C.buffer(-0.4).buffer(0.4)                                    # no rims
    keep = [Polygon(_smooth(g.exterior, sigma_m=0.6)).buffer(0) for g in getattr(C, "geoms", [C])
            if g.geom_type == "Polygon" and 6.0 < g.area < 300.0 and g.distance(P0) < 0.3]
    return unary_union(keep) if keep else Polygon()


def compute_extras(P, strips):
    """(concrete inside the outline, sand beside it) as polygons."""
    bright, warm = _colours()
    region = Polygon(REGION)
    white = cv2.morphologyEx(((bright > 1.38) & (warm < 0.06)).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    pads = _to_polys(white).intersection(P)
    pads = unary_union([Polygon(_smooth(g.exterior, sigma_m=1.0)).buffer(0) for g in getattr(pads, "geoms", [pads]) if g.geom_type == "Polygon" and g.area > 60.0])
    white_pad = pads
    pads = unary_union([pads, strips.buffer(0.2)]).intersection(P)
    sand = cv2.morphologyEx(_sand_mask().astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    sand = cv2.morphologyEx(sand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    S = _to_polys(sand).intersection(region.buffer(14.0)).difference(P.buffer(0.4))
    from shapely.geometry import Point
    keep = [Polygon(_smooth(g.exterior, sigma_m=1.2)).buffer(0) for g in getattr(S, "geoms", [S])
            if g.geom_type == "Polygon" and g.area > 80.0 and min(g.distance(Point(q)) for q in SAND_AT) < 6.0]
    S = unary_union(keep).difference(P.buffer(0.4)) if keep else Polygon()
    S = unary_union([g for g in getattr(S, "geoms", [S]) if g.geom_type == "Polygon" and g.area > 60.0]) if not S.is_empty else S
    return pads, S, white_pad


def compute():
    cl = json.load(open(os.path.join(WORK, "centerline.json"), encoding="utf-8"))
    c = np.array(cl["en"])
    lap = LineString(np.vstack([c, c[:1]]))
    m = (_mask() & ~_sand_mask()).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    region = Polygon(REGION)
    assert region.is_valid and region.contains(lap), "the traced circuit must hold the whole lap"
    P = unary_union([_to_polys(m), lap.buffer(2.5), *[Polygon(a) for a in ADD]]).intersection(region)
    if CUT:
        P = P.difference(unary_union([Polygon(a) for a in CUT]))
    # the overpass: the mask takes its deck for asphalt and loses the road in its shadow. On the ground there is the
    # lap road passing under it, and grass on both sides
    import bridge_geom as bg
    br = unary_union([Polygon(bg.footprint(grow=0.6)), Polygon(bg.shadow_polygon()).buffer(0.6)])
    P = unary_union([P.difference(br), lap.buffer(UNDER_BRIDGE_HALF).intersection(br.buffer(1.0))])
    P = P.buffer(1.2).buffer(-2.4).buffer(1.2)                        # close gaps of 2.4 m, drop spurs thinner than 2.4 m
    P = max(getattr(P, "geoms", [P]), key=lambda g: g.intersection(lap).length)     # the piece the lap runs on
    holes = [h for h in P.interiors if Polygon(h).area >= 45.0]       # cars, paint and noise are not grass islands
    P = Polygon(_smooth(P.exterior), [_smooth(h) for h in holes]).buffer(0)
    P = max(getattr(P, "geoms", [P]), key=lambda g: g.area)
    strips, boxes = paint_areas(P)
    strips = unary_union([strips, pale_concrete(P)])
    P = unary_union([P, strips.buffer(0.2)]).buffer(0.3).buffer(-0.3)                # the concrete strips are paved too
    P = max(getattr(P, "geoms", [P]), key=lambda g: g.area)
    P = Polygon(_smooth(P.exterior, sigma_m=EDGE_SIGMA, flat=True), [_smooth(h, sigma_m=EDGE_SIGMA, flat=True) for h in P.interiors if Polygon(h).area >= 45.0]).buffer(0)
    P = max(getattr(P, "geoms", [P]), key=lambda g: g.area)                          # one even edge, strips included
    return P.simplify(0.05), strips, boxes


def _load(name: str):
    path = os.path.join(WORK, f"realmap_{name}.wkb")
    assert os.path.exists(path), "run realmap.py first"
    return wkb.loads(open(path, "rb").read())


def asphalt():
    """Everything paved, concrete included."""
    return _load("asphalt")


def pads():
    """The white concrete of the hairpin and other bright concrete inside the outline."""
    return _load("pads")


def white():
    """The white concrete pad on the inside of turn 1 (part of pads())."""
    return _load("white")


def sand():
    """The sand run-offs beside the asphalt."""
    return _load("sand")


def boxes() -> list:
    """Painted outlines on the asphalt (start boxes, bays) as rings of east/north points."""
    return json.load(open(os.path.join(WORK, "realmap_boxes.json")))["boxes"]


# Barriers that the automatic tracing leaves in pieces, traced by hand from the photo (east/north, m)
WALLS = [
    # the tyre wall along the east side, from the infield junction down to the hairpin
    dict(en=[(138, 69.5), (142.1, 65), (152.1, 50.7), (162.1, 36.4), (175, 22.1), (187.9, 10.7), (200.7, -0.7), (209.3, -12.1), (211.6, -23.6)],
         width=1.3, height=0.9, material="tyres"),
    # the white and blue barrier on the outside of the hairpin, and the tyres behind the sand at its exit
    dict(en=[(211.6, -30.5), (211.9, -38), (210.9, -45), (209.3, -49.3)], width=0.7, height=1.0, material="softwall"),
    dict(en=[(207.9, -52.5), (203.6, -57.4), (195, -63.6), (186.4, -67.2)], width=1.3, height=0.9, material="tyres"),
]


def walls() -> list[dict]:
    """The real barriers of the circuit: the tyre walls traced from the photo, plus the hand-traced ones."""
    region = Polygon(REGION).buffer(14.0)
    hand = unary_union([LineString(w["en"]) for w in WALLS])
    out = [dict(w) for w in WALLS]
    for w in json.load(open(os.path.join(WORK, "tyre_walls.json"), encoding="utf-8"))["tyre_walls"]:
        ln = LineString(w["en"])
        if ln.length < 7.0 or not region.contains(ln) or ln.distance(hand) < 3.5:
            continue
        out.append(dict(en=_smooth_line(w["en"], 2.0).round(2).tolist(), width=max(1.2, float(w.get("width", 1.3))), height=0.9, material="tyres"))
    return out


SAND_BRIGHT = 1.07      # sand is brighter than this (asphalt = 1); dry grass is darker
SAND_AT = [(-200, -55), (-232, 95), (207, -35), (197, -62), (-30, 200), (25, 195)]      # the real sand run-offs (a point in each)
EDGE_SIGMA = 3.0        # smoothing of the finished outline along its length (m): wiggles shorter than about 10 m go
WIDTH_SIGMA = 5.0       # smoothing of the lap's half widths along the lap (m): its edges run parallel to the centre line
UNDER_BRIDGE_HALF = 4.8  # half width of the road where it passes under the overpass (m)
CAP = 16.0              # a side with asphalt further out than this is open: the lap runs across a paved area there
OPEN_HALF = 5.5         # half width of the lap's own strip on an open side (m)
SLOPE = 0.30            # the strip's edge leaves a real edge that turns away at no more than this (m per m)


def _concrete_beyond(c: np.ndarray, nrm: np.ndarray, sgn: float, w: np.ndarray) -> np.ndarray:
    """Width (m) of the pale concrete right outside the edge of the lap, read from the 12.5 cm photo along the normal
    of every station. Concrete is brighter than the asphalt beside it, has no green in it and is not as warm as bare
    earth. The 25 cm mask misses many of these strips, or only finds parts of them."""
    from PIL import Image
    from common import SRC
    if "photo" not in _cache:
        Image.MAX_IMAGE_PIXELS = None
        rgb = np.asarray(Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("RGB"), np.float32) / 255.0
        _cache["photo"] = cv2.GaussianBlur(rgb, (0, 0), 0.7)
    rgb = _cache["photo"]
    START, STEP = 0.20, 0.05                                          # the first 20 cm are the blur of the edge itself

    def at(t):
        en = c[:, None, :] + sgn * nrm[:, None, :] * (w[:, None] + t[None, :])[..., None]
        mx, my = ((en[..., 0] + HALF_E) / 0.125 - 0.5).astype(np.float32), ((HALF_N - en[..., 1]) / 0.125 - 0.5).astype(np.float32)
        return cv2.remap(rgb, mx, my, cv2.INTER_LINEAR)
    a, b = at(np.arange(-1.5, -0.39, 0.05)), at(np.arange(START, 4.51, STEP))
    lum0 = np.median(a.mean(-1), 1)
    warm0 = np.median((a[..., 0] - a[..., 2]) / np.maximum(a.mean(-1), 1e-3), 1)
    lum = b.mean(-1)
    warm = (b[..., 0] - b[..., 2]) / np.maximum(lum, 1e-3) - warm0[:, None]
    green = b[..., 1] - (b[..., 0] + b[..., 2]) / 2
    ok = (green < 0.035) & (lum > 1.06 * lum0[:, None]) & (warm > 0.02) & (warm < 0.17)
    run = np.where(ok.all(1), ok.shape[1], np.argmin(ok, 1))          # samples of concrete before the first that is not
    seen = np.where(run >= 3, START + run * STEP, 0.0)
    # kerbs of painted blocks: every other block is as dark as asphalt. Within 3 m of a block that was seen, the
    # strip reaches as far as the ground is neither grass nor bare earth
    from scipy.ndimage import maximum_filter1d
    hard = (green < 0.035) & (warm < 0.17)
    reach = np.where(hard.all(1), hard.shape[1], np.argmin(hard, 1))
    reach = np.where(reach >= 3, START + reach * STEP, 0.0)
    near = maximum_filter1d((seen > 0.45).astype(np.uint8), 7, mode="wrap") > 0
    width = maximum_filter1d(np.where(seen > 0.45, seen, 0.0), 7, mode="wrap")       # the width of the blocks seen nearby
    return np.where(near, np.maximum(seen, np.minimum(reach, width + 0.15)), seen)


def lap_widths(P=None, C=None, Wt=None) -> dict:
    """Half widths of the lap from the real outline: the distance from the centre line to the asphalt edge on each
    side. Where the asphalt runs on (junctions, the plaza) the lap keeps a strip of its own. Writes centerline.json."""
    from scipy.ndimage import gaussian_filter1d
    from common import closed_frames
    P = asphalt() if P is None else P
    C = pads() if C is None else C
    Pa = P.difference(C.buffer(0.15)) if not C.is_empty else P       # the lap strip ends where the white concrete begins
    path = os.path.join(WORK, "centerline.json")
    cl = json.load(open(path, encoding="utf-8"))
    c = np.array(cl["en"])
    n = len(c)
    _, nrm, _, _ = closed_frames(c)
    def reach(rim):
        dist = np.full((2, n), 99.0)
        for k, sgn in enumerate((1.0, -1.0)):
            for i in range(n):
                hit = LineString([c[i], c[i] + sgn * 30.0 * nrm[i]]).intersection(rim)
                if not hit.is_empty:
                    pts = np.array([q for g in getattr(hit, "geoms", [hit]) for q in g.coords])
                    dist[k, i] = float(np.linalg.norm(pts - c[i], axis=1).min())
        return dist
    from scipy.ndimage import median_filter

    def clean(v, runs, sigma):
        """Median then Gaussian along each run of stations (a run is a stretch with a real edge on that side)."""
        o = v.copy()
        for a, ln in runs:
            idx = (a + np.arange(ln)) % n
            if ln >= 8:
                o[idx] = gaussian_filter1d(median_filter(v[idx], 7, mode="nearest"), sigma, mode="nearest")
        return o

    def runs_of(mask):
        if mask.all():
            return [(0, n)]
        z = int(np.argmin(mask))
        r = np.roll(mask, -z)
        dd = np.diff(np.concatenate([[0], r.astype(int), [0]]))
        return [((int(a) + z) % n, int(b - a)) for a, b in zip(np.where(dd == 1)[0], np.where(dd == -1)[0])]

    dist, paved = reach(Pa.boundary), reach(P.boundary)
    out = {}
    for k, key in enumerate(("l", "r")):
        d = np.maximum(dist[k], 2.5)
        real = d <= CAP                                                # the asphalt ends within reach on this side
        ds = np.minimum(clean(d, runs_of(real), WIDTH_SIGMA), d + 0.35)   # the edge as a clean line; never far outside the real one
        w = np.where(real, ds, OPEN_HALF)
        for _ in range(2):                                             # lower envelope with a slope limit, both ways round
            for i in range(2 * n):
                w[i % n] = min(w[i % n], w[(i - 1) % n] + SLOPE)
            for i in range(2 * n, 0, -1):
                w[i % n] = min(w[i % n], w[(i + 1) % n] + SLOPE)
        w = np.minimum(gaussian_filter1d(w, 2.5, mode="wrap"), ds)
        closed = real & (ds - w < 0.3)                                 # the strip's edge is the (cleaned) real edge
        # one last pass, with nothing after it that could put a kink back: the edge is an even line. Where that
        # takes it a few decimetres past the real edge, the paving is drawn to the line (corridor)
        w = gaussian_filter1d(w, 3.0, mode="wrap")
        band = np.where(closed, np.clip(paved[k] - d, 0, 30), 0.0)     # concrete beyond the asphalt edge, from the mask
        seen = median_filter(_concrete_beyond(c, nrm, 1.0 if key == "l" else -1.0, w), 5, mode="wrap")      # ... and from the photo
        # under the overpass the photo shows its deck (pale concrete) and its shadow, not the ground: nothing is read there
        import bridge_geom as bg
        from shapely import contains_xy as _within
        hidden = unary_union([Polygon(bg.footprint(grow=2.0)), Polygon(bg.shadow_polygon()).buffer(1.5)])
        for reach_ in (0.4, 1.2):
            probe = c + (1.0 if key == "l" else -1.0) * nrm * (w + reach_)[:, None]
            seen = np.where(_within(hidden, probe[:, 0], probe[:, 1]), 0.0, seen)
        out["seen_" + key] = int(((seen > 0.45) & closed & (band <= 0.45)).sum())
        band = np.where(closed & (band <= 4.0), np.maximum(band, seen), band)
        has = closed & (band > 0.45)
        has = np.array([has[(i - 2) % n] or has[i] or has[(i + 2) % n] for i in range(n)]) & closed      # bridge gaps of 2 m
        bs = np.where(has, clean(band, runs_of(has), 4.0), 0.0)
        kerb = has & (bs <= 4.0)                                        # a concrete strip (the real kind of kerb)
        if Wt is not None and not Wt.is_empty:                          # the white pad is one body, also where it tapers
            from shapely import contains_xy as _in
            probe = c + (1.0 if key == "l" else -1.0) * nrm * (w + 0.8)[:, None]
            kerb &= ~_in(Wt.buffer(0.6), probe[:, 0], probe[:, 1])
        for a, ln in runs_of(kerb):                                    # strips shorter than 5 m are noise; taper the ends
            idx = (a + np.arange(ln)) % n
            if ln < 5:
                kerb[idx], has[idx], bs[idx] = False, False, 0.0
            else:
                # a kerb is at least 60 cm wide (one row of blocks); thinner pieces would break up into slivers
                bs[idx] = np.minimum(np.maximum(bs[idx], 0.6), 0.45 + 0.5 * np.minimum(np.arange(ln), ln - 1 - np.arange(ln)))
        out["w" + key] = w
        out["band_" + key] = np.where(kerb, bs, 0.0)
        out["conc_" + key] = has                                       # concrete beside the lap (a strip, or the white pad)
        out["kerb_" + key] = kerb
        out["open_" + key] = ~closed | has                             # asphalt or concrete carries on beyond the strip
        out["closed_" + key] = closed
    cl.update(wl=out["wl"].round(3).tolist(), wr=out["wr"].round(3).tolist(), open_l=out["open_l"].tolist(), open_r=out["open_r"].tolist(),
              kerb_l=out["kerb_l"].tolist(), kerb_r=out["kerb_r"].tolist(), conc_l=out["conc_l"].tolist(), conc_r=out["conc_r"].tolist(),
              edge_l=(c + nrm * out["wl"][:, None]).round(3).tolist(), edge_r=(c - nrm * out["wr"][:, None]).round(3).tolist())
    json.dump(cl, open(path, "w", encoding="utf-8"))
    out.update(c=c, nrm=nrm, runs_of=runs_of)
    return out


def corridor(P, C, Wt, w: dict):
    """Rebuild the paving along the lap from the cleaned widths, so that every real edge of the lap is one even line:
    the lap strip, a concrete strip of even width where the photo shows one, and nothing outside them for 3.5 m.
    Returns (outline, concrete, white concrete)."""
    c, nrm, n, runs_of = w["c"], w["nrm"], len(w["c"]), w["runs_of"]

    def band(a, ln, sgn, inner, outer):
        if ln < 2:
            return Polygon()
        idx = (a + np.arange(ln + 1)) % n if ln < n else np.arange(n + 1) % n
        lo, hi = c[idx] + sgn * nrm[idx] * inner[idx, None], c[idx] + sgn * nrm[idx] * outer[idx, None]
        return Polygon(np.vstack([lo, hi[::-1]])).buffer(0)

    left, right = Polygon(c + nrm * w["wl"][:, None]), Polygon(c - nrm * w["wr"][:, None])
    big, small = (left, right) if left.area > right.area else (right, left)
    R = Polygon(big.exterior.coords, [small.exterior.coords]).buffer(0)
    cut, strips, fill = [], [], []
    for sgn, key in ((1.0, "l"), (-1.0, "r")):
        wid, bs, closed, kerb, conc = w["w" + key], w["band_" + key], w["closed_" + key], w["kerb_" + key], w["conc_" + key]
        wide = conc & ~kerb                                            # the white pad: only its edge to the lap is redrawn
        for a, ln in runs_of(closed & ~wide):
            cut.append(band(a, ln - 1, sgn, wid - 0.02, wid + bs + 3.5))
        for a, ln in runs_of(kerb):
            strips.append(band(a, ln - 1, sgn, wid - 0.02, wid + bs))
        for a, ln in runs_of(wide):
            fill.append(band(a, ln - 1, sgn, wid - 0.02, wid + 1.5))
    cut = unary_union(cut).difference(R.buffer(0.01)) if cut else Polygon()
    strips, fill = (unary_union(strips) if strips else Polygon()), (unary_union(fill) if fill else Polygon())
    P2 = unary_union([P.difference(cut), R, strips, fill]).buffer(0.12).buffer(-0.12)
    P2 = max(getattr(P2, "geoms", [P2]), key=lambda g: g.area)
    P2 = Polygon(P2.exterior, [h for h in P2.interiors if Polygon(h).area >= 30.0])
    C2 = unary_union([C.difference(cut), strips, fill]).difference(R.buffer(-0.01)).intersection(P2)
    W2 = unary_union([Wt.difference(cut), fill.intersection(Wt.buffer(2.5))]).difference(R.buffer(-0.01)).intersection(P2) if not Wt.is_empty else Wt
    return P2, C2, W2


def others(R):
    """The asphalt beside the lap strip R: everything paved that the lap strip does not cover, without slivers."""
    A = asphalt().difference(R)
    A = A.buffer(-0.2).buffer(0.2).intersection(A)
    return unary_union([g for g in getattr(A, "geoms", [A]) if g.geom_type == "Polygon" and g.area > 1.5]).buffer(0)


if __name__ == "__main__":
    P, strips, boxes_ = compute()
    C, S, Wt = compute_extras(P, strips)
    raw = P
    w = lap_widths(P, C, Wt)
    P, C, Wt = corridor(P, C, Wt, w)
    S = S.difference(P.buffer(0.4))
    for name, g in (("asphalt", P), ("pads", C), ("sand", S), ("white", Wt)):
        open(os.path.join(WORK, f"realmap_{name}.wkb"), "wb").write(wkb.dumps(g))
    json.dump(dict(boxes=boxes_), open(os.path.join(WORK, "realmap_boxes.json"), "w"))
    print("concrete strips %.0f m2, painted boxes %d" % (strips.area, len(boxes_)))
    print("concrete %.0f m2 in %d pieces, sand %.0f m2 in %d pieces" % (C.area, len(getattr(C, "geoms", [C])), S.area, len(getattr(S, "geoms", [S]))))
    print("asphalt %.0f m2, outline %.0f m, %d islands" % (P.area, P.length, len(P.interiors)))
    rim = P.boundary
    q = np.array([rim.interpolate(t_).coords[0] for t_ in np.arange(0, rim.length, 2.0)])
    from shapely import distance as _dist, points as _pts
    dev = _dist(_pts(q), raw.boundary)
    print("clean edge against the smoothed outline of the photo: median %.2f m, 95 %% within %.2f m" % (np.median(dev), np.percentile(dev, 95)))
    print("lap: left %.2f..%.2f m, right %.2f..%.2f m, mean width %.2f m, open left %d m, open right %d m, concrete strip beside the lap %d m" % (
        w["wl"].min(), w["wl"].max(), w["wr"].min(), w["wr"].max(), float(np.mean(w["wl"] + w["wr"])), w["open_l"].sum(), w["open_r"].sum(),
        w["kerb_l"].sum() + w["kerb_r"].sum()))
    print("concrete strip found only in the 12.5 cm photo: %d m left, %d m right" % (w["seen_l"], w["seen_r"]))
    for key in ("wl", "wr"):
        dw = np.abs(np.diff(np.concatenate([w[key], w[key][:1]])))
        print("  %s: change of half width along the lap, median %.3f, 95 %% below %.3f m per m" % (key, np.median(dw), np.percentile(dw, 95)))
    print("barriers: %d, %.0f m" % (len(walls()), sum(LineString(b["en"]).length for b in walls())))

