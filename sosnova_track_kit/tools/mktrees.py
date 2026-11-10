"""Render tree pictures (billboards) from real 3D tree models: front and side view, transparent background.

The models are CC0 scans from Poly Haven (pine_tree_01, fir_tree_01, tree_small_02); they are large and are not
stored in the kit. Download a model as glTF, then:   python3 mktrees.py <model.gltf> <out_prefix> [pixels_per_metre]
Writes <out_prefix>_front.png and <out_prefix>_side.png (RGBA).
"""
from __future__ import annotations

import sys

import bpy
import numpy as np
from mathutils import Vector


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    ppm = float(sys.argv[3]) if len(sys.argv) > 3 else 40.0
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    scene = bpy.context.scene
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for ob in scene.objects:
        if ob.type == "MESH":
            for c in ob.bound_box:
                p = ob.matrix_world @ Vector(c)
                lo, hi = Vector(map(min, lo, p)), Vector(map(max, hi, p))
    size, centre = hi - lo, (lo + hi) / 2
    print("bounds", [round(v, 2) for v in lo], [round(v, 2) for v in hi], flush=True)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 24
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.85, 1.0, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.6           # soft overcast light: no hard baked shadows
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.0
    sun.data.angle = np.radians(20)
    sun.rotation_euler = Vector((0.4, 0.3, 0.86)).normalized().to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.clip_end = 500
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, direction, width in (("front", Vector((0, -1, 0)), size.x), ("side", Vector((1, 0, 0)), size.y)):
        w, h = width * 1.04, size.z * 1.02
        scene.render.resolution_x, scene.render.resolution_y = int(w * ppm), int(h * ppm)
        cam.data.ortho_scale = max(w, h)
        cam.location = centre + direction * 100
        cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{out}_{name}.png"
        scene.render.image_settings.color_mode = "RGBA"
        bpy.ops.render.render(write_still=True)
        print("rendered", name, scene.render.resolution_x, scene.render.resolution_y, flush=True)


if __name__ == "__main__":
    main()
