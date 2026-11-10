"""Ground: asphalt aprons, grass near the track, photo-textured terrain further out, far terrain, horizon."""
from __future__ import annotations

import os
import sys

import cv2
import numpy as np
import triangle as tri
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import photo  # noqa: E402
from common import HALF_E, HALF_N, META_FAR, WORK, site_uv  # noqa: E402
from textures import TILE_M  # noqa: E402
from track import SHOULDER, Parts, Track, vertex_normals, wind_up  # noqa: E402

MASK_GSD = 0.25
ZONE_M = 40.0        # tiled grass reaches this far from any asphalt
APRON_REACH = 75.0   # aprons are modelled up to this distance from the track
TILE = 90.0          # ground meshes are cut into tiles of this size (m)


def ribbon_polygon(tr: Track) -> Polygon:
    left, right = tr.edge_en(1), tr.edge_en(-1)
    a, b = Polygon(left), Polygon(right)
    outer, inner = (b, a) if b.area > a.area else (a, b)
    p = Polygon(outer.exterior.coords, [inner.exterior.coords])
    assert p.is_valid, "road ribbon overlaps itself"
    return p


def mask_polygons(mask: np.ndarray):
    """Boolean raster (north up, 0.25 m) -> shapely geometry in EN."""
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        return Polygon()

    def en(c):
        c = c.reshape(-1, 2).astype(float)
        return np.column_stack([(c[:, 0] + 0.5) * MASK_GSD - HALF_E, HALF_N - (c[:, 1] + 0.5) * MASK_GSD])

    polys = []
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
            polys.append(p)
    return unary_union(polys)


class Registry:
    """Vertex list without duplicates: a point closer than MERGE to an existing one becomes that one, so two
    outlines that nearly touch share vertices instead of leaving slivers for the triangulator."""
    MERGE = 0.10

    def __init__(self):
        self.pts: list[tuple[float, float]] = []
        self.cell: dict[tuple[int, int], list[int]] = {}
        self.fixed_h: dict[int, float] = {}

    def add(self, p, h=None) -> int:
        cx, cy = int(np.floor(p[0] / self.MERGE)), int(np.floor(p[1] / self.MERGE))
        best, i = self.MERGE, None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in self.cell.get((cx + dx, cy + dy), ()):
                    d = float(np.hypot(self.pts[j][0] - p[0], self.pts[j][1] - p[1]))
                    if d < best:
                        best, i = d, j
        if i is None:
            i = len(self.pts)
            self.cell.setdefault((cx, cy), []).append(i)
            self.pts.append((float(p[0]), float(p[1])))
        if h is not None and i not in self.fixed_h:
            self.fixed_h[i] = float(h)
        return i


def node_segments(pts: np.ndarray, segs: list[tuple[int, int]], tol: float = 0.04) -> np.ndarray:
    """Split every segment at the vertices that lie on it, and drop empty and repeated segments."""
    from shapely import STRtree
    for _ in range(4):
        segs = sorted({(min(a, b), max(a, b)) for a, b in segs if a != b})
        lines = [LineString([pts[a], pts[b]]) for a, b in segs]
        tree = STRtree(lines)
        split: dict[int, list[int]] = {}
        for i, p in enumerate(pts):
            pt = Point(p)
            for j in tree.query(pt.buffer(tol)):
                if i not in segs[j] and lines[j].distance(pt) < tol:
                    split.setdefault(int(j), []).append(i)
        if not split:
            break
        out = []
        for j, (a, b) in enumerate(segs):
            if j not in split:
                out.append((a, b))
                continue
            chain = sorted(set(split[j]), key=lambda i: lines[j].project(Point(pts[i])))
            ids = [a, *chain, b]
            out += list(zip(ids[:-1], ids[1:]))
        segs = out
    return np.array(sorted({(min(a, b), max(a, b)) for a, b in segs if a != b}), np.int32)


def apron_chains(A, R: Polygon, edge_tree: cKDTree, edge_pts: np.ndarray):
    """Apron outline pieces that do not run along the road edge, ends snapped to road edge vertices."""
    rb = R.boundary
    chains = []
    for poly in getattr(A, "geoms", [A]):
        for ring in [poly.exterior, *poly.interiors]:
            xy = np.array(ring.coords)[:-1]
            if len(xy) < 3:
                continue
            from shapely import distance, points
            on = distance(points(xy), rb) < 0.6
            m = len(xy)
            if on.all():
                continue
            start = int(np.argmax(on)) if on.any() else 0
            order = [(start + k) % m for k in range(m + 1)]
            cur = []
            for a, b in zip(order[:-1], order[1:]):
                if on[a] and on[b]:
                    if len(cur) > 1:
                        chains.append(cur)
                    cur = []
                    continue
                pa = edge_pts[edge_tree.query(xy[a])[1]] if on[a] else xy[a]
                pb = edge_pts[edge_tree.query(xy[b])[1]] if on[b] else xy[b]
                if not cur:
                    cur = [pa]
                cur.append(pb)
                if on[b]:
                    chains.append(cur)
                    cur = []
            if len(cur) > 1:
                chains.append(cur)
    return chains


def build_ground(tr: Track, parts: Parts, avoid) -> dict:
    """avoid: shapely geometry of the building footprints (no gravel there)."""
    import design
    R = ribbon_polygon(tr)
    verge = design.verge(tr, R)
    A, aprons, roads, roads_poly, pads = design.other_asphalt(tr, R)
    site = box(-HALF_E, -HALF_N, HALF_E, HALF_N)
    zone = unary_union([R, A]).buffer(ZONE_M).intersection(site.buffer(-6.0))
    zone = unary_union([Polygon(g.exterior) for g in getattr(zone, "geoms", [zone])])   # no photo islands in the infield
    G = design.gravel_traps(tr, R, unary_union([A, avoid]))
    G = unary_union([G, design.gravel_pockets(A)]).buffer(0)
    reg = Registry()
    segs: list[tuple[int, int]] = []
    # 1. road edges: exact vertices and heights of the road mesh
    edge_pts = []
    for side in (1, -1):
        e, h = tr.edge_en(side), tr.edge_h(side)
        ids = [reg.add(p, hh) for p, hh in zip(e, h)]
        segs += [(ids[k], ids[(k + 1) % len(ids)]) for k in range(len(ids))]
        edge_pts.append(e)
    edge_pts = np.vstack(edge_pts)
    edge_tree = cKDTree(edge_pts)
    # 2. apron outlines
    chains = apron_chains(A, R, edge_tree, edge_pts)
    chain_pts = []
    for ch in chains:
        ids = [reg.add(p) for p in ch]
        segs += [(a, b) for a, b in zip(ids[:-1], ids[1:]) if a != b]
        chain_pts += list(ch)
    chain_lines = MultiLineString([LineString(ch) for ch in chains if len(ch) > 1]) if chains else None
    # 2b. seams inside the asphalt, where a road or a concrete pad meets the lighter apron: mesh edges follow them
    road_part = roads_poly.simplify(0.05).intersection(A)
    pad_part = pads.simplify(0.05).difference(roads_poly.simplify(0.05)).intersection(A)
    seams = unary_union([road_part.boundary, pad_part.boundary]).difference(A.boundary.buffer(0.3))
    for ln in getattr(seams, "geoms", [seams]):
        if ln.is_empty or ln.geom_type != "LineString" or ln.length < 1.0:
            continue
        ids = [reg.add(p) for p in ln.segmentize(2.0).coords]
        segs += [(a, b) for a, b in zip(ids[:-1], ids[1:]) if a != b]
        chain_pts += [tuple(p) for p in ln.coords]
    # 3. verge: one row of vertices 1.2 m outside each edge, in the plane of the road
    for side in (1, -1):
        for p, hh in zip(tr.shoulder_en(side), tr.shoulder_h(side)):
            if edge_tree.query(p)[0] > SHOULDER * 0.8 and (chain_lines is None or chain_lines.distance(Point(p)) > 0.3):
                reg.add(p, hh)
    # 3b. gravel trap outlines: closed rings that touch nothing else
    for poly in getattr(G, "geoms", [G]):
        if poly.is_empty:
            continue
        for ring in [poly.exterior, *poly.interiors]:
            k = max(8, int(ring.length / 1.5))
            ids = [reg.add((p.x, p.y)) for p in (ring.interpolate(j / k, normalized=True) for j in range(k))]
            segs += [(ids[j], ids[(j + 1) % k]) for j in range(k) if ids[j] != ids[(j + 1) % k]]
    # 4. site rectangle
    rect = []
    for (x0, y0), (x1, y1) in zip([(-HALF_E, -HALF_N), (HALF_E, -HALF_N), (HALF_E, HALF_N), (-HALF_E, HALF_N)],
                                  [(HALF_E, -HALF_N), (HALF_E, HALF_N), (-HALF_E, HALF_N), (-HALF_E, -HALF_N)]):
        m = int(round(np.hypot(x1 - x0, y1 - y0) / 20.0))
        rect += [(x0 + (x1 - x0) * k / m, y0 + (y1 - y0) * k / m) for k in range(m)]
    rect_ids = [reg.add(p) for p in rect]
    segs += [(rect_ids[k], rect_ids[(k + 1) % len(rect_ids)]) for k in range(len(rect_ids))]
    # 5. scattered interior vertices: 6 m grid near the track, 16 m grid elsewhere
    keep_off = cKDTree(np.array(reg.pts))
    rng = np.random.default_rng(7)
    for step, inside in ((6.0, True), (16.0, False)):
        gx, gy = np.meshgrid(np.arange(-HALF_E + step / 2, HALF_E, step), np.arange(-HALF_N + step / 2, HALF_N, step))
        g = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.2, 0.2, (gx.size, 2)) * step
        in_zone = contains_xy(zone, g[:, 0], g[:, 1])
        g = g[in_zone if inside else ~in_zone]
        g = g[(np.abs(g[:, 0]) < HALF_E - 5) & (np.abs(g[:, 1]) < HALF_N - 5)]
        g = g[keep_off.query(g)[0] > (2.5 if inside else 7.0)]
        g = g[~contains_xy(R.buffer(0.5), g[:, 0], g[:, 1])]
        for p in g:
            reg.add(p)
    data = dict(vertices=np.array(reg.pts), segments=node_segments(np.array(reg.pts), segs), holes=np.array([tr.c[0]]))
    out = tri.triangulate(data, "pq22Y")
    V, T = out["vertices"], out["triangles"]
    assert len(V) >= len(reg.pts) and np.allclose(V[: len(reg.pts)], np.array(reg.pts), atol=1e-6)
    # heights
    Hh = tr.H.ground(V)
    for i, hh in reg.fixed_h.items():
        Hh[i] = hh
    # vertices that the triangulator put on a road edge between two road vertices take the height of that edge
    from shapely import distance, line_locate_point, points
    free = np.array([i for i in range(len(V)) if i not in reg.fixed_h])
    for side in (1, -1):
        e, h = tr.edge_en(side), tr.edge_h(side)
        ring = LineString(np.vstack([e, e[:1]]))
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([e, e[:1]]), axis=0), axis=1))])
        pts = points(V[free])
        on = distance(pts, ring) < 0.003
        Hh[free[on]] = np.interp(line_locate_point(ring, pts[on]), cum, np.concatenate([h, h[:1]]))
    # drop degenerate slivers
    e1, e2 = V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]
    T = T[np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) > 2e-5]
    # classification: flood regions bounded by constrained segments, then vote apron / grass
    cen = V[T].mean(1)
    in_a = contains_xy(A, cen[:, 0], cen[:, 1])
    cons = {tuple(sorted(s)) for s in out["segments"].tolist()}
    edges = {}
    rows, cols = [], []
    for t_i, t in enumerate(T.tolist()):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            key = (a, b) if a < b else (b, a)
            if key in cons:
                continue
            j = edges.pop(key, None)
            if j is None:
                edges[key] = t_i
            else:
                rows.append(t_i), cols.append(j)
    ncomp, lab = connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(T), len(T))), directed=False)
    e1, e2 = V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]
    area = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    frac = np.bincount(lab, area * in_a, ncomp) / np.maximum(np.bincount(lab, area, ncomp), 1e-9)
    apron = np.where((frac[lab] > 0.15) & (frac[lab] < 0.85), in_a, frac[lab] >= 0.5)
    gravel = ~apron & contains_xy(G, cen[:, 0], cen[:, 1]) if not G.is_empty else np.zeros(len(T), bool)
    near = contains_xy(zone, cen[:, 0], cen[:, 1]) & ~apron & ~gravel
    far = ~apron & ~gravel & ~near
    # roads of the circuit carry the same dark asphalt as the lap, paved areas the lighter apron asphalt, pads concrete
    kind = np.where(contains_xy(road_part, cen[:, 0], cen[:, 1]), 0, np.where(contains_xy(pad_part, cen[:, 0], cen[:, 1]), 2, 1))
    # geometry
    pos = tr.fr.world(V, Hh)
    T = wind_up(pos, T)
    nrm = vertex_normals(pos, T)
    tile = np.floor((cen + [HALF_E, HALF_N]) / TILE).astype(int)
    tile_id = tile[:, 0] * 100 + tile[:, 1]
    plan = pos[:, [0, 2]]
    layers = ((apron & (kind == 0), "1APRON_r", "road", plan / TILE_M["road"]), (apron & (kind == 1), "1APRON_a", "apron", plan / TILE_M["apron"]),
              (apron & (kind == 2), "1APRON_c", "pad", plan / TILE_M["pad"]), (gravel, "1SAND_s", "gravel", plan / TILE_M["gravel"]),
              (near, "1GRASS_g", "grass", plan / TILE_M["grass"]), (far, "1GRASS_p", "photo", site_uv(V)))
    for sel, prefix, mat, uv in layers:
        for tid in np.unique(tile_id[sel]):
            t = T[sel & (tile_id == tid)]
            ids, inv = np.unique(t, return_inverse=True)
            parts.add(f"{prefix}{tid:04d}", mat, pos[ids], nrm[ids], uv[ids], inv.reshape(-1, 3), cast_shadows=False)
    # raster of everything that carries tiled textures (the photo is faded into grass next to it)
    covered = np.zeros((int(2 * HALF_N / MASK_GSD), int(2 * HALF_E / MASK_GSD)), np.uint8)
    px = np.stack([(V[:, 0] + HALF_E) / MASK_GSD, (HALF_N - V[:, 1]) / MASK_GSD], -1)
    cv2.fillPoly(covered, [np.round(px[t]).astype(np.int32) for t in T[~far]], 1)
    rr = np.array(R.exterior.coords)
    cv2.fillPoly(covered, [np.round(np.stack([(rr[:, 0] + HALF_E) / MASK_GSD, (HALF_N - rr[:, 1]) / MASK_GSD], -1)).astype(np.int32)], 1)
    info = dict(R=R, A=A, G=G, zone=zone, covered=covered.astype(bool), rect=np.array(rect), rect_h=Hh[rect_ids],
                tris=dict(asphalt=int(apron.sum()), gravel=int(gravel.sum()), grass=int(near.sum()), photo=int(far.sum())), chains=len(chains), roads=roads, aprons=aprons, pads=pads, verge=verge,
                apron_area=float(area[apron].sum()), gravel_area=float(area[gravel].sum()), V=V, T=T,
                cls=np.where(apron, 1, np.where(gravel, 4, np.where(near, 2, 3))))
    return info


def build_far(tr: Track, parts: Parts, info: dict) -> None:
    """Terrain around the site (2.5 x 2 km) from the 4 m DEM, plus a tree line on its rim."""
    fe, fn = META_FAR["half_m"]
    step = 50.0
    gx, gy = np.meshgrid(np.linspace(-fe, fe, int(2 * fe / step) + 1), np.linspace(-fn, fn, int(2 * fn / step) + 1))
    g = np.column_stack([gx.ravel(), gy.ravel()])
    g = g[(np.abs(g[:, 0]) > HALF_E + 12) | (np.abs(g[:, 1]) > HALF_N + 12)]
    rect = info["rect"]
    m = len(rect)
    V0 = np.vstack([rect, g])
    segs = np.array([(k, (k + 1) % m) for k in range(m)], np.int32)
    out = tri.triangulate(dict(vertices=V0, segments=segs, holes=np.array([[0.0, 0.0]])), "pcY")
    V, T = out["vertices"], out["triangles"]
    assert len(V) == len(V0)
    h = tr.H.far_ground(V)
    h[:m] = info["rect_h"]
    pos = tr.fr.world(V, h)
    T = wind_up(pos, T)
    uv = np.column_stack([(V[:, 0] + fe) / (2 * fe), (V[:, 1] + fn) / (2 * fn)])
    parts.add("1GRASS_far", "photofar", pos, vertex_normals(pos, T), uv, T, cast_shadows=False)
    # tree line along the rim
    inset = 15.0
    cx = [(-fe + inset, -fn + inset), (fe - inset, -fn + inset), (fe - inset, fn - inset), (-fe + inset, fn - inset)]
    ring = []
    for (x0, y0), (x1, y1) in zip(cx, cx[1:] + cx[:1]):
        k = int(np.hypot(x1 - x0, y1 - y0) / 50)
        ring += [(x0 + (x1 - x0) * j / k, y0 + (y1 - y0) * j / k) for j in range(k)]
    ring = np.array(ring + ring[:1])
    base = tr.H.far_ground(ring)
    lo, hi = tr.fr.world(ring, base - 4.0), tr.fr.world(ring, base + 38.0)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(ring, axis=0), axis=1))]) / 300.0
    k = len(ring)
    r = np.arange(k - 1)
    tris = np.concatenate([np.stack([r, r + 1, r + k + 1], -1), np.stack([r, r + k + 1, r + k], -1)])
    pos = np.vstack([lo, hi])
    uv = np.vstack([np.column_stack([s, np.full(k, 0.02)]), np.column_stack([s, np.full(k, 0.98)])])
    up = np.tile([0.0, 1.0, 0.0], (len(pos), 1))
    parts.add("HORIZON_trees", "forest", pos, up, uv, np.vstack([tris, tris[:, ::-1]]), cast_shadows=False)


if __name__ == "__main__":
    import time
    t0 = time.time()
    tr = Track()
    p = Parts()
    info = build_ground(tr, p)
    build_far(tr, p, info)
    ms = p.meshes()
    print("%.1fs" % (time.time() - t0), len(ms), "meshes", sum(len(m.pos) for m in ms), "verts", info["tris"], "chains", info["chains"],
          "apron area %.0f m2" % info["apron_area"])
    # debug picture of the classification, north up, 2 px per metre
    S = 2.0
    im = np.zeros((int(2 * HALF_N * S), int(2 * HALF_E * S), 3), np.uint8)
    V, T, cls = info["V"], info["T"], info["cls"]
    px = np.stack([(V[:, 0] + HALF_E) * S, (HALF_N - V[:, 1]) * S], -1)
    for c, col in ((1, (120, 120, 125)), (2, (70, 140, 60)), (3, (40, 80, 40)), (4, (200, 190, 150))):
        cv2.fillPoly(im, [np.round(px[t]).astype(np.int32) for t in T[cls == c]], col)
    cv2.polylines(im, [np.round(px[t]).astype(np.int32) for t in T], True, (20, 30, 20), 1)
    for side, col in ((1, (0, 220, 255)), (-1, (255, 220, 0))):
        e = tr.edge_en(side)
        cv2.polylines(im, [np.round(np.stack([(e[:, 0] + HALF_E) * S, (HALF_N - e[:, 1]) * S], -1)).astype(np.int32)], True, col, 1)
    cv2.imwrite(os.path.join(WORK, "ground_debug.png"), im)
