"""Build the complete Assetto Corsa track folder content/tracks/sosnova_v3 from the survey data.

    python3 prep.py && python3 geom.py && python3 heights.py && python3 survey.py && python3 mkbuildings.py   (once)
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
import ground  # noqa: E402
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
GROUND_MAPS = {"txMask": "ground_mask.png", "txDetailR": "detail_asphalt.jpg", "txDetailG": "detail_grass.jpg",
               "txDetailB": "detail_dirt.jpg", "txDetailA": "black.png"}
# the ground photo covers 640 m; the detail layers repeat every 5 m (asphalt) and 4 m (grass, bare ground)
GROUND_PROPS = {"multR": 128.0, "multG": 160.0, "multB": 160.0, "multA": 1.0, "magicMult": 1.0}
MATERIALS = [
    M("asph", "ground_photo.jpg", shader="ksMultilayer", specular=0.10, specular_exp=30, maps=GROUND_MAPS, props=GROUND_PROPS),
    M("grass", "ground_photo.jpg", shader="ksMultilayer", specular=0.0, maps=GROUND_MAPS, props=GROUND_PROPS),
    M("photofar", "ground_far.jpg", specular=0.0),
    M("roofphoto", "roof_photo.jpg", specular=0.05),
    M("paint", "paint.jpg", specular=0.12, specular_exp=30),
    M("deck", "deck.jpg", specular=0.08, specular_exp=25),
    M("concrete", "concrete.jpg"),
    M("building", "building.jpg"),
    M("garage", "garage.jpg"),
    M("hall", "hall.jpg", specular=0.15, specular_exp=40),
    M("hut", "hut.jpg"),
    M("tyrewall", "tyrewall.jpg", specular=0.05),
    M("tree", "trees.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
    M("forest", "forest.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
]


def main() -> None:
    t0 = time.time()
    tr = Track()
    parts = Parts()
    ribbon.build_road(tr, parts)
    info = ground.build_ground(tr, parts)
    ground.build_far(tr, parts, info)
    foot = props.build_buildings(tr, parts)
    asphalt = unary_union([info["R"], info["A"]]).buffer(1.0)      # edge lines sit on the rim of the asphalt
    off_limits = unary_union([Polygon(bridge_geom.footprint(grow=1.0)), *[f.buffer(1.5) for f in foot]])
    paint = marks.build_marks(tr, parts, asphalt, off_limits)
    span = bridge.build_bridge(tr, parts)
    props.build_pit_wall(tr, parts)
    racing = info["R"].buffer(0.6)
    walls = props.build_tyre_walls(tr, parts, racing, unary_union([info["R"], info["A"]]))
    keep_out = unary_union([info["R"].buffer(7.0), info["A"].buffer(4.0), *[f.buffer(2.0) for f in foot]])
    trees = props.build_trees(tr, parts, keep_out)
    tex = textures.build_static()
    tex.update(photo.build())
    dummies, dinfo = layout.make_dummies(tr)
    meshes = parts.meshes()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, "ai"), exist_ok=True)
    kn5_path = os.path.join(OUT, f"{TRACK}.kn5")
    kn5.write(kn5_path, TRACK, tex, MATERIALS, meshes, dummies)
    ai = layout.write_ai(tr, os.path.join(OUT, "ai", "fast_lane.ai"))
    edges = np.vstack([tr.fr.xz(tr.edge_en(1)), tr.fr.xz(tr.edge_en(-1))])
    layout.write_data(tr, OUT, ai, edges)
    summary = dict(
        track=TRACK, lap_m=tr.lap, meshes=len(meshes), vertices=int(sum(len(m.pos) for m in meshes)),
        triangles=int(sum(len(m.tris) for m in meshes)), kn5_mb=round(os.path.getsize(kn5_path) / 1e6, 2),
        ground=info["tris"], asphalt_m2=round(info["apron_area"] + info["R"].area), buildings=len(foot), bridge=span, paint=paint, tyre_walls=walls,
        trees=trees, dummies=len(dummies),
        ai={k: (round(v, 2) if isinstance(v, float) else v) for k, v in ai.items() if k not in ("line", "speed")},
        frame=tr.fr.to_json(), sector_station=dinfo["sector_station"],
    )
    json.dump(summary, open(os.path.join(WORK, "build_summary.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))
    print("built in %.1f s -> %s" % (time.time() - t0, OUT))


if __name__ == "__main__":
    main()
