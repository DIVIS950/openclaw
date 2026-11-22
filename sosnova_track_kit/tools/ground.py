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
            on = distance(points(xy), rb) < 0.25                      # a kerb strip is 0.45 m wide at the least: its outer edge is not "on" the road edge
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
    import realmap
    R = ribbon_polygon(tr)
    A = realmap.others(R).segmentize(1.0)                              # the real asphalt beside the lap strip; a vertex every metre
    pads = realmap.pads().intersection(A)
    pads = unary_union([g for g in getattr(pads, "geoms", [pads]) if g.geom_type == "Polygon" and g.area > 2.0]) if not pads.is_empty else Polygon()
    aprons, roads, roads_poly = A.difference(pads), [], Polygon()
    asph = unary_union([R, A])
    site = box(-HALF_E, -HALF_N, HALF_E, HALF_N)
    zone = asph.buffer(ZONE_M).intersection(site.buffer(-6.0))
    zone = unary_union([Polygon(g.exterior) for g in getattr(zone, "geoms", [zone])])   # no photo islands in the infield
    G = realmap.sand().difference(unary_union([asph.buffer(0.35), avoid.buffer(1.0)])).simplify(0.2)        # the real sand run-offs
    G = unary_union([p for p in getattr(G, "geoms", [G]) if p.geom_type == "Polygon" and p.area > 40.0]).buffer(0)
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
    pad_part = pads.simplify(0.05).intersection(A)
    seams = pad_part.boundary.difference(A.boundary.buffer(0.3))
    for ln in getattr(seams, "geoms", [seams]):
        if ln.is_empty or ln.geom_type != "LineString" or ln.length < 1.0:
            continue
        ids = [reg.add(p) for p in ln.segmentize(1.0).coords]
        segs += [(a, b) for a, b in zip(ids[:-1], ids[1:]) if a != b]
        chain_pts += [tuple(p) for p in ln.coords]
    # 3. verge: one row of vertices 1.2 m outside each edge, in the plane of the road
    for side in (1, -1):
        for p, hh in zip(tr.shoulder_en(side), tr.shoulder_h(side)):
            if edge_tree.query(p)[0] > SHOULDER * 0.8 and (chain_lines is None or chain_lines.distance(Point(p)) > 0.3):
                reg.add(p, hh)
    # 3a. a 3 m lattice of vertices inside the asphalt beside the lap: an even surface, and triangles small enough
    #     to stay inside the texture of their square
    gy_, gx_ = np.meshgrid(np.arange(-HALF_N, HALF_N, 2.6), np.arange(-HALF_E, HALF_E, 3.0), indexing="ij")
    gx_ = gx_ + (np.arange(gx_.shape[0]) % 2)[:, None] * 1.5
    rows = np.column_stack([gx_.ravel(), gy_.ravel()])
    rows = rows[contains_xy(A.buffer(-1.0), rows[:, 0], rows[:, 1])]
    seen = cKDTree(np.array(reg.pts))
    for p in rows[seen.query(rows)[0] > 1.3]:
        reg.add(p)
    # 3c. a row of vertices 1 m outside the other asphalt and 4 m outside the lap: the worn strip and the mown verge end there
    ring = unary_union([asph.buffer(1.0).boundary, asph.buffer(4.0).boundary])
    seen = cKDTree(np.array(reg.pts))
    for g_ in getattr(ring, "geoms", [ring]):
        for r_ in [g_]:
            k_ = max(4, int(r_.length / 1.6))
            pts_ = np.array([r_.interpolate(j / k_, normalized=True).coords[0] for j in range(k_)])
            ok_ = ~contains_xy(unary_union([R.buffer(1.3), A.buffer(0.5), G.buffer(0.6)]), pts_[:, 0], pts_[:, 1]) & (seen.query(pts_)[0] > 0.7)
            for p in pts_[ok_]:
                reg.add(p)
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
    # 5. scattered interior vertices: a 4 m grid near the track and an 8 m grid over the rest of the site, fine
    #    enough to carry the banks, ditches and mounds of the scanned terrain
    keep_off = cKDTree(np.array(reg.pts))
    rng = np.random.default_rng(7)
    for step, inside in ((4.0, True), (8.0, False)):
        gx, gy = np.meshgrid(np.arange(-HALF_E + step / 2, HALF_E, step), np.arange(-HALF_N + step / 2, HALF_N, step))
        g = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.2, 0.2, (gx.size, 2)) * step
        in_zone = contains_xy(zone, g[:, 0], g[:, 1])
        g = g[in_zone if inside else ~in_zone]
        g = g[(np.abs(g[:, 0]) < HALF_E - 5) & (np.abs(g[:, 1]) < HALF_N - 5)]
        g = g[keep_off.query(g)[0] > (1.8 if inside else 3.6)]
        g = g[~contains_xy(R.buffer(0.5), g[:, 0], g[:, 1])]
        for p in g:
            reg.add(p)
    # 5b. where the terrain is not smooth (banks, ditches, the edges of mounds) a 2.5 m grid on top, so the mesh keeps
    #     the shape of the scanned ground and does not cut across it
    from scipy import ndimage as ndi
    gr = tr.H.g.a
    rough = np.abs(gr - ndi.gaussian_filter(gr, 3.0 / tr.H.g.gsd))
    gx, gy = np.meshgrid(np.arange(-HALF_E + 6, HALF_E - 6, 2.5), np.arange(-HALF_N + 6, HALF_N - 6, 2.5))
    g = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-0.3, 0.3, (gx.size, 2))
    g = g[rough[np.clip(((HALF_N - g[:, 1]) / tr.H.g.gsd).astype(int), 0, gr.shape[0] - 1), np.clip(((g[:, 0] + HALF_E) / tr.H.g.gsd).astype(int), 0, gr.shape[1] - 1)] > 0.10]
    g = g[~contains_xy(asph.buffer(1.5), g[:, 0], g[:, 1])]
    g = g[cKDTree(np.array(reg.pts)).query(g)[0] > 1.6]
    for p in g:
        reg.add(p)
    relief_pts = len(g)
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
    pinned = np.zeros(len(V), bool)
    pinned[list(reg.fixed_h)] = True
    for side in (1, -1):
        e, h = tr.edge_en(side), tr.edge_h(side)
        ring = LineString(np.vstack([e, e[:1]]))
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([e, e[:1]]), axis=0), axis=1))])
        pts = points(V[free])
        on = distance(pts, ring) < 0.003
        Hh[free[on]] = np.interp(line_locate_point(ring, pts[on]), cum, np.concatenate([h, h[:1]]))
        pinned[free[on]] = True
    # the asphalt beside the lap: the terrain model carries small bumps (and artefacts beside the overpass) that a
    # paved surface does not have. Relax its vertices towards their neighbours; the lap's own vertices stay put
    relax = contains_xy(A.buffer(0.3), V[:, 0], V[:, 1]) & ~pinned
    if relax.any():
        # right beside the lap strip the asphalt lies in the plane of the lap (its height and cross-fall carried
        # outwards); from 1.5 m to 6 m out it turns into the terrain
        from shapely import distance as _dist, points as _points
        lap_tree = cKDTree(tr.c)
        ids = np.where(relax)[0]
        _, kc = lap_tree.query(V[ids])
        plane = tr.H.road(kc.astype(float), np.einsum("ij,ij->i", V[ids] - tr.c[kc], tr.nrm[kc]))
        dr = _dist(_points(V[ids]), R)
        wgt = np.clip((dr - 1.5) / 4.5, 0, 1)
        wgt = wgt * wgt * (3 - 2 * wgt)
        Hh[ids] = plane * (1 - wgt) + Hh[ids] * wgt
        pinned[ids[dr < 1.5]] = True
        relax = relax & ~pinned
        ee = np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
        ee = np.vstack([ee, ee[:, ::-1]])
        W_ = coo_matrix((np.ones(len(ee)), (ee[:, 0], ee[:, 1])), shape=(len(V), len(V))).tocsr()
        W_.data[:] = 1.0
        deg = np.maximum(np.asarray(W_.sum(1)).ravel(), 1.0)
        for _ in range(24):
            avg = W_.dot(Hh) / deg
            Hh[relax] += 0.5 * (avg[relax] - Hh[relax])
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
    # the worn strip: grass triangles that lie wholly within 1.35 m of asphalt
    from shapely import distance as _d, points as _p
    dv = _d(_p(V), unary_union([R, A]))
    worn = near & (dv[T].max(1) <= 1.35)
    near = near & ~worn
    # the mown verge beside the lap keeps the close-up grass scan; beyond it the grass is the photo
    verge = near & (dv[T].max(1) <= 4.35)
    near = near & ~verge
    # roads of the circuit carry the same dark asphalt as the lap, paved areas the lighter apron asphalt, pads concrete
    kind = np.where(contains_xy(pad_part, cen[:, 0], cen[:, 1]), 2, 1) if not pad_part.is_empty else np.ones(len(T), int)
    big = realmap.white().buffer(0.3)                                                                     # the white pad of the hairpin
    if not big.is_empty:
        kind = np.where((kind == 2) & contains_xy(big, cen[:, 0], cen[:, 1]), 3, kind)
    # geometry
    pos = tr.fr.world(V, Hh)
    T = wind_up(pos, T)
    nrm = vertex_normals(pos, T)
    tile = np.floor((cen + [HALF_E, HALF_N]) / TILE).astype(int)
    tile_id = tile[:, 0] * 100 + tile[:, 1]
    plan = pos[:, [0, 2]]
    layers = ((apron & (kind == 2), "1APRON_c", "pad", plan / TILE_M["pad"]), (apron & (kind == 3), "1APRON_w", "padwhite", plan / TILE_M["pad"]), (gravel, "1SAND_s", "gravel", plan / TILE_M["gravel"]),
              (near, "1GRASS_g", "grass", plan / TILE_M["grass"]), (worn, "1GRASS_w", "shoulder", plan / TILE_M["shoulder"]), (verge, "1GRASS_v", "grass", plan / TILE_M["grass"]),
              (far, "1GRASS_p", "photo", site_uv(V)))
    import realtex
    photo_tex, photo_mats = {}, []
    # the asphalt beside the lap: one texture per 40 m square, baked from the photo of that square
    # the concrete strips beside the lap: one texture per 28 m of edge, baked from the photo of that strip
    fine = np.arange(tr.n * 4) / 4.0
    ftree = cKDTree(tr.en(fine, np.zeros(len(fine))))

    def lap_coords(p):
        st = fine[ftree.query(p)[1]]
        nr = tr.interp(tr.nrm, st)
        nr = nr / np.linalg.norm(nr, axis=1, keepdims=True)
        return st, np.einsum("ij,ij->i", p - tr.en(st, np.zeros(len(st))), nr)
    strip_tris = 0
    cand = np.where(apron & (kind == 2))[0]
    if len(cand):
        st_c, lat_c = lap_coords(cen[cand])
        side_c = np.where(lat_c > 0, 1, -1)
        i_c = np.round(st_c).astype(int) % tr.n
        wid_c = np.where(side_c > 0, tr.wl[i_c], tr.wr[i_c])
        from scipy.ndimage import maximum_filter1d
        flag = {1: maximum_filter1d(tr.kerb_l.astype(np.uint8), 5, mode="wrap") > 0, -1: maximum_filter1d(tr.kerb_r.astype(np.uint8), 5, mode="wrap") > 0}
        on = np.where(side_c > 0, flag[1][i_c], flag[-1][i_c]) & (np.abs(lat_c) > wid_c - 0.15) & (np.abs(lat_c) < wid_c + realtex.KERB_REACH)
        chunk_c = (np.floor(st_c).astype(int) % tr.n) // realtex.LAP_CHUNK
        for side_ in (1, -1):
            for ck in np.unique(chunk_c[on & (side_c == side_)]):
                a_, b_ = int(ck) * realtex.LAP_CHUNK, min(tr.n, (int(ck) + 1) * realtex.LAP_CHUNK)
                tri_ids = cand[on & (side_c == side_) & (chunk_c == ck)]
                ids, inv = np.unique(T[tri_ids], return_inverse=True)
                st_v, lat_v = lap_coords(V[ids])
                mid = (a_ + b_) / 2.0                                  # stations wrap around at the start line
                st_v = np.where(st_v - mid > tr.n / 2, st_v - tr.n, np.where(mid - st_v > tr.n / 2, st_v + tr.n, st_v))
                uv_ = realtex.kerb_uv(tr, a_, b_, side_, st_v, lat_v)
                tri_uv = uv_[inv.reshape(-1, 3)]
                good = ((tri_uv > 0.004) & (tri_uv < 0.996)).all(axis=(1, 2))        # a triangle that leaves the texture stays plain concrete
                if not good.any():
                    continue
                keep = tri_ids[good]
                ids, inv = np.unique(T[keep], return_inverse=True)
                st_v, lat_v = lap_coords(V[ids])
                st_v = np.where(st_v - mid > tr.n / 2, st_v - tr.n, np.where(mid - st_v > tr.n / 2, st_v + tr.n, st_v))
                name = f"k{'l' if side_ > 0 else 'r'}{int(ck):02d}"
                photo_tex[name + ".jpg"] = realtex.kerb_texture(tr, a_, b_, side_)
                photo_mats.append(name)
                parts.add(f"1APRON_{name}", name, pos[ids], nrm[ids], realtex.kerb_uv(tr, a_, b_, side_, st_v, lat_v), inv.reshape(-1, 3), cast_shadows=False)
                kind[keep] = 4
                strip_tris += len(keep)
    layers = tuple((apron & (kind == 2), *l_[1:]) if l_[1] == "1APRON_c" else l_ for l_ in layers)     # what is left of the plain concrete
    sel = apron & (kind == 1)
    sq = np.floor((cen + [HALF_E, HALF_N]) / realtex.ASPH_TILE).astype(int)
    sq_id = sq[:, 0] * 100 + sq[:, 1]
    reach = 0.0
    for aid in np.unique(sq_id[sel]):
        t = T[sel & (sq_id == aid)]
        ids, inv = np.unique(t, return_inverse=True)
        e0, n0 = (aid // 100) * realtex.ASPH_TILE - HALF_E, (aid % 100) * realtex.ASPH_TILE - HALF_N
        reach = max(reach, float(np.max(np.maximum(np.abs(V[ids, 0] - (e0 + realtex.ASPH_TILE / 2)), np.abs(V[ids, 1] - (n0 + realtex.ASPH_TILE / 2))))) - realtex.ASPH_TILE / 2)
        name = f"a{aid:04d}"
        photo_tex[name + ".jpg"] = realtex.asphalt_tile(e0, n0)
        photo_mats.append(name)
        parts.add(f"1APRON_a{aid:04d}", name, pos[ids], nrm[ids], realtex.asphalt_uv(e0, n0, V[ids]), inv.reshape(-1, 3), cast_shadows=False)
    assert reach < realtex.ASPH_MARGIN - 0.05, f"an asphalt triangle reaches {reach:.2f} m out of its square"
    # the concrete that is not a strip beside the lap (the kerbs of the other roads, the skid pad): the same squares,
    # with the brightness of the photo
    half_t = realtex.ASPH_TILE / 2
    for aid in np.unique(sq_id[apron & (kind == 2)]):
        tri_ids = np.where(apron & (kind == 2) & (sq_id == aid))[0]
        e0, n0 = (aid // 100) * realtex.ASPH_TILE - HALF_E, (aid % 100) * realtex.ASPH_TILE - HALF_N
        tv = V[T[tri_ids]]                                              # (m, 3, 2)
        out_ = np.maximum(np.abs(tv[..., 0] - (e0 + half_t)), np.abs(tv[..., 1] - (n0 + half_t))).max(1) - half_t
        tri_ids = tri_ids[out_ < realtex.ASPH_MARGIN - 0.05]           # a triangle that leaves the texture stays plain concrete
        if not len(tri_ids):
            continue
        ids, inv = np.unique(T[tri_ids], return_inverse=True)
        name = f"c{aid:04d}"
        photo_tex[name + ".jpg"] = realtex.concrete_tile(e0, n0)
        photo_mats.append(name)
        parts.add(f"1APRON_cs{aid:04d}", name, pos[ids], nrm[ids], realtex.asphalt_uv(e0, n0, V[ids]), inv.reshape(-1, 3), cast_shadows=False)
        kind[tri_ids] = 5
    layers = tuple((apron & (kind == 2), *l_[1:]) if l_[1] == "1APRON_c" else l_ for l_ in layers)
    for sel, prefix, mat, uv in layers:
        for tid in np.unique(tile_id[sel]):
            t = T[sel & (tile_id == tid)]
            ids, inv = np.unique(t, return_inverse=True)
            if prefix == "1GRASS_g":                             # the real grass of this tile, from the aerial photo
                e0, n0 = (tid // 100) * TILE - HALF_E, (tid % 100) * TILE - HALF_N
                name = f"g{tid:04d}"
                photo_tex[name + ".jpg"] = realtex.grass_tile(e0, n0, TILE)
                photo_mats.append(name)
                parts.add(f"{prefix}{tid:04d}", name, pos[ids], nrm[ids], realtex.grass_uv(e0, n0, TILE, V[ids]), inv.reshape(-1, 3), cast_shadows=False)
                continue
            parts.add(f"{prefix}{tid:04d}", mat, pos[ids], nrm[ids], uv[ids], inv.reshape(-1, 3), cast_shadows=False)
    # raster of everything that carries tiled textures (the photo is faded into grass next to it)
    covered = np.zeros((int(2 * HALF_N / MASK_GSD), int(2 * HALF_E / MASK_GSD)), np.uint8)
    px = np.stack([(V[:, 0] + HALF_E) / MASK_GSD, (HALF_N - V[:, 1]) / MASK_GSD], -1)
    cv2.fillPoly(covered, [np.round(px[t]).astype(np.int32) for t in T[~far]], 1)
    rr = np.array(R.exterior.coords)
    cv2.fillPoly(covered, [np.round(np.stack([(rr[:, 0] + HALF_E) / MASK_GSD, (HALF_N - rr[:, 1]) / MASK_GSD], -1)).astype(np.int32)], 1)
    info = dict(photo_tex=photo_tex, photo_mats=photo_mats, R=R, A=A, G=G, zone=zone, covered=covered.astype(bool), rect=np.array(rect), rect_h=Hh[rect_ids],
                tris=dict(asphalt=int(apron.sum()), gravel=int(gravel.sum()), grass=int(near.sum()), shoulder=int(worn.sum()), verge=int(verge.sum()), photo=int(far.sum())), chains=len(chains), relief_points=relief_pts, roads=roads, aprons=aprons, pads=pads, verge=verge, roads_poly=roads_poly, asphalt_squares=len([m_ for m_ in photo_mats if m_.startswith("a")]), strip_textures=len([m_ for m_ in photo_mats if m_.startswith("k")]), concrete_squares=len([m_ for m_ in photo_mats if m_.startswith("c")]), strip_triangles=strip_tris,
                apron_area=float(area[apron].sum()), gravel_area=float(area[gravel].sum()), V=V, T=T,
                cls=np.where(apron, 1, np.where(gravel, 4, np.where(near | worn | verge, 2, 3))))
    return info


def build_far(tr: Track, parts: Parts, info: dict) -> None:
    """Terrain around the site (2.5 x 2 km) from the 4 m DEM, plus a tree line on its rim."""
    fe, fn = META_FAR["half_m"]
    step = 25.0
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
