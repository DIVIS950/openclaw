"""Render driver-eye previews along the lap plus an overview (Workbench, sky background).
Run: python render_tour.py   -> source/previews/*.png"""
import json, math, os
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
SRC = os.path.join(os.path.dirname(HERE), "source")
OUT = os.path.join(SRC, "previews")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, "sosnova.blend"))
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = True
scene.display.shading.shadow_intensity = 0.25
scene.display.shading.use_world_space_lighting = True
scene.display.shading.studiolight_intensity = 1.35
scene.view_settings.exposure = 0.35
scene.display.shading.show_backface_culling = False
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.film_transparent = False
world = bpy.data.worlds.new("sky") if scene.world is None else scene.world
scene.world = world
world.use_nodes = False
world.color = (0.55, 0.72, 0.95)

cam_data = bpy.data.cameras.new("tour")
cam = bpy.data.objects.new("tour", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.clip_end = 3000
cam_data.lens = 24

# lap line from the layout empties is sparse; use the AC_TIME/AC_START positions and the road centre stations in layout.json meta
layout = json.load(open(os.path.join(SRC, "layout.json")))
# reconstruct the centerline from centerline.json via the same projection as build_track
import sys
sys.path.insert(0, HERE)
import numpy as np
from build_track import project, resample_closed, smooth_closed, ensure_ccw
meta = json.load(open(os.path.join(SRC, "cuzk", "meta.json")))
src = json.load(open(os.path.join(SRC, "centerline.json")))
en, _ = project(src["points"], tuple(meta["center"]))
en = ensure_ccw(resample_closed(smooth_closed(resample_closed(en, 1.0), 3), 2.0))
# roll so the lap starts at the first centerline point (the start straight) like the build does
n = len(en)

def ground_z(x, y):
    """Height of the road at (east, north) via a downward ray cast on the scene."""
    deps = bpy.context.evaluated_depsgraph_get()
    hit, loc, nrm, idx, ob, mat = scene.ray_cast(deps, Vector((x, y, 200.0)), Vector((0, 0, -1)))
    return loc.z if hit else 0.0

shots = [("start_straight", 0), ("t1_sweep", 140), ("east_side", 330), ("classic_hairpin", 520), ("handling_s", 700),
         ("centre_loop", 900), ("top_chicane", 1180), ("big_loop_west", 1450), ("pit_straight", 1680)]
for name, s_m in shots:
    i = int(s_m / 2.0) % n
    p = en[i]; q = en[(i + 15) % n]
    fwd = Vector((q[0] - p[0], q[1] - p[1], 0)).normalized()
    z = ground_z(p[0], p[1])
    cam.location = Vector((p[0], p[1], z)) - fwd * 6 + Vector((0, 0, 1.3))
    look = Vector((q[0], q[1], ground_z(q[0], q[1]) + 0.8))
    cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", name)

# high overview from the south-west
cam_data.lens = 28
c = en.mean(axis=0)
cam.location = Vector((c[0] - 420, c[1] - 380, 190))
cam.rotation_euler = (Vector((c[0], c[1], 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = os.path.join(OUT, "overview_sw.png")
bpy.ops.render.render(write_still=True)
print("rendered overview")
