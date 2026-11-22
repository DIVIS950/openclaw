"""Objects standing on the ground: buildings, pit wall, tyre barriers and trees, placed from the survey."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely import contains_xy
from shapely.geometry import Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HALF_E, HALF_N, META_FAR, SRC, WORK, site_uv  # noqa: E402
from track import Parts, Track  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
UP = np.array([0.0, 1.0, 0.0])
WALL_MATERIAL = {"garage": "garage", "building": "building", "hall": "hall", "hut": "hut"}


def box(parts: Parts, group: str, material: str, corners_xz: np.ndarray, y0: float, y1: float, uv_scale=(8.0, 4.0),
        top_material: str | None = None, top_uv: np.ndarray | float = 6.0, top: bool = True, **kw) -> None:
    """Extruded footprint (convex, any winding) with walls and a flat top (top=False: walls only)."""
    c = np.asarray(corners_xz, float)
    centre = c.mean(0)
    perim = 0.0
    for a, b in zip(c, np.roll(c, -1, axis=0)):
        ln = float(np.linalg.norm(b - a))
        p = np.array([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])])
        mid = (a + b) / 2 - centre
        reps = max(1.0, round(ln / uv_scale[0]))                      # whole tiles per wall so doors are not cut
        parts.quad(group, material, p, (perim, 0.0, perim + reps, (y1 - y0) / uv_scale[1]),
                   hint=(mid[0], 0.0, mid[1]), smooth=False, **kw)
        perim += reps
    if not top:
        return
    top = np.array([(p[0], y1, p[1]) for p in c])
    tris = [(0, k, k + 1) for k in range(1, len(c) - 1)]
    uv = c / top_uv if np.isscalar(top_uv) else np.asarray(top_uv, float)
    parts.surface(group, top_material or material, top, uv, tris, hint=UP, smooth=False, **kw)


def build_buildings(tr: Track, parts: Parts) -> list[Polygon]:
    """Walls by type; every roof shows its own piece of the aerial photo. The roof has the shape that the laser-scanned
    surface model shows (mkbuildings.roof_shape): flat, single-pitch or gable."""
    foot = []
    blds = json.load(open(os.path.join(SRC, "buildings.json"), encoding="utf-8"))
    for k, b in enumerate(blds):
        en = np.array(b["en"])
        gnd = tr.H.ground(en) - tr.fr.ref
        base = float(gnd.min())
        roof = b.get("roof", dict(type="flat"))
        group, mat = f"1WALL_bld{k:02d}", WALL_MATERIAL[b["style"]]
        vs = (min(b["height"], 4.0) if b["style"] == "garage" else 4.0) if b["height"] < 5.0 else b["height"] / max(1, round(b["height"] / 4.0))
        foot.append(Polygon(en))
        if roof["type"] == "flat":
            sides = np.linalg.norm(np.roll(en, -1, axis=0) - en, axis=1)
            if b["height"] < 3.4 or sides.min() < 6.0 or len(en) != 4:
                box(parts, group, mat, tr.fr.xz(en), base - 0.5, base + b["height"], uv_scale=(8.0, vs), top_material="roofphoto", top_uv=site_uv(en))
                continue
            # a flat roof lies behind a parapet: the walls rise 35 cm above it
            PAR, TH = 0.35, 0.30
            xz, ytop = tr.fr.xz(en), base + b["height"]
            box(parts, group, mat, xz, base - 0.5, ytop + PAR, uv_scale=(8.0, vs), top=False)
            c_en = en.mean(0)
            pull = (c_en - en) / np.linalg.norm(c_en - en, axis=1, keepdims=True) * TH * 1.4
            en_in = en + pull
            xz_in = tr.fr.xz(en_in)
            parts.surface(group, "roofphoto", np.array([(p[0], ytop, p[1]) for p in xz_in]), site_uv(en_in), [(0, 1, 2), (0, 2, 3)], hint=UP, smooth=False)
            cen = xz.mean(0)
            for i in range(4):
                j_ = (i + 1) % 4
                rim = [(xz[i][0], ytop + PAR, xz[i][1]), (xz[j_][0], ytop + PAR, xz[j_][1]), (xz_in[j_][0], ytop + PAR, xz_in[j_][1]), (xz_in[i][0], ytop + PAR, xz_in[i][1])]
                parts.quad(group, "concrete", rim, (0.0, 0.0, sides[i] / 3.0, 0.1), hint=UP, smooth=False)
                inward = cen - (xz_in[i] + xz_in[j_]) / 2
                face = [(xz_in[i][0], ytop, xz_in[i][1]), (xz_in[j_][0], ytop, xz_in[j_][1]), (xz_in[j_][0], ytop + PAR, xz_in[j_][1]), (xz_in[i][0], ytop + PAR, xz_in[i][1])]
                parts.quad(group, "concrete", face, (0.0, 0.0, sides[i] / 3.0, 0.12), hint=(inward[0], 0.0, inward[1]), smooth=False)
            continue
        xz, y0 = tr.fr.xz(en), base - 0.5
        top = base + np.array(roof["corner_h"], float)                 # height of the eave at each corner
        centre = xz.mean(0)
        ridge = np.array(roof["ridge_en"], float) if "ridge_en" in roof else None
        r_xz, r_y = (tr.fr.xz(ridge), base + roof["ridge_h"]) if ridge is not None else (None, None)
        perim = 0.0
        for i in range(4):
            j_ = (i + 1) % 4
            a, c_, ya, yb = xz[i], xz[j_], top[i], top[j_]
            ln = float(np.linalg.norm(c_ - a))
            reps = max(1.0, round(ln / 8.0))
            out = (a + c_) / 2 - centre
            pos = [(a[0], y0, a[1]), (c_[0], y0, c_[1]), (c_[0], yb, c_[1]), (a[0], ya, a[1])]
            uv = [(perim, 0.0), (perim + reps, 0.0), (perim + reps, (yb - y0) / vs), (perim, (ya - y0) / vs)]
            tris = [(0, 1, 2), (0, 2, 3)]
            if ridge is not None:
                mid_en = (en[i] + en[j_]) / 2
                e_ = int(np.argmin(np.linalg.norm(ridge - mid_en, axis=1)))
                if np.linalg.norm(ridge[e_] - mid_en) < 0.6:               # a gable end: the wall runs up to the ridge
                    pos.append((r_xz[e_][0], r_y, r_xz[e_][1]))
                    uv.append((perim + reps / 2, (r_y - y0) / vs))
                    tris.append((3, 2, 4))
                else:                                                       # a long side: one plane of the roof above it
                    ra, rb = (0, 1) if np.linalg.norm(ridge[0] - en[i]) < np.linalg.norm(ridge[1] - en[i]) else (1, 0)
                    rp = np.array([(a[0], ya, a[1]), (c_[0], yb, c_[1]), (r_xz[rb][0], r_y, r_xz[rb][1]), (r_xz[ra][0], r_y, r_xz[ra][1])])
                    parts.surface(group, "roofphoto", rp, site_uv(np.array([en[i], en[j_], ridge[rb], ridge[ra]])), [(0, 1, 2), (0, 2, 3)], hint=UP, smooth=False)
            parts.surface(group, mat, np.array(pos), np.array(uv), tris, hint=(out[0], 0.0, out[1]), smooth=False)
            perim += reps
        if ridge is None:                                                   # single pitch: one sloping plane
            rp = np.array([(xz[i][0], top[i], xz[i][1]) for i in range(4)])
            parts.surface(group, "roofphoto", rp, site_uv(en), [(0, 1, 2), (0, 2, 3)], hint=UP, smooth=False)
    return foot


def build_banners(tr: Track, parts: Parts, walls: list[dict], asphalt) -> dict:
    """Advertising boards in front of the tyre walls, on the side that faces the lap, as on the real circuit: boards
    of 3 m by 0.95 m on two legs, about two out of three places taken. For the eye only."""
    from shapely.geometry import LineString, Point
    rng = np.random.default_rng(23)
    lap = LineString(np.vstack([tr.c, tr.c[:1]]))
    PANEL, H_, GAP = 3.0, 0.95, 0.15
    count = 0
    for wall in walls:
        q = np.asarray(wall["en"], float)
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))])
        if cum[-1] < 9.0:
            continue
        half = wall.get("width", 1.3) / 2 + 0.22
        for s0 in np.arange(0.4, cum[-1] - PANEL - 0.3, PANEL + GAP):
            if rng.random() > 0.66:
                continue
            a = np.array([np.interp(s0, cum, q[:, 0]), np.interp(s0, cum, q[:, 1])])
            b = np.array([np.interp(s0 + PANEL, cum, q[:, 0]), np.interp(s0 + PANEL, cum, q[:, 1])])
            d = (b - a) / max(np.linalg.norm(b - a), 1e-9)
            n = np.array([-d[1], d[0]])
            mid = (a + b) / 2
            if lap.distance(Point(mid + n)) > lap.distance(Point(mid - n)):
                n = -n                                                 # towards the lap
            if lap.distance(Point(mid)) > 30.0:
                continue                                               # nobody on the lap would see it
            a, b = a + n * half, b + n * half
            if asphalt.buffer(0.3).intersects(LineString([a, b])):
                continue
            g = tr.H.ground(np.array([a, b])) - tr.fr.ref
            xa, xb = tr.fr.xz(np.array([a, b]))
            k = int(rng.integers(0, 6))
            y0 = float(g.max()) + 0.12
            quad = [(xa[0], y0, xa[1]), (xb[0], y0, xb[1]), (xb[0], y0 + H_, xb[1]), (xa[0], y0 + H_, xa[1])]
            nn = tr.fr.vec(n[None, :])[0]
            flip = np.cross(np.array([xb[0] - xa[0], 0.0, xb[1] - xa[1]]), UP) @ np.array([nn[0], 0.0, nn[1]]) < 0
            u0, u1 = (k / 6.0, (k + 1) / 6.0) if not flip else ((k + 1) / 6.0, k / 6.0)       # readable from the lap
            parts.quad("BANNER_boards", "banner", quad, (u0, 0.0, u1, 1.0), hint=(nn[0], 0.0, nn[1]), smooth=False, cast_shadows=True)
            back = [quad[1], quad[0], quad[3], quad[2]]
            parts.quad("BANNER_boards", "concrete", back, (0.0, 0.0, 1.0, 0.3), hint=(-nn[0], 0.0, -nn[1]), smooth=False)
            for p_, gy in ((xa, g[0]), (xb, g[1])):                    # two legs
                dd = tr.fr.vec(d[None, :])[0] * 0.03
                leg = [(p_[0] - dd[0], gy - 0.1, p_[1] - dd[1]), (p_[0] + dd[0], gy - 0.1, p_[1] + dd[1]), (p_[0] + dd[0], y0, p_[1] + dd[1]), (p_[0] - dd[0], y0, p_[1] - dd[1])]
                parts.quad("BANNER_boards", "metal", leg, (0, 0, 1, 1), hint=(nn[0], 0.0, nn[1]), smooth=False, double_sided=True)
            count += 1
    return dict(banners=count)


def build_viaduct(tr: Track, parts: Parts) -> dict:
    """The motorway viaduct in the north-west corner of the site, 60 m behind the west loop. The laser-scanned surface
    model shows its deck: about 15 m wide and 8 to 11 m above the ground. Position, width and height are read from
    the model row by row and smoothed; the deck carries its piece of the aerial photo."""
    from PIL import Image
    sv = np.load(os.path.join(WORK, "survey.npz"))
    ndsm = sv["ndsm"]
    dsm = np.asarray(Image.open(os.path.join(SRC, "cuzk", "dsm.tif")), np.float64)
    rows = []
    for north in np.arange(138.0, HALF_N - 1.0, 2.0):
        r = int((HALF_N - north) / 0.5)
        on = np.where(ndsm[r, :160] > 1.5)[0]
        if len(on) == 0:
            continue
        for run in np.split(on, np.where(np.diff(on) > 2)[0] + 1):
            w = (run[-1] - run[0]) * 0.5
            if 9.0 <= w <= 21.0:
                rows.append((north, (run[0] + run[-1]) * 0.25 - HALF_E, w, float(np.median(dsm[r, run]))))
    rows = np.array(rows)
    if len(rows) < 20:
        return dict(viaduct_m=0)
    keep = np.ones(len(rows), bool)
    for _ in range(4):                                                  # the deck is the long, nearly straight run
        line = np.polyfit(rows[keep, 0], rows[keep, 1], 2)
        keep = np.abs(rows[:, 1] - np.polyval(line, rows[:, 0])) < 5.0
    rows = rows[keep]
    north = np.arange(rows[:, 0].min(), rows[:, 0].max() + 0.1, 4.0)
    east = np.polyval(np.polyfit(rows[:, 0], rows[:, 1], 2), north)
    width = float(np.median(rows[:, 2]))
    top = np.polyval(np.polyfit(rows[:, 0], rows[:, 3], 2), north)
    c = np.column_stack([east, north])
    d = np.gradient(c, axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    nrm = np.column_stack([-d[:, 1], d[:, 0]])
    left, right = c + nrm * width / 2, c - nrm * width / 2
    m = len(c)
    r = np.arange(m - 1)
    quads = np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)])
    DEPTH = 1.5
    s_ = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])
    parts.surface("SCENE_viaduct", "roofphoto", np.vstack([tr.fr.world(left, top), tr.fr.world(right, top)]), np.vstack([site_uv(left), site_uv(right)]), quads, hint=UP, cast_shadows=True)
    parts.surface("SCENE_viaduct", "concrete", np.vstack([tr.fr.world(left, top - DEPTH), tr.fr.world(right, top - DEPTH)]),
                  np.vstack([np.column_stack([s_ / 4, np.zeros(m)]), np.column_stack([s_ / 4, np.full(m, width / 4)])]), quads, hint=-UP)
    for edge, sign in ((left, 1.0), (right, -1.0)):                      # the two faces of the deck
        o = tr.fr.vec(nrm * sign)
        hint = np.column_stack([o[:, 0], np.zeros(m), o[:, 1]])
        parts.surface("SCENE_viaduct", "concrete", np.vstack([tr.fr.world(edge, top - DEPTH), tr.fr.world(edge, top + 0.9)]),
                      np.vstack([np.column_stack([s_ / 4, np.zeros(m)]), np.column_stack([s_ / 4, np.full(m, 0.6)])]), quads,
                      hint=np.vstack([hint[:-1], hint[:-1]]), smooth=False)
    for e_ in (0, m - 1):                                               # an abutment wall closes each end of the deck
        g_ = float(tr.H.ground(c[e_][None, :])[0])
        lo = np.array([tr.fr.world(left[e_][None], np.array([g_ - 0.5]))[0], tr.fr.world(right[e_][None], np.array([g_ - 0.5]))[0]])
        hi = np.array([tr.fr.world(right[e_][None], np.array([top[e_] + 0.9]))[0], tr.fr.world(left[e_][None], np.array([top[e_] + 0.9]))[0]])
        out_ = tr.fr.vec((d[e_] * (-1.0 if e_ == 0 else 1.0))[None, :])[0]
        parts.quad("SCENE_viaduct", "concrete", [lo[0], lo[1], hi[0], hi[1]], (0.0, 0.0, width / 4, (top[e_] - g_) / 4), hint=(out_[0], 0.0, out_[1]), smooth=False)
    piers = 0
    for k in range(2, m - 1, 8):                                         # a pier every 32 m
        ax, ay = d[k] * 0.9, nrm[k] * (width / 2 - 2.5)
        corners = np.array([c[k] - ax - ay, c[k] + ax - ay, c[k] + ax + ay, c[k] - ax + ay])
        g = float(tr.H.ground(corners).min()) - tr.fr.ref
        if top[k] - tr.fr.ref - DEPTH - g > 1.0:
            box(parts, "SCENE_viaduct_piers", "concrete", tr.fr.xz(corners), g - 0.5, float(top[k]) - tr.fr.ref - DEPTH, uv_scale=(4.0, 4.0), top_uv=4.0)
            piers += 1
    return dict(viaduct_m=int(round(s_[-1])), viaduct_width_m=round(width, 1), viaduct_piers=piers,
                viaduct_above_ground_m=round(float(np.max(top - tr.H.ground(c))), 1))


PIT_WALL_END = 92.0   # the pit wall stops here (metres along the pit line): beyond it the road out to the pits leaves the track


def pit_wall_line(tr: Track) -> np.ndarray:
    """The low concrete wall between the start straight and the pit buildings: 1.1 m outside the real asphalt edge
    (east/north points)."""
    from scipy.ndimage import gaussian_filter1d
    st = np.arange(int(round(tr.pit_station(-6.0))), int(round(tr.pit_station(PIT_WALL_END))), 2)
    w = gaussian_filter1d(np.tile(tr.wr, 3), 6.0)[tr.n + st]
    return tr.en(st.astype(float), -(w + 1.1))


def build_tyre_walls(tr: Track, parts: Parts, keep_clear, asphalt, lines: list | None = None, min_len: float = 6.0, anywhere: bool = False) -> dict:
    """Tyre barriers traced from the photo (work/tyre_walls.json; hand-made additions in source/features.json)."""
    given = lines
    lines = list(given) if given is not None else []
    for path in (() if given is not None else (os.path.join(WORK, "tyre_walls.json"), os.path.join(SRC, "features.json"))):
        if os.path.exists(path):
            lines += json.load(open(path, encoding="utf-8")).get("tyre_walls", [])
    venue = keep_clear.buffer(35.0)                                   # the circuit itself, not the yards and woods around it
    off = unary_union([keep_clear, asphalt.buffer(0.8)])
    pieces = []
    for line in lines:                                                # never a wall on the racing surface or across a road
        p = np.array(line["en"], float)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m = max(2, int(round(s[-1] / 0.65)) + 1)
        q = np.column_stack([np.interp(np.linspace(0, s[-1], m), s, p[:, 0]), np.interp(np.linspace(0, s[-1], m), s, p[:, 1])])
        # a concrete wall stands where it stands, also at the edge of asphalt: it only keeps off the lap itself
        clear = keep_clear if line.get("material") == "concrete" else off
        ok = np.ones(len(q), bool) if anywhere else ~contains_xy(clear, q[:, 0], q[:, 1]) & contains_xy(venue, q[:, 0], q[:, 1])
        dd = np.diff(np.concatenate([[0], ok.astype(int), [0]]))
        for a0, a1 in zip(np.where(dd == 1)[0], np.where(dd == -1)[0]):
            if (a1 - a0) * 0.65 >= min_len:
                pieces.append((line, q[a0:a1]))
    count, length = 0, 0.0
    by_kind: dict[str, float] = {}
    stacks_q, stacks_w, bag_q = [], [], []
    for k, (line, q) in enumerate(pieces):
        if line.get("material") == "bags":                            # soft bags are single bodies, not one long block
            bag_q.append(q)
            count, length = count + 1, length + float(np.linalg.norm(np.diff(q, axis=0), axis=1).sum())
            continue
        m = len(q)
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))])
        mat = line.get("material", "softwall")
        tyre_wall = mat == "tyres"
        if tyre_wall:                         # round stacks are what you see; a plain dark core inside them is what a car hits
            stacks_q.append(q), stacks_w.append(line.get("width", 1.3))
            mat = "tyredark"
        d = np.gradient(q, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        nrm = np.column_stack([-d[:, 1], d[:, 0]])
        half, h = line.get("width", 0.7) / 2, line.get("height", 0.9)
        if tyre_wall:
            half, h = max(0.2, half - 0.14), 0.74
        g = tr.H.ground(q)
        u = np.linspace(0, s[-1], m) / 4.0
        name = f"1WALL_barrier{k // 8:02d}" if mat == "softwall" else f"1WALL_wall{k // 8:02d}"
        left, right = q + nrm * half, q - nrm * half
        faces = ((left, g - 0.2, left, g + h, nrm, 0.0, 1.0), (left, g + h, right, g + h, None, 0.86, 1.0), (right, g + h, right, g - 0.2, -nrm, 1.0, 0.0))
        for a_en, a_h, b_en, b_h, out, va, vb in faces:
            pos = np.vstack([tr.fr.world(a_en, a_h), tr.fr.world(b_en, b_h)])
            uv = np.vstack([np.column_stack([u, np.full(m, va)]), np.column_stack([u, np.full(m, vb)])])
            r = np.arange(m - 1)
            tris = np.concatenate([np.stack([r, r + m, r + m + 1], -1), np.stack([r, r + m + 1, r + 1], -1)])
            if out is None:
                hint = UP
            else:
                o = tr.fr.vec(out)
                o3 = np.column_stack([o[:, 0], np.zeros(m), o[:, 1]])
                hint = np.vstack([o3[:-1], o3[:-1]])
            parts.surface(name, mat, pos, uv, tris, hint=hint, smooth=False)
        for e in (0, -1):                                             # close the ends
            a, b = tr.fr.world(left[e][None], g[e] - 0.2)[0], tr.fr.world(right[e][None], g[e] - 0.2)[0]
            dd = tr.fr.vec(d[e][None])[0] * (-1 if e == 0 else 1)
            parts.quad(name, mat, [a, b, b + UP * (h + 0.2), a + UP * (h + 0.2)], (0.02, 0, 0.2, 1), hint=(dd[0], 0.0, dd[1]), smooth=False)
        count, length = count + 1, length + float(s[-1])
        by_kind[mat] = by_kind.get(mat, 0.0) + float(s[-1])
    out = dict(walls=count, metres=round(length), tyre_wall_m=round(by_kind.get("tyredark", 0.0)), concrete_wall_m=round(by_kind.get("concrete", 0.0)))
    if stacks_q:
        import solid
        out.update(solid.build_tyre_stacks(tr, parts, stacks_q, stacks_w))
    if bag_q:
        import solid
        out.update(solid.build_bags(tr, parts, bag_q))
    return out


def _billboards(parts: Parts, group: str, material: str, cells: list[dict], pos: np.ndarray, height: np.ndarray, rng, planes: int = 2):
    """Crossed, double-sided pictures of a real tree per tree; normals point up so both sides are lit alike.
    Near the track there are three of them, 60 degrees apart, around a solid body (solid.build_trees)."""
    m = len(pos)
    if m == 0:
        return np.zeros(0)
    pick = rng.integers(0, len(cells), m)
    u0 = np.array([c["u0"] for c in cells])[pick] + 0.003
    u1 = np.array([c["u1"] for c in cells])[pick] - 0.003
    width = height * np.array([c["aspect"] for c in cells])[pick]
    yaw = rng.uniform(0, np.pi, m)
    P, U, T = [], [], []
    for k, cross in enumerate(np.arange(planes) * np.pi / planes):
        dx, dz = np.cos(yaw + cross) * width * 0.5, np.sin(yaw + cross) * width * 0.5
        a = pos + np.column_stack([-dx, np.full(m, -0.25), -dz])
        b = pos + np.column_stack([dx, np.full(m, -0.25), dz])
        quad = np.stack([a, b, b + UP * height[:, None], a + UP * height[:, None]], 1)
        ua, ub = (u0, u1) if k % 2 == 0 else (u1, u0)                # every other picture is mirrored
        uv = np.stack([np.column_stack([ua, np.full(m, 0.004)]), np.column_stack([ub, np.full(m, 0.004)]),
                       np.column_stack([ub, np.full(m, 0.996)]), np.column_stack([ua, np.full(m, 0.996)])], 1)
        base = len(P) * 4 * m + np.arange(m)[:, None] * 4
        P.append(quad.reshape(-1, 3)), U.append(uv.reshape(-1, 2))
        T.append(np.concatenate([base + [0, 1, 2], base + [0, 2, 3], base + [2, 1, 0], base + [3, 2, 0]]))
    P, U, T = np.vstack(P), np.vstack(U), np.vstack(T)
    cen = P[T].mean(1)
    order = np.lexsort((np.floor(cen[:, 2] / 120), np.floor(cen[:, 0] / 120)))
    parts.add(group, material, P, np.tile(UP, (len(P), 1)), U, T[order], cast_shadows=True)
    return width


def build_trees(tr: Track, parts: Parts, keep_out) -> dict:
    """Trees where the surface model shows canopy, at the height it measured. keep_out: shapely geometry in EN."""
    rng = np.random.default_rng(5)
    canopy = np.load(os.path.join(WORK, "survey.npz"))["canopy"]
    top = ndi.maximum_filter(canopy, size=17)                         # tallest canopy within 2 m
    step = 5.0
    gx, gy = np.meshgrid(np.arange(-HALF_E + 3, HALF_E - 3, step), np.arange(-HALF_N + 3, HALF_N - 3, step))
    g = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.4, 0.4, (gx.size, 2)) * step
    px = np.clip(((g[:, 0] + HALF_E) / 0.25).astype(int), 0, canopy.shape[1] - 1)
    py = np.clip(((HALF_N - g[:, 1]) / 0.25).astype(int), 0, canopy.shape[0] - 1)
    ok = (canopy[py, px] > 3.0) & ~contains_xy(keep_out, g[:, 0], g[:, 1])
    g, h = g[ok], np.clip(top[py, px][ok] * rng.uniform(0.95, 1.08, ok.sum()), 4.0, 30.0)
    cells = json.load(open(os.path.join(SRC, "assets", "trees.json"), encoding="utf-8"))
    pos = tr.fr.world(g, tr.H.ground(g))
    low = h < 9.0                                                     # low canopy is broadleaf scrub, the rest conifers
    wc = _billboards(parts, "TREES_conifer", "treeconifer", cells["conifer"], pos[~low], h[~low], rng, planes=3)
    wl = _billboards(parts, "TREES_leaf", "treeleaf", cells["leaf"], pos[low], h[low], rng, planes=3)
    import solid                                                      # a trunk and a body with volume inside the pictures
    solid3d = solid.build_trees(parts, np.vstack([pos[~low], pos[low]]), np.concatenate([h[~low], h[low]]),
                                np.concatenate([np.ones((~low).sum(), bool), np.zeros(low.sum(), bool)]), np.concatenate([wc, wl]), rng)
    # forests around the site, from the wide photo (1 m/px)
    far = np.asarray(Image.open(os.path.join(SRC, "cuzk_far", "ortho.png")).convert("RGB"), np.float32) / 255.0
    far = ndi.uniform_filter(far, size=(3, 3, 1))
    r_, g_, b_ = far[..., 0], far[..., 1], far[..., 2]
    fmask = (g_ > b_ + 0.015) & (g_ >= r_ - 0.02) & (far.mean(-1) < 0.42)
    fmask = ndi.binary_opening(fmask, iterations=3)
    fdepth = ndi.distance_transform_edt(fmask)
    fe, fn = META_FAR["half_m"]
    step = 13.0
    gx, gy = np.meshgrid(np.arange(-fe + 20, fe - 20, step), np.arange(-fn + 20, fn - 20, step))
    f = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.4, 0.4, (gx.size, 2)) * step
    f = f[((np.abs(f[:, 0]) > HALF_E - 3) | (np.abs(f[:, 1]) > HALF_N - 3)) & (np.hypot(f[:, 0], f[:, 1]) < 760)]
    px = np.clip((f[:, 0] + fe).astype(int), 0, fmask.shape[1] - 1)
    py = np.clip((fn - f[:, 1]).astype(int), 0, fmask.shape[0] - 1)
    f = f[fdepth[py, px] > 3.0]
    fh = rng.uniform(17, 25, len(f))
    fpos = tr.fr.world(f, tr.H.far_ground(f))
    _billboards(parts, "TREES_far", "treeconifer", cells["conifer"], fpos, fh, rng)
    return dict(near=len(g), far=len(f), **solid3d)


# power pylons standing in the infield north of the bridge, read from the photo: (east, north, height m)
PYLONS = [(-17.0, 108.0, 31.0), (-16.0, 127.0, 32.0), (-16.0, 147.0, 32.0)]


def build_pylons(tr: Track, parts: Parts) -> int:
    for k, (e, n, h) in enumerate(PYLONS):
        en = np.array([[e, n]])
        import solid
        solid.build_pylon(tr, parts, e, n, h)
    return len(PYLONS)


GANTRY_AT = 20.0      # metres after the start line, so every car on the grid sees the lights


def build_gantry(tr: Track, parts: Parts) -> None:
    """Start lights over the road, facing the grid. They hang from an arm on one mast on the pit-wall side (the
    driver's right), so nothing solid stands on the pit apron between the pit boxes and the start straight."""
    st = GANTRY_AT
    wl, wr = float(tr.interp(tr.wl, np.array([st]))[0]), float(tr.interp(tr.wr, np.array([st]))[0])
    right = tr.world(st, -(wr + 1.0))[0]
    road = tr.world(st, 0.0)[0]
    cx = (wl - wr) / 2                                                  # the lights hang over the middle of the road
    p = right
    c = np.array([(p[0] - 0.18, p[2] - 0.18), (p[0] + 0.18, p[2] - 0.18), (p[0] + 0.18, p[2] + 0.18), (p[0] - 0.18, p[2] + 0.18)])
    box(parts, "1WALL_gantry", "metal", c, p[1] - 0.4, road[1] + 6.25, uv_scale=(2.0, 2.0), top_uv=2.0)
    beam = np.array([(right[0], right[2] - 0.15), (cx + 2.9, right[2] - 0.15), (cx + 2.9, right[2] + 0.15), (right[0], right[2] + 0.15)])
    box(parts, "GANTRY_beam", "metal", beam, road[1] + 5.6, road[1] + 6.1, uv_scale=(2.0, 2.0), top_uv=2.0)
    z = road[2] - 0.2
    p = [(cx + 2.4, road[1] + 4.4, z), (cx - 2.4, road[1] + 4.4, z), (cx - 2.4, road[1] + 5.6, z), (cx + 2.4, road[1] + 5.6, z)]    # seen from the grid
    parts.quad("GANTRY_lights", "lights", p, (0.0, 0.0, 1.0, 1.0), hint=(0, 0, -1), smooth=False)
    back = [(q[0], q[1], q[2] + 0.1) for q in (p[1], p[0], p[3], p[2])]
    parts.quad("GANTRY_lights", "metal", back, (0, 0, 1, 1), hint=(0, 0, 1), smooth=False)


def build_brake_boards(tr: Track, parts: Parts) -> int:
    """150 / 100 / 50 m boards before the hard braking zones, on the side that has a verge."""
    from track import cyclic_runs, speed_profile
    n = tr.n
    v = speed_profile(tr.k)
    count = 0
    for a, ln in cyclic_runs(np.roll(v, -1) < v - 0.05, 25, 3):
        end = a + ln
        if v[a % n] - v[end % n] < 11.0:
            continue
        for dist, cell in ((150, 0), (100, 1), (50, 2)):
            if dist > ln + 60:
                continue
            st = end - dist
            i = int(st) % n
            side = -1 if not tr.open_r[i] else (1 if not tr.open_l[i] else 0)
            if side == 0:
                continue
            w = (tr.wl if side > 0 else tr.wr)[i]
            base = tr.world(float(st), side * (w + 2.2))[0]
            t = tr.fr.vec(tr.tan[i][None, :])[0]
            f = np.array([-t[0], 0.0, -t[1]])                                    # faces the cars
            right = -np.cross(f, UP)
            a_, b_ = base - right * 0.45, base + right * 0.45
            p = np.array([a_ + UP * 0.9, b_ + UP * 0.9, b_ + UP * 1.8, a_ + UP * 1.8])
            parts.quad("SIGN_brake", "boards", p + f * 0.02, (cell / 3 + 0.004, 0.0, (cell + 1) / 3 - 0.004, 1.0), hint=f, smooth=False)
            parts.quad("SIGN_brake", "metal", p[[1, 0, 3, 2]] - f * 0.02, (0, 0, 1, 1), hint=-f, smooth=False)
            for q in (a_ + right * 0.1, b_ - right * 0.1):
                c = np.array([(q[0] - 0.03, q[2] - 0.03), (q[0] + 0.03, q[2] - 0.03), (q[0] + 0.03, q[2] + 0.03), (q[0] - 0.03, q[2] + 0.03)])
                box(parts, "SIGN_brake", "metal", c, base[1] - 0.3, base[1] + 0.9, uv_scale=(1.0, 1.0), top_uv=1.0)
            count += 1
    return count


# The race equipment (tyre stacks at the dots, bags, tape, plastic barriers, posts, arrow boards, cones) is in racekit.py
from racekit import build_cones, build_tape, build_tyre_stacks, race_barrier_lines, race_rows  # noqa: E402,F401


def build_fences(tr: Track, parts: Parts, lines: list) -> dict:
    """Wire mesh fences on top of the walls, as around the real paddock and pits (for the eye only).
    lines: [(east/north polyline, height of the wall under it)]."""
    P, U, T, HN, off, total = [], [], [], [], 0, 0.0
    for en, base_h in lines:
        en = np.asarray(en, float)
        seg = np.linalg.norm(np.diff(en, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m = max(2, int(s[-1] / 2.5) + 1)
        q = np.column_stack([np.interp(np.linspace(0, s[-1], m), s, en[:, 0]), np.interp(np.linspace(0, s[-1], m), s, en[:, 1])])
        g = tr.H.ground(q)
        pos = np.vstack([tr.fr.world(q, g + base_h), tr.fr.world(q, g + base_h + 1.7)])
        u = np.linspace(0, s[-1], m) / 2.5
        P.append(pos)
        U.append(np.vstack([np.column_stack([u, np.zeros(m)]), np.column_stack([u, np.ones(m)])]))
        r = np.arange(m - 1)
        T.append(np.concatenate([np.stack([r, r + 1, r + m + 1], -1), np.stack([r, r + m + 1, r + m], -1)]) + off)
        d = np.gradient(q, axis=0)
        nrm = tr.fr.vec(np.column_stack([-d[:, 1], d[:, 0]]) / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9))
        HN.append(np.tile(np.column_stack([nrm[:-1, 0], np.zeros(m - 1), nrm[:-1, 1]]), (2, 1)))
        off += 2 * m
        total += float(s[-1])
    if P:
        parts.surface("FENCE_walls", "fence", np.vstack(P), np.vstack(U), np.vstack(T), hint=np.vstack(HN), smooth=False, double_sided=True, cast_shadows=False)
    posts = 0
    for en, base_h in lines:                                           # a steel post every 2.5 m
        en = np.asarray(en, float)
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(en, axis=0), axis=1))])
        m = max(2, int(s[-1] / 2.5) + 1)
        q = np.column_stack([np.interp(np.linspace(0, s[-1], m), s, en[:, 0]), np.interp(np.linspace(0, s[-1], m), s, en[:, 1])])
        g = tr.H.ground(q) - tr.fr.ref
        for (x, z), y in zip(tr.fr.xz(q), g):
            c = np.array([(x - 0.04, z - 0.04), (x + 0.04, z - 0.04), (x + 0.04, z + 0.04), (x - 0.04, z + 0.04)])
            box(parts, "FENCE_posts", "metal", c, y + base_h - 0.1, y + base_h + 1.78, uv_scale=(1.0, 1.0), top_uv=1.0)
            posts += 1
    return dict(fence_m=round(total), fence_posts=posts)
