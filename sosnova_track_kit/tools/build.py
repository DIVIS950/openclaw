"""Build the complete Assetto Corsa track folder content/tracks/sosnova_v9 from the survey data.

    python3 prep.py && python3 survey.py && python3 paint.py && python3 refine.py && python3 realmap.py && python3 heights.py && python3 mkbuildings.py   (once)
    python3 build.py
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge  # noqa: E402
import bridge_geom  # noqa: E402
import circuit  # noqa: E402
import ground  # noqa: E402
import realmap  # noqa: E402
import kn5  # noqa: E402
import layout  # noqa: E402
import marks  # noqa: E402
import photo  # noqa: E402
import props  # noqa: E402
import ribbon  # noqa: E402
import textures  # noqa: E402
from common import OUT, TRACK, WORK  # noqa: E402
from track import Parts, Track  # noqa: E402

M = kn5.Material
MATERIALS = [
    M("road", "road.jpg", specular=0.10, specular_exp=30),
    M("road_g1", "road_g1.jpg", specular=0.11, specular_exp=32),
    M("road_g2", "road_g2.jpg", specular=0.12, specular_exp=34),
    M("road_g3", "road_g3.jpg", specular=0.13, specular_exp=36),
    M("apron", "apron.jpg", specular=0.08, specular_exp=25),
    M("metal", "metal.jpg", specular=0.2, specular_exp=50),
    M("lights", "lights.jpg", specular=0.1),
    M("boards", "boards.jpg", specular=0.05),
    M("pad", "pad.jpg", specular=0.06, specular_exp=20),
    M("padwhite", "padwhite.jpg", specular=0.08, specular_exp=20),
    M("gravel", "gravel.jpg", specular=0.0),
    M("grass", "grass.jpg", specular=0.0),
    M("shoulder", "shoulder.jpg", specular=0.0),
    M("bags", "bags.jpg", specular=0.05),
    M("cone", "cone.jpg", specular=0.15, specular_exp=30),
    M("photo", "ground_photo.jpg", specular=0.0),
    M("photofar", "ground_far.jpg", specular=0.0),
    M("roofphoto", "roof_photo.jpg", specular=0.05),
    M("paint", "paint.jpg", specular=0.12, specular_exp=30),
    M("kerb", "kerb.jpg", specular=0.10, specular_exp=30),
    M("barricade", "barricade.jpg", specular=0.18, specular_exp=40),
    M("tyres", "tyres.jpg", specular=0.05),
    M("concrete", "concrete.jpg"),
    M("building", "building.jpg"),
    M("garage", "garage.jpg"),
    M("hall", "hall.jpg", specular=0.15, specular_exp=40),
    M("hut", "hut.jpg"),
    M("softwall", "softwall.jpg", specular=0.06),
    M("arch", "arch.jpg", specular=0.12, specular_exp=30),
    M("fence", "fence.png", shader="ksPerPixelAT", alpha_tested=True, specular=0.1),
    M("pylon", "pylon.png", shader="ksPerPixelAT", alpha_tested=True, specular=0.05),
    M("treeconifer", "tree_conifer.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
    M("treeleaf", "tree_leaf.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
    M("forest", "forest.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
]


def main() -> None:
    t0 = time.time()
    tr = Track()
    parts = Parts()
    lap_tex, lap_mats = ribbon.build_road(tr, parts, layout.racing_line(tr))
    foot = props.build_buildings(tr, parts)
    info = ground.build_ground(tr, parts, unary_union(foot))
    ground.build_far(tr, parts, info)
    asphalt = unary_union([info["R"], info["A"]])
    paint = marks.build_edge_lines(tr, parts)
    from track import SurfaceLookup
    paved = SurfaceLookup.from_parts(parts, ("1ROAD_trk", "1APRON"))
    pit_boxes = [(d.pos[0], d.pos[2], d.facing) for d in layout.make_dummies(tr, paved)[0] if d.name.startswith("AC_PIT_")]
    paint.update(marks.build_start(tr, parts, layout.grid_slots(), pit_boxes))
    near_buildings = unary_union([f.buffer(3.0) for f in foot])
    paint.update(marks.build_marks(tr, parts, asphalt, near_buildings))             # the real paint, traced from the photo
    props.build_gantry(tr, parts)
    paint["brake_boards"] = props.build_brake_boards(tr, parts)
    span = bridge.build_bridge(tr, parts, info["R"].buffer(1.5))
    pylons = props.build_pylons(tr, parts)
    scenery = props.build_viaduct(tr, parts)
    # the real barriers: tyre walls where the photo shows them, the pit wall, the paddock wall
    pit_wall = props.pit_wall_line(tr)
    barriers = realmap.walls() + [dict(en=pit_wall.tolist(), width=0.3, height=1.05, material="concrete")] + [dict(b, material="concrete") for b in circuit.BARRIERS]
    walls = props.build_tyre_walls(tr, parts, info["R"].buffer(0.3), asphalt, lines=barriers)
    # race equipment of 14.11.2026: tyre stacks at the organiser's yellow dots, bags and tape along each row, and
    # cones along the lap wherever it crosses open asphalt
    race = props.build_tyre_stacks(tr, parts)
    race.update(props.build_cones(tr, parts))
    race.update(props.build_fences(tr, parts, [(pit_wall, 1.05)] + [(bb["en"], bb["height"]) for bb in circuit.BARRIERS]))
    race.update(props.build_tape(tr, parts))
    rows = props.build_tyre_walls(tr, parts, Polygon(), Polygon(), lines=props.race_barrier_lines(tr), min_len=1.0, anywhere=True)
    race.update(rows=len(props.race_rows(tr)), row_barriers=rows["walls"], row_barrier_m=rows["metres"])
    keep_out = unary_union([asphalt.buffer(5.0), info["G"].buffer(2.0), *[f.buffer(2.0) for f in foot]])
    trees = props.build_trees(tr, parts, keep_out)
    tex = textures.build_static()
    tex.update(photo.build(info["covered"], textures.GRASS_MEAN, blend_m=0.5))      # the near grass is photo too: no fade
    for name in ("road_g1.jpg", "road_g2.jpg", "road_g3.jpg"):                      # the racing line is baked into the lap textures
        tex.pop(name, None)
    tex.update(lap_tex)
    tex.update(info["photo_tex"])
    dummies, dinfo = layout.make_dummies(tr, paved)
    meshes = parts.meshes()
    materials = [m for m in MATERIALS if not m.name.startswith("road_g")]
    materials += [M(n_, n_ + ".jpg", specular=0.10, specular_exp=30) for n_ in lap_mats]
    materials += [M(n_, n_ + ".jpg", specular=0.10 if n_.startswith("a") else 0.0, specular_exp=30) for n_ in info["photo_mats"]]
    used = {m.material for m in meshes}
    materials = [m for m in materials if m.name in used]                           # nothing unused goes into the file
    tex = {k_: v_ for k_, v_ in tex.items() if k_ in {m.texture for m in materials}}
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, "ai"), exist_ok=True)
    kn5_path = os.path.join(OUT, f"{TRACK}.kn5")
    kn5.write(kn5_path, TRACK, tex, materials, meshes, dummies)
    ai = layout.write_ai(tr, os.path.join(OUT, "ai", "fast_lane.ai"))
    edges = np.vstack([tr.fr.xz(tr.edge_en(1)), tr.fr.xz(tr.edge_en(-1))])
    layout.write_data(tr, OUT, ai, edges)
    summary = dict(
        track=TRACK, lap_m=tr.lap, meshes=len(meshes), vertices=int(sum(len(m.pos) for m in meshes)),
        triangles=int(sum(len(m.tris) for m in meshes)), kn5_mb=round(os.path.getsize(kn5_path) / 1e6, 2),
        ground=dict(info["tris"], relief_points=info["relief_points"]), asphalt_m2=round(info["apron_area"] + info["R"].area), gravel_m2=round(info["gravel_area"]), buildings=len(foot), bridge=span, pylons=pylons, paint=paint, barriers=walls,
        real=dict(lap_width_m=[round(float((tr.wl + tr.wr).min()), 2), round(float((tr.wl + tr.wr).mean()), 2), round(float((tr.wl + tr.wr).max()), 2)],
                  concrete_m2=round(info["pads"].area), concrete_strip_beside_lap_m=int(tr.kerb_l.sum() + tr.kerb_r.sum()),
                  open_side_m=int(tr.open_l.sum() + tr.open_r.sum()), asphalt_squares=info["asphalt_squares"], lap_textures=len(lap_mats)),
        trees=trees, race=race, scenery=scenery, dummies=len(dummies),
        ai={k: (round(v, 2) if isinstance(v, float) else v) for k, v in ai.items() if k not in ("line", "speed")},
        frame=tr.fr.to_json(), sector_station=dinfo["sector_station"],
    )
    json.dump(summary, open(os.path.join(WORK, "build_summary.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))
    print("built in %.1f s -> %s" % (time.time() - t0, OUT))


if __name__ == "__main__":
    main()
