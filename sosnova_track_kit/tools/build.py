"""Build the complete Assetto Corsa track folder content/tracks/sosnova_v2 from the survey data.

    python3 prep.py && python3 geom.py && python3 heights.py && python3 mkbuildings.py   (once)
    python3 build.py
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ground  # noqa: E402
import kn5  # noqa: E402
import layout  # noqa: E402
import props  # noqa: E402
import ribbon  # noqa: E402
import textures  # noqa: E402
from common import OUT, TRACK, WORK  # noqa: E402
from track import Parts, Track  # noqa: E402

M = kn5.Material
MATERIALS = [
    M("road", "road.jpg", specular=0.10, specular_exp=30),
    M("apron", "apron.jpg", specular=0.08, specular_exp=25),
    M("paint", "paint.jpg", specular=0.12, specular_exp=30),
    M("kerb", "kerb.jpg", specular=0.10, specular_exp=30),
    M("grass", "grass.jpg", specular=0.0),
    M("photo", "ground_near.jpg", specular=0.0),
    M("photofar", "ground_far.jpg", specular=0.0),
    M("barrier", "barrier.jpg", specular=0.15, specular_exp=40),
    M("tyre", "tyre.jpg", specular=0.05),
    M("building", "building.jpg"),
    M("roof", "roof.jpg"),
    M("roofwhite", "roofwhite.jpg"),
    M("concrete", "concrete.jpg"),
    M("metal", "metal.jpg", specular=0.2, specular_exp=50),
    M("signs", "signs.jpg"),
    M("tree", "trees.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
    M("forest", "forest.png", shader="ksPerPixelAT", alpha_tested=True, ambient=0.8, diffuse=0.45, specular=0.0),
]


def main() -> None:
    t0 = time.time()
    tr = Track()
    parts = Parts()
    ribbon.build_road(tr, parts)
    ribbon.build_markings(tr, parts, layout.grid_slots())
    kerbs = ribbon.build_kerbs(tr, parts)
    barriers = ribbon.build_barriers(tr, parts)
    info = ground.build_ground(tr, parts)
    ground.build_far(tr, parts, info)
    foot = props.build_buildings(tr, parts)
    props.build_pit_wall(tr, parts)
    props.build_tyres(tr, parts)
    props.build_gantry(tr, parts)
    boards = props.build_boards(tr, parts)
    keep_out = unary_union([info["R"].buffer(7.0), info["A"].buffer(5.0), *[f.buffer(1.5) for f in foot]])
    trees = props.build_trees(tr, parts, keep_out)
    tex = textures.build_static()
    tex["ground_near.jpg"], tex["ground_far.jpg"] = textures.ortho_textures(info["covered"])
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
        kerb_runs=len(kerbs), kerb_m=int(sum(k[2] for k in kerbs)), barrier_runs=len(barriers), barrier_m=int(sum(b[2] for b in barriers)),
        ground=info["tris"], apron_m2=round(info["apron_area"]), buildings=len(foot), boards=boards, trees=trees,
        tyre_stacks=len(tr.cones_en), dummies=len(dummies),
        ai={k: (round(v, 2) if isinstance(v, float) else v) for k, v in ai.items() if k not in ("line", "speed")},
        frame=tr.fr.to_json(), sector_station=dinfo["sector_station"],
    )
    json.dump(summary, open(os.path.join(WORK, "build_summary.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))
    print("built in %.1f s -> %s" % (time.time() - t0, OUT))


if __name__ == "__main__":
    main()
