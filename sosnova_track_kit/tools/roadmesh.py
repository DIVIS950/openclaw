"""Road surface mesh taken directly from the orthophoto: the asphalt outline becomes polygons
(with holes for the infields), which are triangulated with Shewchuk's Triangle so the surface
follows the LiDAR terrain. The result is the whole paved area of the site as drivable road.
"""
from __future__ import annotations

import numpy as np
import triangle as tr
from scipy import ndimage as ndi
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import unary_union
from skimage.measure import find_contours, label


def asphalt_geometry(aerial, route_en: np.ndarray, clip_margin_m: float = 110.0, min_hole_m2: float = 15.0, simplify_m: float = 0.15):
    """Shapely (Multi)Polygon of the paved area connected to the route, in (east, north) metres."""
    asphalt = aerial.classes()["asphalt"].copy()
    lab, _ = label(asphalt, return_num=True)
    rpx = aerial.en_to_px(route_en).astype(int)
    rpx[:, 0] = np.clip(rpx[:, 0], 0, aerial.w - 1)
    rpx[:, 1] = np.clip(rpx[:, 1], 0, aerial.h - 1)
    ids = set(lab[rpx[:, 1], rpx[:, 0]].tolist()) - {0}
    mask = np.isin(lab, list(ids))
    # fill small holes (manhole covers, shadows, paint) so the surface is continuous
    holes = label(~mask)
    sizes = np.bincount(holes.ravel()) * aerial.scale ** 2
    mask |= np.isin(holes, np.where(sizes < min_hole_m2)[0])
    # smooth the outline: morphological closing/opening (0.75 m) + Gaussian (0.4 m) before contouring
    r = max(1, int(0.75 / aerial.scale))
    mask = ndi.binary_closing(mask, iterations=r)
    mask = ndi.binary_opening(mask, iterations=max(1, r // 2))
    soft = ndi.gaussian_filter(mask.astype(np.float32), 0.4 / aerial.scale)
    mask = soft > 0.5

    rings = []
    for c in find_contours(mask.astype(float), 0.5):
        if len(c) < 24:
            continue
        p = Polygon(aerial.px_to_en(c[:, ::-1]))
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty or p.area < 1.0:
            continue
        rings.append(p.simplify(simplify_m))
    # even-odd assembly: outer rings add, rings inside the current shape are holes
    rings.sort(key=lambda p: p.area, reverse=True)
    geom = None
    for p in rings:
        if geom is None:
            geom = p
        elif geom.contains(p.representative_point()):
            geom = geom.difference(p)
        else:
            geom = geom.union(p)
    clip = LineString(route_en).convex_hull.buffer(clip_margin_m)
    geom = geom.intersection(clip).buffer(0)
    # final edge smoothing: open/close with 0.4 m radius, then simplify
    geom = geom.buffer(0.4).buffer(-0.8).buffer(0.4).simplify(simplify_m)
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    geom = MultiPolygon([p for p in geom.geoms if p.area > 40.0])  # drop slivers
    return geom


def rasterize(aerial, geom: MultiPolygon) -> np.ndarray:
    """Boolean image mask (ortho pixels) of the polygons, for skipping ground cells under the road."""
    from PIL import Image, ImageDraw
    img = Image.new("1", (aerial.w, aerial.h), 0)
    d = ImageDraw.Draw(img)
    for poly in geom.geoms:
        d.polygon([tuple(p) for p in aerial.en_to_px(np.array(poly.exterior.coords))], fill=1)
        for ring in poly.interiors:
            d.polygon([tuple(p) for p in aerial.en_to_px(np.array(ring.coords))], fill=0)
    return np.asarray(img, dtype=bool)


def triangulate(geom: MultiPolygon, max_area_m2: float = 3.0, min_angle: float = 28.0) -> tuple[np.ndarray, np.ndarray]:
    """Constrained Delaunay triangulation of all polygons. Returns (vertices (east, north), triangles)."""
    all_v, all_t = [], []
    offset = 0
    for poly in geom.geoms:
        verts, segs, holes = [], [], []

        def add_ring(coords):
            nonlocal verts, segs
            pts = np.array(coords[:-1], float)
            # remove duplicate consecutive points
            keep = np.ones(len(pts), bool)
            keep[1:] = np.linalg.norm(np.diff(pts, axis=0), axis=1) > 1e-6
            pts = pts[keep]
            start = len(verts)
            n = len(pts)
            verts.extend(pts.tolist())
            segs.extend([[start + i, start + (i + 1) % n] for i in range(n)])

        add_ring(poly.exterior.coords)
        for ring in poly.interiors:
            add_ring(ring.coords)
            holes.append(list(Polygon(ring).representative_point().coords[0]))
        data = {"vertices": np.array(verts), "segments": np.array(segs)}
        if holes:
            data["holes"] = np.array(holes)
        out = tr.triangulate(data, f"pq{min_angle}a{max_area_m2}")
        all_v.append(out["vertices"])
        all_t.append(out["triangles"] + offset)
        offset += len(out["vertices"])
    return np.vstack(all_v), np.vstack(all_t)


def add_road_polygons(obj, aerial, geom: MultiPolygon, height_fn, name: str = "1ROAD_track", uv_scale: float = 8.0, max_area_m2: float = 3.0) -> int:
    """Write the triangulated asphalt as AC road objects (chunked under the 65k vertex limit)."""
    V, T = triangulate(geom, max_area_m2)
    H = height_fn(V)
    chunk = 20000  # triangles per object
    count = 0
    for c in range(0, len(T), chunk):
        tris = T[c:c + chunk]
        used = np.unique(tris)
        remap = {int(u): obj.add_vertex((V[u, 0], H[u], -V[u, 1]), (V[u, 0] / uv_scale, V[u, 1] / uv_scale)) for u in used}
        faces = []
        for a, b, cc in tris:
            # triangle gives CCW in (east, north) => normal up in AC space
            faces.append((remap[int(a)], remap[int(b)], remap[int(cc)]))
        obj.add_faces(f"{name}_{count:02d}", "road", faces)
        count += 1
    return len(T)
