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
    gv = np.vstack([m["vertices"]["pos"] for m in meshes if m["name"].startswith(("1GRASS_g", "1GRASS_w", "1APRON", "1SAND"))]).astype(np.float64)
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

    print("other roads and race equipment")
    import circuit
    import ground
    from shapely import contains_xy as _inside, distance as _dist, points as _points
    from track import Track
    tr = Track()
    drive = Surface([m for m in meshes if m["name"].startswith(("1ROAD_trk", "1APRON"))])
    for f in circuit.road_frames():
        worst, holes = 0.0, 0
        for g in (-0.6, 0.0, 0.6):
            xz = tr.fr.xz(f["en"][::2] + f["nrm"][::2] * (f["half"] * g))          # every metre
            hit = [drive.at(x, z) for x, z in xz]
            holes += sum(y is None for y, _ in hit[4:-4])                           # the last metres lie under the lap
            y = np.array([np.nan if v is None else v for v, _ in hit])
            bump = np.nan_to_num(np.abs(np.diff(np.diff(y))))
            worst = max(worst, float(bump.max()))
        # the lap itself stays below 0.6 %; a road that leaves the cambered lap may crease a little more
        check(holes == 0 and worst < 0.02, f"road '{f['name']}' is paved over its whole width and even (holes {holes}, max change of gradient {worst * 100:.2f} % per metre)")
    road_kerbs = [m for m in meshes if m["name"].startswith("1KERB_r")]
    check(len(road_kerbs) >= 8, f"the other roads carry raised kerbs ({len(road_kerbs)})")
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
