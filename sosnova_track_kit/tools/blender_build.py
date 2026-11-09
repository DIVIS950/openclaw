"""Assemble the Assetto Corsa scene in Blender and export the FBX for ksEditor.

Run either:
    python blender_build.py                      (needs `pip install bpy`)
    blender --background --python blender_build.py   (with a normal Blender install)
or open Blender, go to the Scripting tab, open this file and press Run Script.

Reads  source/<track>.obj + source/layout.json
Writes source/<track>.fbx and source/<track>.blend
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
KIT = os.path.dirname(HERE)
TRACK = os.environ.get("AC_TRACK", "sosnova")
SRC = os.path.join(KIT, "source")


def ac_to_blender(p: list[float]) -> Vector:
    """AC (x, y up, z) -> Blender (x, y north, z up). AC z = -north."""
    return Vector((p[0], -p[2], p[1]))


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def import_obj(path: str) -> None:
    # Blender's OBJ importer defaults to -Z forward / Y up, which maps AC space onto Blender space.
    bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            # ksEditor wants triangles, one UV map and clean names (the importer may append suffixes)
            ob.data.name = ob.name
            mod = ob.modifiers.new("tri", "TRIANGULATE")
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=mod.name)


def add_empty(name: str, pos_ac: list[float], heading_deg: float | None, size: float = 1.0) -> bpy.types.Object:
    """heading_deg: direction of travel in the Blender XY plane (0 = +X east, CCW positive).
    The empty is rotated so its local +Y axis points along the direction of travel.
    Blender's FBX exporter (-Z forward, Y up) turns local +Y into the FBX/AC local +Z axis."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = size
    e.location = ac_to_blender(pos_ac)
    if heading_deg is not None:
        e.rotation_euler = (0.0, 0.0, math.radians(heading_deg - 90.0))
    bpy.context.scene.collection.objects.link(e)
    return e


def add_layout(layout: dict) -> None:
    for i, p in enumerate(layout["AC_START"]):
        add_empty(f"AC_START_{i}", p["pos_ac"], p["heading_deg_blender"])
    for i, p in enumerate(layout["AC_PIT"]):
        add_empty(f"AC_PIT_{i}", p["pos_ac"], p["heading_deg_blender"])
    for i, p in enumerate(layout.get("AC_CREW", [])):
        add_empty(f"AC_CREW_{i}", p["pos_ac"], p["heading_deg_blender"], 0.5)
    for t in layout["AC_TIME"]:
        add_empty(f"AC_TIME_{t['index']}_L", t["L"]["pos_ac"], None, 0.5)
        add_empty(f"AC_TIME_{t['index']}_R", t["R"]["pos_ac"], None, 0.5)
    for i, p in enumerate(layout["AC_HOTLAP_START"]):
        add_empty(f"AC_HOTLAP_START_{i}", p["pos_ac"], p["heading_deg_blender"])


def fix_materials() -> None:
    """Make sure every material has its texture wired to Base Color (ksEditor reads the diffuse texture)."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            mat.use_nodes = True
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        tex = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"), None)
        if bsdf and tex and not bsdf.inputs["Base Color"].is_linked:
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if bsdf and tex and (mat.name.startswith("tree") or mat.name.startswith("tape")):
            # tree billboards: PNG alpha drives transparency (in ksEditor use ksTree or ksPerPixelAT)
            if not bsdf.inputs["Alpha"].is_linked:
                mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            if hasattr(mat, "blend_method"):
                mat.blend_method = "CLIP"
            mat.use_backface_culling = False


def export(track: str) -> None:
    blend = os.path.join(SRC, f"{track}.blend")
    fbx = os.path.join(SRC, f"{track}.fbx")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.fbx(
        filepath=fbx,
        use_selection=False,
        object_types={"MESH", "EMPTY"},
        axis_forward="-Z",
        axis_up="Y",
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        bake_space_transform=True,
        mesh_smooth_type="FACE",
        use_mesh_modifiers=True,
        use_triangles=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=False,
        use_custom_props=False,
    )
    print(f"wrote {fbx}\nwrote {blend}")


def main() -> None:
    clear_scene()
    import_obj(os.path.join(SRC, f"{TRACK}.obj"))
    with open(os.path.join(SRC, "layout.json"), encoding="utf-8") as f:
        layout = json.load(f)
    add_layout(layout)
    fix_materials()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    empties = [o for o in bpy.context.scene.objects if o.type == "EMPTY"]
    print(f"{len(meshes)} meshes, {len(empties)} empties")
    for o in meshes:
        if len(o.data.vertices) > 65535:
            print(f"WARNING {o.name} has {len(o.data.vertices)} vertices (>65535); split it in Blender", file=sys.stderr)
    export(TRACK)


if __name__ == "__main__":
    main()
