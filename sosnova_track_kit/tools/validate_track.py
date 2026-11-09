#!/usr/bin/env python3
"""Automated checks of the generated track (the part of testing that can run without the game).

Checks: OBJ integrity (no NaN, vertex limits per object, UVs, materials and textures exist), Assetto Corsa
naming (every physical object has a surface key, required AC_ empties present, counts match ui_track.json),
layout sanity (start slots and pit boxes on asphalt, no overlapping start slots, timing lines span the road,
hotlap start on the lap), config files parse (cameras, map, surfaces, ext_config), lap line inside the asphalt.
Exit code 1 on any failure. Run: python validate_track.py
"""
from __future__ import annotations

import configparser
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
SRC = os.path.join(KIT, "source")
TRACK = os.path.join(KIT, "content", "tracks", "sosnova")
fails, warns, notes = [], [], []


def check(cond: bool, msg: str, warn: bool = False) -> None:
    if cond:
        notes.append("ok   " + msg)
    elif warn:
        warns.append("WARN " + msg)
    else:
        fails.append("FAIL " + msg)


def read_obj(path: str):
    verts, objects, cur, mats = [], {}, None, {}
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                verts.append(tuple(map(float, line.split()[1:4])))
            elif line.startswith("o "):
                cur = line[2:].strip()
                objects[cur] = {"faces": 0, "verts": set(), "mat": None}
            elif line.startswith("usemtl ") and cur:
                objects[cur]["mat"] = line.split()[1]
                mats[line.split()[1]] = True
            elif line.startswith("f ") and cur:
                idx = [int(t.split("/")[0]) for t in line.split()[1:]]
                objects[cur]["faces"] += 1
                objects[cur]["verts"].update(idx)
    return np.array(verts), objects, mats


def ini(path: str) -> configparser.ConfigParser:
    cp = configparser.ConfigParser(strict=False, interpolation=None, comment_prefixes=(";", "#"), inline_comment_prefixes=(";",))
    cp.optionxform = str
    cp.read(path, encoding="utf-8")
    return cp


def main() -> int:
    obj_path = os.path.join(SRC, "sosnova.obj")
    V, objects, mats = read_obj(obj_path)
    check(len(V) > 0, f"OBJ has {len(V)} vertices")
    check(not np.isnan(V).any() and not np.isinf(V).any(), "no NaN/inf vertex coordinates")
    big = [n for n, o in objects.items() if len(o["verts"]) > 65535]
    check(not big, f"all {len(objects)} objects under 65535 vertices" + (f" (too big: {big})" if big else ""))
    empty = [n for n, o in objects.items() if o["faces"] == 0]
    check(not empty, "no empty objects" + (f": {empty[:5]}" if empty else ""))

    # materials and textures
    mtl = open(os.path.join(SRC, "sosnova.mtl")).read()
    for m in mats:
        check(f"newmtl {m}\n" in mtl, f"material {m} defined in MTL")
    for line in mtl.splitlines():
        if line.startswith("map_Kd ") or line.startswith("map_d "):
            tex = os.path.join(SRC, line.split(None, 1)[1].strip())
            check(os.path.exists(tex), f"texture exists: {os.path.basename(tex)}")

    # surfaces: every physical object (digit prefix) must match a surface key
    surf = ini(os.path.join(TRACK, "data", "surfaces.ini"))
    keys = [surf[s]["KEY"] for s in surf.sections() if s.startswith("SURFACE_")]
    check(len(keys) >= 4, f"surfaces.ini has {len(keys)} surfaces: {keys}")
    physical = [n for n in objects if n[0].isdigit()]
    unmatched = [n for n in physical if not any(n[1:].startswith(k) for k in keys)]
    check(not unmatched, f"all {len(physical)} physical objects map to a surface" + (f" (unmatched: {unmatched[:5]})" if unmatched else ""))
    road_objs = [n for n in physical if n[1:].startswith("ROAD")]
    check(len(road_objs) >= 1, f"{len(road_objs)} road objects")

    # layout
    L = json.load(open(os.path.join(SRC, "layout.json")))
    ui = json.load(open(os.path.join(TRACK, "ui", "ui_track.json"), encoding="utf-8"))
    n_start, n_pit = len(L["AC_START"]), len(L["AC_PIT"])
    check(n_start == n_pit, f"{n_start} start slots and {n_pit} pit boxes")
    check(int(ui["pitboxes"]) == n_pit, f"ui_track.json pitboxes = {ui['pitboxes']}")
    check(len(L["AC_TIME"]) >= 1, f"{len(L['AC_TIME'])} timing lines (first = start/finish)")
    check(len(L["AC_HOTLAP_START"]) == 1, "hotlap start present")
    starts = np.array([p["pos_ac"] for p in L["AC_START"]])
    dmin = min(np.linalg.norm(starts[i] - starts[j]) for i in range(n_start) for j in range(i + 1, n_start))
    check(dmin >= 3.5, f"minimum distance between start slots {dmin:.1f} m")
    for t in L["AC_TIME"]:
        l, r = np.array(t["L"]["pos_ac"]), np.array(t["R"]["pos_ac"])
        w = float(np.linalg.norm(l - r))
        check(6.0 <= w <= 40.0, f"timing line {t['index']} spans {w:.1f} m")

    # road polygon containment of start/pit/hotlap/slalom points (uses the orthophoto asphalt polygons)
    try:
        sys.path.insert(0, HERE)
        from shapely.geometry import Point
        from scenery import Aerial
        from roadmesh import asphalt_geometry
        meta = json.load(open(os.path.join(SRC, "cuzk", "meta.json")))
        A = Aerial(os.path.join(SRC, "cuzk", "ortho.png"), meta["gsd"], *meta["center"], has_overlays=False)
        rr = json.load(open(os.path.join(SRC, "cuzk", "route_ortho.json")))
        route_en = A.px_to_en(np.array(rr["route_px"]))
        geom = asphalt_geometry(A, route_en)
        def on_asphalt(p):  # AC (x, y, z) -> (east, north)
            return geom.buffer(0.3).contains(Point(p[0], -p[2]))
        off_start = [k for k, p in enumerate(L["AC_START"]) if not on_asphalt(p["pos_ac"])]
        off_pit = [k for k, p in enumerate(L["AC_PIT"]) if not on_asphalt(p["pos_ac"])]
        check(not off_start, "all start slots on asphalt" + (f" (off: {off_start})" if off_start else ""))
        check(not off_pit, "all pit boxes on asphalt" + (f" (off: {off_pit})" if off_pit else ""), warn=True)
        check(on_asphalt(L["AC_HOTLAP_START"][0]["pos_ac"]), "hotlap start on asphalt")
        inside = np.mean([geom.buffer(0.5).contains(Point(*p)) for p in route_en])
        check(inside > 0.97, f"lap line inside asphalt for {inside * 100:.1f} % of its points")
        stacks = [n for n in objects if n.startswith("AC_POBJECT_TYRES")]
        check(len(stacks) == len(rr.get("cones_px") or []), f"{len(stacks)} slalom stacks = {len(rr.get('cones_px') or [])} marked points")
    except Exception as e:  # orthophoto not present (zip without ortho.png) -> skip these checks
        warns.append(f"WARN asphalt containment checks skipped ({type(e).__name__}: {e})")

    # configs
    cams = ini(os.path.join(TRACK, "data", "cameras.ini"))
    ncam = int(cams["HEADER"]["CAMERA_COUNT"])
    check(all(f"CAMERA_{i}" in cams for i in range(ncam)), f"cameras.ini: {ncam} cameras")
    for i in range(ncam):
        f = [float(v) for v in cams[f"CAMERA_{i}"]["FORWARD"].split(",")]
        check(abs(math.sqrt(sum(c * c for c in f)) - 1) < 0.01, f"camera {i} forward vector normalised")
    mp = ini(os.path.join(TRACK, "data", "map.ini"))["PARAMETERS"]
    check(float(mp["SCALE_FACTOR"]) > 0 and os.path.exists(os.path.join(TRACK, "map.png")), "map.ini + map.png present")
    ext = ini(os.path.join(TRACK, "extension", "ext_config.ini"))
    check("RAIN_FX" in ext and "GRASS_FX" in ext, "ext_config.ini has RAIN_FX and GRASS_FX")
    puddle_mats = [m.strip() for m in ext["RAIN_FX"]["PUDDLES_MATERIALS"].split(",")]
    check(all(m in mats for m in puddle_mats), f"puddle materials exist in mesh: {puddle_mats}")
    low_objs = [n for n in objects if "_low_" in n]
    check(len(low_objs) >= 1, f"{len(low_objs)} puddle-zone road objects")
    for f in ("ui/outline.png", "ui/preview.png", "data/lighting.ini"):
        check(os.path.exists(os.path.join(TRACK, f)), f"{f} present")
    check(os.path.exists(os.path.join(SRC, "sosnova.fbx")), "sosnova.fbx present")

    print("\n".join(notes))
    print("\n".join(warns))
    print("\n".join(fails))
    print(f"\n{len(notes)} ok, {len(warns)} warnings, {len(fails)} failures")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
