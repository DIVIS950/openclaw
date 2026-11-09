"""Render a top-down and a low-angle check image of source/<track>.blend (Workbench, fast).
Run: python render_check.py   or   blender --background --python render_check.py
Writes source/preview_top.png and source/preview_drive.png"""
import math, os
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
SRC = os.path.join(os.path.dirname(HERE), "source")
TRACK = os.environ.get("AC_TRACK", "sosnova")
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, f"{TRACK}.blend"))
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_backface_culling = True   # back faces vanish -> flipped normals show as holes
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.render.film_transparent = False

meshes = [o for o in scene.objects if o.type == "MESH" and not o.name.startswith("1GRASS_ground")]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), 0))
centre, size = (lo + hi) / 2, max(hi.x - lo.x, hi.y - lo.y)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * 1.1
cam.location = centre + Vector((0, 0, 500))
cam.rotation_euler = (0, 0, 0)
cam_data.clip_end = 2000
scene.render.filepath = os.path.join(SRC, "preview_top.png")
bpy.ops.render.render(write_still=True)

# low angle view at the start/finish line looking down the straight
sf = scene.objects.get("AC_TIME_0_L")
start = scene.objects.get("AC_START_0")
if sf and start:
    cam_data.type = "PERSP"
    cam_data.lens = 28
    fwd = (sf.location - start.location)
    fwd.z = 0
    fwd.normalize()
    cam.location = start.location - fwd * 25 + Vector((0, 0, 6))
    look = start.location + fwd * 40
    cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(SRC, "preview_drive.png")
    bpy.ops.render.render(write_still=True)
print("rendered")
