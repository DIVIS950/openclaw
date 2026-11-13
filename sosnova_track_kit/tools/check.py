"""Validate the built track folder by reading back the files Assetto Corsa will load.

Checks the kn5 structure, triangle winding, mesh naming against surfaces.ini, spawn points (direction, height,
surface, clearance), the timing gates, the AI line (on the road, smooth, starts on the line) and the joins
between road and ground. Exits with status 1 if anything fails."""
from __future__ import annotations

import configparser
import json
import os
import re
import struct
import sys

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kn5  # noqa: E402
from common import OUT, TRACK  # noqa: E402

FAILS: list[str] = []


def check(ok: bool, text: str) -> None:
    print(("  ok    " if ok else "  FAIL  ") + text)
    if not ok:
        FAILS.append(text)


class Surface:
    """Top surface lookup (vertical ray cast) over a set of triangle meshes."""

    def __init__(self, meshes):
        P, owner, names = [], [], []
        for m in meshes:
            v = m["vertices"]["pos"].astype(np.float64)
            t = m["indices"].reshape(-1, 3).astype(int)
            P.append(v[t])
            owner.append(np.full(len(t), len(names)))
            names.append(m["name"])
        self.tri = np.vstack(P)
        self.owner = np.concatenate(owner)
        self.names = names
        self.lo, self.hi = self.tri[:, :, [0, 2]].min(1), self.tri[:, :, [0, 2]].max(1)
        cell = 8.0
        self.cell = cell
        self.buckets: dict[tuple[int, int], list[int]] = {}
        a, b = np.floor(self.lo / cell).astype(int), np.floor(self.hi / cell).astype(int)
        for k in range(len(self.tri)):
            for i in range(a[k, 0], b[k, 0] + 1):
                for j in range(a[k, 1], b[k, 1] + 1):
                    self.buckets.setdefault((i, j), []).append(k)

    def at(self, x: float, z: float, near_y: float | None = None):
        """(height, mesh name) of the surface under the point: the highest one, or the one nearest to near_y
        where surfaces overlap (the road under the bridge). (None, None) when there is none."""
        ids = self.buckets.get((int(np.floor(x / self.cell)), int(np.floor(z / self.cell))))
        if not ids:
            return None, None
        t = self.tri[ids]
        a, b, c = t[:, 0], t[:, 1], t[:, 2]
        d = (b[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 2] - c[:, 2])
        d = np.where(np.abs(d) < 1e-12, 1e-12, d)
        w0 = ((b[:, 2] - c[:, 2]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (z - c[:, 2])) / d
        w1 = ((c[:, 2] - a[:, 2]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (z - c[:, 2])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            return None, None
        y = w0 * a[:, 1] + w1 * b[:, 1] + w2 * c[:, 1]
        y = np.where(inside, y, -1e9)
        k = int(y.argmax()) if near_y is None else int(np.where(inside, np.abs(y - near_y), 1e9).argmin())
        return float(y[k]), self.names[self.owner[ids[k]]]


def read_ai(path: str):
    b = open(path, "rb").read()
    ver, n, _, _ = struct.unpack_from("<4i", b, 0)
    rec = np.frombuffer(b, np.dtype([("p", "<f4", 3), ("d", "<f4"), ("i", "<i4")]), n, 16)
    m = struct.unpack_from("<i", b, 16 + n * 20)[0]
    extra = np.frombuffer(b, "<f4", m * 18, 20 + n * 20).reshape(m, 18)
    return ver, rec, extra, len(b) - (20 + n * 20 + m * 72)


def main() -> None:
    path = os.path.join(OUT, f"{TRACK}.kn5")
    k = kn5.read(path)
    meshes = [n for n in k["nodes"] if n["cls"] == 2]
    dummies = {n["name"]: n["matrix"] for n in k["nodes"] if n["cls"] == 1 and n["depth"] == 1}
    print(f"{TRACK}.kn5: {k['size'] / 1e6:.1f} MB, {len(k['textures'])} textures, {len(k['materials'])} materials, {len(meshes)} meshes, {len(dummies)} dummies")
    print("kn5 structure")
    check(k["version"] == 5 and k["end"] == k["size"], "file parses to the last byte (version 5)")
    check(k["nodes"][0]["name"] == TRACK or any(n["depth"] == 0 for n in k["nodes"]), "single root node")
    check(all(m["nv"] <= 65535 for m in meshes), f"all meshes within the 65535 vertex limit (largest {max(m['nv'] for m in meshes)})")
    bad_w = tot = 0
    finite = True
    for m in meshes:
        v, t = m["vertices"], m["indices"].reshape(-1, 3).astype(int)
        finite &= bool(np.isfinite(v["pos"]).all() and np.isfinite(v["normal"]).all() and np.isfinite(v["uv"]).all())
        p = v["pos"].astype(np.float64)
        fn = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])
        dots = np.einsum("ij,ij->i", fn, v["normal"][t[:, 0]].astype(np.float64))
        if m["name"].startswith(("TREES", "HORIZON", "1WALL_pylons", "1WALL_bridge_rail")):
            continue                                    # two-sided sheets: both windings on purpose
        bad_w += int((dots <= 0).sum())
        tot += len(t)
    check(finite, "no NaN / infinite vertex data")
    check(bad_w == 0, f"triangle winding agrees with the normals ({tot - bad_w}/{tot})")
    tex_names = {t[0] for t in k["textures"]}
    check(all(set(m["maps"].values()) <= tex_names for m in k["materials"]), "every material texture is embedded")
    names = [m["name"] for m in meshes]
    check(len(names) == len(set(names)), "mesh names are unique")

    print("surfaces")
    cp = configparser.ConfigParser()
    cp.read(os.path.join(OUT, "data", "surfaces.ini"))
    keys = {cp[s]["KEY"] for s in cp.sections()}
    phys = [n for n in names if re.match(r"^\d", n)]
    prefixes = {re.match(r"^\d+([A-Z]+)", n).group(1) for n in phys}
    check(prefixes <= keys, f"physical mesh prefixes {sorted(prefixes)} are all defined in surfaces.ini {sorted(keys)}")
    ground = Surface([m for m in meshes if re.match(r"^\d+(ROAD|APRON|GRASS|KERB|SAND)", m["name"])])
    walls = np.vstack([m["vertices"]["pos"] for m in meshes if m["name"].startswith("1WALL")]).astype(np.float64)
    wall_tree = cKDTree(walls[:, [0, 2]])

    print("AI line")
    ver, rec, extra, tail = read_ai(os.path.join(OUT, "ai", "fast_lane.ai"))
    p = rec["p"].astype(np.float64)
    n = len(p)
    check(ver == 7 and tail == 0 and len(extra) == n, f"fast_lane.ai well formed ({n} points)")
    step = np.linalg.norm(np.roll(p, -1, axis=0) - p, axis=1)
    check(abs(step.mean() - 1.0) < 0.02 and step.max() < 1.1, f"points about 1 m apart (mean {step.mean():.3f}, max {step.max():.3f})")
    on_road, dy = 0, []
    for q in p:
        y, name = ground.at(q[0], q[2], q[1])
        if name and name.startswith("1ROAD"):
            on_road += 1
            dy.append(q[1] - y)
    dy = np.array(dy)
    check(on_road == n, f"every AI point lies on the road surface ({on_road}/{n})")
    check(np.abs(dy).max() < 0.03, f"AI line height matches the road (max difference {np.abs(dy).max() * 1000:.0f} mm)")
    check(abs(p[0, 2]) < 0.6 and extra[0, 15] > 0.99, f"point 0 is on the start line heading +Z (z = {p[0, 2]:.2f}, forward z = {extra[0, 15]:.3f})")
    check(extra[:, 5].min() > 1.0 and extra[:, 6].min() > 1.0, f"line keeps clear of the edges (min {extra[:, 5].min():.2f} / {extra[:, 6].min():.2f} m)")
    near = wall_tree.query_ball_point(p[:, [0, 2]], 1.2)
    hits = sum(1 for q, ids in zip(p, near) if any(-0.6 < walls[i, 1] - q[1] < 2.2 for i in ids))   # walls at car height only
    check(hits == 0, f"line keeps 1.2 m clear of walls, tyre barriers and bridge supports ({hits} points too close)")
    ys = p[:, 1]
    grade = (np.roll(ys, -1) - ys) / step
    bump = np.abs(np.roll(grade, -1) - grade) / step
    check(bump.max() < 0.006, f"road profile is smooth: max change of gradient {bump.max() * 100:.3f} % per metre, gradient {grade.min() * 100:.1f}..{grade.max() * 100:.1f} %")

    print("bridge")
    deck = Surface([m for m in meshes if m["name"].startswith("1ROAD_bridge")])
    under = [(deck.at(q[0], q[2])[0], q[1]) for q in p]
    under = [(a, b) for a, b in under if a is not None]
    check(len(under) >= 3 and min(a - b for a, b in under) > 3.8,
          f"the lap passes under the bridge deck with {min(a - b for a, b in under):.1f} m between road and deck top ({len(under)} AI points)")
    dv = np.vstack([m["vertices"]["pos"] for m in meshes if m["name"].startswith("1ROAD_bridge")]).astype(np.float64)
    ends = dv[np.argsort(dv[:, 1])[:6]]
    gaps = [abs(ground.at(q[0], q[2], q[1])[0] - q[1]) for q in ends if ground.at(q[0], q[2], q[1])[0] is not None]
    check(len(gaps) > 0 and max(gaps) < 0.12, f"both feet of the bridge meet the ground (largest step {max(gaps) * 100:.0f} cm)")

    print("spawn points")
    ui = json.load(open(os.path.join(OUT, "ui", "ui_track.json"), encoding="utf-8"))
    starts = sorted([d for d in dummies if d.startswith("AC_START_")], key=lambda s: int(s.split("_")[-1]))
    pits = sorted([d for d in dummies if d.startswith("AC_PIT_")], key=lambda s: int(s.split("_")[-1]))
    check(len(starts) == len(pits) == int(ui["pitboxes"]), f"{len(starts)} grid slots, {len(pits)} pit boxes, ui pitboxes {ui['pitboxes']}")
    ai_tree = cKDTree(p[:, [0, 2]])
    fwd = extra[:, 13:16].astype(np.float64)
    worst_dot, worst_h, worst_ortho = 1.0, 0.0, 0.0
    surf_ok, clear = True, 1e9
    for name in starts + ["AC_HOTLAP_START_0"]:
        m = dummies[name].astype(np.float64)
        pos, face = m[3, :3], m[2, :3]
        j = ai_tree.query(pos[[0, 2]])[1]
        worst_dot = min(worst_dot, float(face @ fwd[j]))
        y, sname = ground.at(pos[0], pos[2], pos[1])
        surf_ok &= bool(sname and sname.startswith("1ROAD"))
        worst_h = max(worst_h, abs(pos[1] - y - 0.05))
        worst_ortho = max(worst_ortho, float(np.abs(m[:3, :3] @ m[:3, :3].T - np.eye(3)).max()), abs(float(np.linalg.det(m[:3, :3])) - 1))
        clear = min(clear, float(wall_tree.query(pos[[0, 2]])[0]))
    check(worst_dot > 0.98, f"grid and hotlap cars face the direction of travel (worst angle to the racing line {np.degrees(np.arccos(min(worst_dot, 1.0))):.1f} deg)")
    s0 = dummies["AC_START_0"]
    check(s0[2, 2] > 0.999 and abs(s0[2, 0]) < 0.03, f"AC_START_0 faces +Z, the start straight (facing = {np.round(s0[2, :3], 3).tolist()})")
    check(surf_ok and worst_h < 0.02, f"grid slots sit on the road, 5 cm above it (max error {worst_h * 1000:.0f} mm)")
    check(worst_ortho < 1e-5, "spawn matrices are pure rotations (right-handed, no scale)")
    zs = [dummies[s][3, 2] for s in starts]
    check(all(a > b for a, b in zip(zs[:-1], zs[1:])) and zs[0] < -2.0, f"grid order: P1 nearest the line, all behind it (z {zs[0]:.1f} .. {zs[-1]:.1f})")
    pit_ok, pit_h = True, 0.0
    for name in pits:
        m = dummies[name].astype(np.float64)
        pos = m[3, :3]
        y, sname = ground.at(pos[0], pos[2])
        pit_ok &= bool(sname and sname.startswith(("1APRON", "1ROAD")))
        pit_h = max(pit_h, abs(pos[1] - y - 0.05)) if y is not None else 9
        clear = min(clear, float(wall_tree.query(pos[[0, 2]])[0]))
        pit_ok &= m[2, 2] > 0.5                       # pointing up the straight, towards the track
    check(pit_ok and pit_h < 0.03, f"pit boxes stand on asphalt facing the track exit (height error {pit_h * 1000:.0f} mm)")
    check(clear > 2.5, f"no wall within 2.5 m of any spawn point (nearest {clear:.1f} m)")
    d = np.array([dummies[s][3, :3] for s in starts + pits])
    dd = cKDTree(d).query(d, k=2)[0][:, 1]
    check(dd.min() > 3.5, f"spawn points at least 3.5 m apart (min {dd.min():.2f} m)")

    print("timing")
    for idx in (0, 1):
        L, R = dummies[f"AC_TIME_{idx}_L"][3, :3].astype(float), dummies[f"AC_TIME_{idx}_R"][3, :3].astype(float)
        mid = (L + R) / 2
        j = ai_tree.query(mid[[0, 2]])[1]
        f = fwd[j]
        side = f[2] * (L - R)[0] - f[0] * (L - R)[2]   # > 0 when L is on the driver's left
        cross_d = float(ai_tree.query(mid[[0, 2]])[0])
        check(side > 0 and cross_d < 6 and (idx == 1 or j in (0, 1, n - 1)),
              f"AC_TIME_{idx}: L on the driver's left, gate {np.linalg.norm(L - R):.1f} m wide across the line at AI point {j}")

    print("joins")
    from track import Track
    tr = Track()
    gv = np.vstack([m["vertices"]["pos"] for m in meshes if m["name"].startswith(("1GRASS_g", "1GRASS_w", "1GRASS_v", "1APRON", "1SAND"))]).astype(np.float64)
    gtree = cKDTree(gv)
    worst, tj, tj_gap = 0.0, 0, 0.0
    for side in (1, -1):
        e = tr.fr.world(tr.edge_en(side), tr.edge_h(side))
        worst = max(worst, float(gtree.query(e)[0].max()))
        # ground vertices that sit on the edge line between two road vertices would open hairline cracks
        from shapely.geometry import LinearRing
        from shapely import distance, points
        ring = LinearRing(e[:, [0, 2]])
        near = gv[cKDTree(e[:, [0, 2]]).query(gv[:, [0, 2]])[0] < 1.2]
        on_line = distance(points(near[:, [0, 2]]), ring) < 0.004
        at_vertex = cKDTree(e[:, [0, 2]]).query(near[:, [0, 2]])[0] < 0.002
        sel = near[on_line & ~at_vertex]
        if len(sel):
            from shapely import line_locate_point
            from shapely.geometry import LineString
            closed = np.vstack([e, e[:1]])
            cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(closed[:, [0, 2]], axis=0), axis=1))])
            y_edge = np.interp(line_locate_point(LineString(closed[:, [0, 2]]), points(sel[:, [0, 2]])), cum, closed[:, 1])
            tj_gap = max(tj_gap, float(np.abs(sel[:, 1] - y_edge).max()))
        tj += len(sel)
    check(worst < 0.001, f"every road edge vertex is shared with the ground mesh (max gap {worst * 1000:.2f} mm)")
    check(tj_gap < 0.001, f"ground vertices lying on a road edge between road vertices are at edge height ({tj} vertices, max gap {tj_gap * 1000:.2f} mm)")

    print("the real circuit")
    import ground
    import realmap
    from shapely import contains_xy as _inside, distance as _dist, points as _points
    from shapely.geometry import LineString as _Line
    from track import Track
    tr = Track()
    drive = Surface([m for m in meshes if m["name"].startswith(("1ROAD_trk", "1APRON"))])
    real = realmap.asphalt()
    # 1. what is paved in the model is what is paved in the photo: a point every 1.5 m over the whole circuit
    x0, y0, x1, y1 = real.bounds
    gx, gy = np.meshgrid(np.arange(x0 - 6, x1 + 6, 1.5), np.arange(y0 - 6, y1 + 6, 1.5))
    g = np.column_stack([gx.ravel(), gy.ravel()])
    g = g[_dist(_points(g), real.boundary) > 0.6]                    # not on the outline itself
    want = _inside(real, g[:, 0], g[:, 1])
    hit = [drive.at(x, z) for x, z in tr.fr.xz(g)]
    have = np.array([y is not None for y, _ in hit])
    check(bool((want == have).mean() > 0.998), f"the paved surface of the model is the paved surface of the photo ({int(want.sum())} of {len(g)} points paved, {int((want != have).sum())} differ)")
    # 2. the widths of the lap are the real ones
    wid = tr.wl + tr.wr
    shut = ~tr.open_l & ~tr.open_r
    check(bool(wid.min() > 5.5 and wid.max() < 27.0 and shut.sum() > 300),
          f"the lap has its real widths: {wid.min():.1f} to {wid.max():.1f} m (mean {wid.mean():.1f} m); {int(shut.sum())} m lie between two real edges")
    # 2b. the real edges of the lap are even lines: no wobble against the centre line from one metre to the next
    wob = 0.0
    for w_, shut_ in ((tr.wl, ~tr.open_l | tr.conc_l), (tr.wr, ~tr.open_r | tr.conc_r)):
        d2_ = np.abs(np.roll(w_, -1) - 2 * w_ + np.roll(w_, 1))
        wob = max(wob, float(d2_[shut_].max()))
    check(wob < 0.10, f"the edges of the lap are even lines (largest bend of an edge against the centre line {wob * 100:.1f} cm from one metre to the next)")
    # 3. where the asphalt runs on beside the lap strip there is no step and no gap
    step_, gaps_, open_m = 0.0, 0, 0
    for side, is_open, w in ((1, tr.open_l, tr.wl), (-1, tr.open_r, tr.wr)):
        st = np.where(is_open)[0].astype(float)
        far = tr.en(st, side * (w[st.astype(int)] + 1.2))
        st = st[_inside(real, far[:, 0], far[:, 1])]                 # where the asphalt really carries on for more than a metre
        q = tr.fr.xz(tr.en(st, side * (w[st.astype(int)] + 0.35)))
        on = tr.h(st, side * w[st.astype(int)]) - tr.fr.ref
        open_m = open_m + len(st)
        for (x, z), y0_ in zip(q, on):
            y, _ = drive.at(x, z, y0_)
            if y is None:
                gaps_ += 1
            else:
                step_ = max(step_, abs(y - y0_))
    check(gaps_ <= 0.01 * open_m and step_ < 0.03, f"the asphalt beside the lap carries on at the same height ({open_m} m of open side, largest difference 35 cm out {step_ * 1000:.0f} mm; {gaps_} m where a strip thinner than 40 cm is left out)")
    # 4. the asphalt beside the lap is even
    ys = np.array([np.nan if y is None else y for y, _ in hit]).reshape(gx.shape) if len(g) == gx.size else None
    apr = Surface([m for m in meshes if m["name"].startswith("1APRON")])
    rough = 0.0
    for row in np.arange(y0, y1, 3.0):
        xs = np.arange(x0, x1, 1.0)
        q = np.column_stack([xs, np.full(len(xs), row)])
        yy = np.array([np.nan if v is None else v for v, _ in (apr.at(x, z) for x, z in tr.fr.xz(q))])
        d2 = np.abs(np.diff(np.diff(yy)))
        if np.isfinite(d2).any():
            rough = max(rough, float(np.nanmax(d2)))
    # where two cambered pieces of the lap lie side by side, the asphalt between them has a crease like a road crown:
    # at most twice the camber limit of 3.5 %. Anything sharper would be a step
    check(rough < 0.06, f"the asphalt beside the lap has no steps (largest change of gradient {rough * 100:.2f} % per metre, a crease like a road crown; the lap itself stays below 0.6)")
    # 5. the real barriers stand where the photo shows them, and none on the asphalt
    lines = realmap.walls()
    off = real.buffer(0.8)
    need, found = 0, 0
    for w_ in lines:
        ln = _Line(w_["en"])
        q = np.array([ln.interpolate(d_).coords[0] for d_ in np.arange(0.5, ln.length, 1.0)])
        q = q[~_inside(off, q[:, 0], q[:, 1])]
        if len(q):
            need += len(q)
            found += int((wall_tree.query(tr.fr.xz(q))[0] < 1.3).sum())
    check(len(lines) >= 15 and found >= 0.93 * need, f"the tyre walls and barriers of the photo are built ({len(lines)} barriers, {found} of {need} m found in the model)")
    conc = [m for m in meshes if m["name"].startswith(("1APRON_c", "1APRON_w"))]
    check(len(conc) >= 5 and int(tr.kerb_l.sum() + tr.kerb_r.sum()) > 150, f"the concrete strips and the white pad are part of the surface ({len(conc)} meshes, {int(tr.kerb_l.sum() + tr.kerb_r.sum())} m of strip beside the lap)")
    print("landscape and buildings")
    from heights import load_dem
    from scipy import ndimage as _ndi
    from common import HALF_E as _HE, HALF_N as _HN, SRC as _SRC, WORK as _WORK
    dem = load_dem(os.path.join(_SRC, "cuzk", "dem.tif"))                # the laser-scanned terrain, 1 m
    land = Surface([m for m in meshes if m["name"].startswith(("1GRASS_g", "1GRASS_w", "1GRASS_v", "1GRASS_p", "1SAND"))])
    rng = np.random.default_rng(5)
    q = np.column_stack([rng.uniform(-_HE + 12, _HE - 12, 9000), rng.uniform(-_HN + 12, _HN - 12, 9000)])
    q = q[_dist(_points(q), real) > 15.0]
    foot_all = [np.array(b_["en"]) for b_ in json.load(open(os.path.join(_SRC, "buildings.json"), encoding="utf-8"))]
    from shapely.geometry import Polygon as _Poly
    from shapely.ops import unary_union as _union
    q = q[~_inside(_union([_Poly(f_).buffer(2.0) for f_ in foot_all]), q[:, 0], q[:, 1])]
    truth = _ndi.map_coordinates(dem, [(_HN - q[:, 1]) - 0.5, (q[:, 0] + _HE) - 0.5], order=1, mode="nearest") - tr.fr.ref
    got = np.array([np.nan if y is None else y for y, _ in (land.at(x, z) for x, z in tr.fr.xz(q))])
    err = (got - truth)[np.isfinite(got)]
    check(len(err) > 3000 and float(np.sqrt(np.mean(err ** 2))) < 0.25 and float(np.percentile(np.abs(err), 99)) < 0.9,
          f"the landscape is the laser-scanned terrain ({len(err)} points away from the paving: rms difference {np.sqrt(np.mean(err ** 2)) * 100:.0f} cm, 99 % within {np.percentile(np.abs(err), 99) * 100:.0f} cm)")
    blds = json.load(open(os.path.join(_SRC, "buildings.json"), encoding="utf-8"))
    ndsm = np.load(os.path.join(_WORK, "survey.npz"))["ndsm"]
    tops = Surface([m for m in meshes if m["name"].startswith("1WALL_bld")])
    diff, shaped, missing = [], 0, 0
    for b_ in blds:
        en_ = np.array(b_["en"])
        shaped += b_.get("roof", {}).get("type", "flat") != "flat"
        c_ = en_.mean(0)
        inner = c_ + (en_ - c_) * 0.45                                    # four points well inside the roof
        for e_, n_ in inner:
            y_roof = tops.at(*tr.fr.xz(np.array([[e_, n_]]))[0])[0]
            y_gnd = float(tr.H.ground(np.array([[e_, n_]]))[0]) - tr.fr.ref
            h_model = float(ndsm[int((_HN - n_) / 0.5), int((e_ + _HE) / 0.5)])
            if y_roof is None:
                missing += 1
            elif h_model > 2.0:                                           # where the surface model shows the building
                diff.append((y_roof - y_gnd) - h_model)
    diff = np.array(diff)
    check(missing == 0 and len(diff) > 100 and float(np.median(np.abs(diff))) < 0.6,
          f"every building has a roof at the height of the laser-scanned surface model ({len(blds)} buildings, {shaped} with a pitched roof; median difference {np.median(np.abs(diff)) * 100:.0f} cm at {len(diff)} points)")
    via = [m for m in meshes if m["name"].startswith("SCENE_viaduct")]
    vv = np.vstack([m["vertices"]["pos"] for m in via]).astype(np.float64) if via else np.zeros((0, 3))
    check(len(via) >= 2 and float(np.ptp(vv[:, 0])) > 100, f"the motorway viaduct is built ({len(via)} meshes, {np.ptp(vv[:, 0]) if len(vv) else 0:.0f} m long, deck up to {vv[:, 1].max() if len(vv) else 0:.1f} m above the start line)")
    solid_ = [m for m in meshes if m["name"].startswith("TREE3D")]
    stacks_ = [m for m in meshes if m["name"].startswith("TYRES_stacks")]
    n_solid = sum(len(m["indices"]) // 3 for m in solid_)
    n_stack = sum(len(m["indices"]) // 3 for m in stacks_) // 16                # 16 side triangles per stack
    lat_ = [m_ for m_ in k["materials"] if m_["name"] == "lattice"]
    check(n_solid > 100000 and n_stack > 600 and len(lat_) == 1,
          f"the scenery is solid: trees with trunk and body ({n_solid} triangles), tyre walls of {n_stack} round stacks, lattice pylons")
    boards_ = sum(len(m["indices"]) // 3 for m in meshes if m["name"].startswith("BANNER_boards") and m["name"].endswith("banner"))
    bags_ = [m for m in meshes if m["name"].startswith("1WALL_bags")]
    check(boards_ >= 60 and len(bags_) >= 1, f"advertising boards stand at the barriers ({boards_ // 2}) and the soft bags are single bodies ({sum(len(m['indices']) // 3 for m in bags_)} triangles)")
    lap_poly = ground.ribbon_polygon(tr)
    to_en = lambda v: tr.fr.o + v[:, [0]] * tr.fr.l + v[:, [2]] * tr.fr.f
    blocks = [m for m in meshes if m["name"].startswith("1WALL") and m["name"].endswith("barricade")]
    if blocks:
        bv = to_en(np.vstack([m["vertices"]["pos"] for m in blocks]).astype(np.float64))
        d = _dist(_points(bv), lap_poly)
        check(float(d.min()) > 0.8, f"barricades stand off the race lap ({len(blocks)} meshes, nearest {float(d.min()):.2f} m from its edge)")
    stacks = [m for m in meshes if m["name"].startswith("1WALL_tyrestacks")]
    if len(tr.cones_en):
        top = Surface(stacks)
        gnd = Surface([m for m in meshes if m["name"].startswith(("1ROAD_trk", "1APRON", "1GRASS", "1SAND"))])
        ok_, worst_h = 0, 0.0
        for x, z in tr.fr.xz(tr.cones_en):
            yt, yg = top.at(x, z)[0], gnd.at(x, z)[0]
            if yt is not None and yg is not None:
                ok_ += 1
                worst_h = max(worst_h, abs((yt - yg) - 0.92))
        check(ok_ == len(tr.cones_en) and worst_h < 0.12, f"a tyre barrel stands on the ground at each of the {tr.map_dots} yellow dots and {len(tr.cones_en) - tr.map_dots} extra points ({ok_} found, height off by at most {worst_h * 100:.0f} cm)")
        st = np.array([np.argmin(np.linalg.norm(p[:, [0, 2]] - q, axis=1)) for q in tr.fr.xz(tr.cones_en)])
        gap = np.array([np.linalg.norm(p[i, [0, 2]] - q) for i, q in zip(st, tr.fr.xz(tr.cones_en))]) - 0.34
        check(float(gap.min()) > 1.2, f"the racing line passes every tyre stack with room (least {float(gap.min()):.2f} m)")
        from scipy.spatial import cKDTree as _KD
        near = _KD(tr.c).query(tr.cones_en)[1]
        lat = np.einsum("ij,ij->i", tr.cones_en - tr.c[near], tr.nrm[near])
        free = []
        for k_, l_ in zip(near, lat):                              # widest free stretch of road beside each stack
            lo_, hi_ = -tr.wr[k_], tr.wl[k_]
            a_, b_ = max(lo_, l_ - 0.34), min(hi_, l_ + 0.34)
            free.append(hi_ - lo_ if a_ >= b_ else max(a_ - lo_, hi_ - b_))
        check(min(free) > 4.0, f"the road stays passable at every tyre stack (narrowest free width {min(free):.1f} m, {int(sum(abs(l_) < 4.84 for l_ in lat))} stacks stand on the road)")
    print("files")
    cpm = configparser.ConfigParser()
    cpm.read(os.path.join(OUT, "data", "map.ini"))
    im = Image.open(os.path.join(OUT, "map.png"))
    check(im.size == (int(cpm["PARAMETERS"]["WIDTH"]), int(cpm["PARAMETERS"]["HEIGHT"])), f"map.png matches map.ini {im.size}")
    for rel in ("data/cameras.ini", "data/lighting.ini", "extension/ext_config.ini", "ui/outline.png", "ui/preview.png"):
        check(os.path.exists(os.path.join(OUT, rel)), rel + " present")
    print()
    if FAILS:
        print(f"{len(FAILS)} CHECK(S) FAILED")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
