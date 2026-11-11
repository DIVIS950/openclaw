"""Render check images from the built track exactly as shipped: the kn5 is read back and drawn with Cycles.

Back faces are made invisible, like in the game, so a wrongly wound triangle shows up as a hole.
Cameras sit at the driver's eye on the spawn dummies (looking along the dummy's +Z, the way the car will face)
and along the AI line.   usage: python3 render.py [shot name ...]      output: source/previews_v2/*.png
"""
from __future__ import annotations

import os
import struct
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kn5  # noqa: E402
from common import OUT, SRC, TRACK  # noqa: E402

PREV = os.path.join(SRC, "previews_v2")


def to_bl(p):
    """AC (x left, y up, z forward) -> Blender (x forward, y left, z up); a pure rotation."""
    p = np.asarray(p, float)
    return np.stack([p[..., 2], p[..., 0], p[..., 1]], -1)


def load_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    k = kn5.read(os.path.join(OUT, f"{TRACK}.kn5"))
    tmp = tempfile.mkdtemp(prefix="kn5tex_")
    images = {}
    for name, data in k["textures"]:
        path = os.path.join(tmp, name)
        open(path, "wb").write(data)
        images[name] = bpy.data.images.load(path)
    mats = []
    for m in k["materials"]:
        mat = bpy.data.materials.new(m["name"])
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.85
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = images[m["maps"]["txDiffuse"]]
        colour = tex.outputs["Color"]
        if m["shader"].lower() == "ksmultilayer":
            # colour = photo x (sum of mask channel x tiled detail) x magicMult, as the game shader does
            uv = nt.nodes.new("ShaderNodeTexCoord")
            mask = nt.nodes.new("ShaderNodeTexImage")
            mask.image = images[m["maps"]["txMask"]]
            mask.image.colorspace_settings.name = "Non-Color"
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(mask.outputs["Color"], sep.inputs["Color"])
            total = None
            for ch, sock in (("R", sep.outputs[0]), ("G", sep.outputs[1]), ("B", sep.outputs[2]), ("A", mask.outputs["Alpha"])):
                name = m["maps"].get("txDetail" + ch)
                if not name:
                    continue
                mp = nt.nodes.new("ShaderNodeMapping")
                rep = float(m["props"].get("mult" + ch, 1.0))
                mp.inputs["Scale"].default_value = (rep, rep, 1.0)
                nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
                det = nt.nodes.new("ShaderNodeTexImage")
                det.image = images[name]
                nt.links.new(mp.outputs["Vector"], det.inputs["Vector"])
                sc = nt.nodes.new("ShaderNodeVectorMath")
                sc.operation = "SCALE"
                nt.links.new(det.outputs["Color"], sc.inputs[0])
                nt.links.new(sock, sc.inputs["Scale"])
                if total is None:
                    total = sc.outputs[0]
                else:
                    add = nt.nodes.new("ShaderNodeVectorMath")
                    add.operation = "ADD"
                    nt.links.new(total, add.inputs[0])
                    nt.links.new(sc.outputs[0], add.inputs[1])
                    total = add.outputs[0]
            mul = nt.nodes.new("ShaderNodeVectorMath")
            mul.operation = "MULTIPLY"
            nt.links.new(tex.outputs["Color"], mul.inputs[0])
            nt.links.new(total, mul.inputs[1])
            mm = nt.nodes.new("ShaderNodeVectorMath")
            mm.operation = "SCALE"
            mm.inputs["Scale"].default_value = float(m["props"].get("magicMult", 1.0))
            nt.links.new(mul.outputs[0], mm.inputs[0])
            colour = mm.outputs[0]
        nt.links.new(colour, bsdf.inputs["Base Color"])
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        transp = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(bsdf.outputs["BSDF"], mix.inputs[1])
        nt.links.new(transp.outputs["BSDF"], mix.inputs[2])
        if m["alpha_tested"]:
            mix.inputs[0].default_value = 0.0        # billboards carry both windings; draw them two-sided
            gt = nt.nodes.new("ShaderNodeMath")
            gt.operation = "GREATER_THAN"
            gt.inputs[1].default_value = 0.5
            nt.links.new(tex.outputs["Alpha"], gt.inputs[0])
            nt.links.new(gt.outputs[0], bsdf.inputs["Alpha"])
        else:
            nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        mats.append(mat)
    dummies = {}
    for n in k["nodes"]:
        if n["cls"] == 1 and n["depth"] == 1:
            dummies[n["name"]] = n["matrix"].astype(float)
        if n["cls"] != 2:
            continue
        v = n["vertices"]
        tris = n["indices"].reshape(-1, 3).astype(int)
        me = bpy.data.meshes.new(n["name"])
        me.from_pydata(to_bl(v["pos"]).tolist(), [], tris.tolist())
        uv = v["uv"].astype(float).copy()
        uv[:, 1] = 1.0 - uv[:, 1]
        layer = me.uv_layers.new(name="uv")
        layer.data.foreach_set("uv", uv[tris.ravel()].ravel())
        me.polygons.foreach_set("use_smooth", [True] * len(tris))
        me.normals_split_custom_set_from_vertices(to_bl(v["normal"]).tolist())
        me.materials.append(mats[n["material"]])
        ob = bpy.data.objects.new(n["name"], me)
        scene.collection.objects.link(ob)
    return scene, dummies


def read_ai():
    b = open(os.path.join(OUT, "ai", "fast_lane.ai"), "rb").read()
    n = struct.unpack_from("<4i", b, 0)[1]
    rec = np.frombuffer(b, np.dtype([("p", "<f4", 3), ("d", "<f4"), ("i", "<i4")]), n, 16)
    return rec["p"].astype(float)


def setup(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 28
    scene.cycles.max_bounces = 3
    scene.cycles.transparent_max_bounces = 12
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    for vt in ("Filmic", "AgX", "Standard"):                   # a photographic tone curve, where this Blender has one
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    try:
        scene.view_settings.look = "Medium High Contrast" if scene.view_settings.view_transform == "Filmic" else "AgX - Medium High Contrast"
    except TypeError:
        pass
    # daylight: a physical sky for the ambient light and the horizon haze, and a sun lamp from the south-west
    to_sun = np.array([0.45, 0.75, -0.48]) / np.linalg.norm([0.45, 0.75, -0.48])
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    ok = False
    for kind in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING", "HOSEK_WILKIE"):
        try:
            sky.sky_type = kind
            ok = True
            break
        except TypeError:
            continue
    sun_bl = Vector(to_bl(to_sun)).normalized()
    for attr, val in (("sun_disc", False), ("sun_elevation", float(np.arcsin(sun_bl.z))), ("sun_rotation", float(np.arctan2(sun_bl.x, sun_bl.y))),
                      ("air_density", 1.0), ("aerosol_density", 1.0), ("dust_density", 1.0), ("ozone_density", 1.0), ("altitude", 250.0)):
        try:
            setattr(sky, attr, val)
        except (AttributeError, TypeError):
            pass
    try:
        sky.sun_direction = sun_bl
        sky.turbidity = 3.5
    except (AttributeError, TypeError):
        pass
    if ok:
        nt.links.new(sky.outputs[0], bg.inputs[0])
        bg.inputs[1].default_value = 0.17 if sky.sky_type != "HOSEK_WILKIE" else 1.0
    else:
        bg.inputs[0].default_value = (0.50, 0.68, 0.95, 1.0)
        bg.inputs[1].default_value = 1.1
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.6
    sun.color = (1.0, 0.96, 0.88)
    sun.angle = np.radians(1.2)
    so = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = sun_bl.to_track_quat("Z", "Y").to_euler()
    scene.view_settings.exposure = -0.15
    cam_data = bpy.data.cameras.new("cam")
    cam_data.clip_start, cam_data.clip_end = 0.2, 6000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def aim(cam, eye_ac, target_ac, fov_deg=75.0):
    eye, tgt = Vector(to_bl(eye_ac)), Vector(to_bl(target_ac))
    cam.location = eye
    cam.rotation_euler = (tgt - eye).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "PERSP"
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.angle = np.radians(fov_deg)


def main() -> None:
    os.makedirs(PREV, exist_ok=True)
    wanted = set(sys.argv[1:])
    scene, dummies = load_scene()
    cam = setup(scene)
    ai = read_ai()
    n = len(ai)
    up = np.array([0.0, 1.0, 0.0])
    shots = []
    for name in ("AC_START_0", "AC_START_15", "AC_PIT_0", "AC_PIT_8", "AC_HOTLAP_START_0"):
        m = dummies[name]
        eye = m[3, :3] + up * 1.05
        shots.append((name.lower(), eye, eye + m[2, :3] * 30 - up * 1.5, 75))
    for st in (60, 130, 215, 320, 400, 480, 560, 600, 615, 650, 750, 860, 925, 1000, 1150, 1300, 1450, 1560, 1640):   # metres along the lap
        i = int(st / 1764 * n) % n
        j = (i + 14) % n
        d = ai[j] - ai[i]
        d /= np.linalg.norm(d)
        shots.append((f"lap_{st:04d}", ai[i] + up * 1.05 - d * 0.5, ai[j] + up * 0.5, 75))
    shots.append(("chase_grid", np.array([0.0, 7.0, -92.0]), np.array([0.0, 0.0, -20.0]), 60))
    shots.append(("overview", np.array([-420.0, 330.0, -250.0]), np.array([20.0, 0.0, 60.0]), 55))
    # the overpass: from the side, and from the driver's seat on its ramp
    import bridge_geom as bg
    from track import Track
    tr = Track()
    mid = tr.fr.world(bg.point(np.array([bg.LENGTH / 2]), np.array([0.0])), tr.H.ground(bg.point(np.array([bg.LENGTH / 2]), np.array([0.0]))))[0]
    side = tr.fr.vec(bg.LEFT[None, :])[0]
    shots.append(("bridge_side", mid + np.array([-side[0] * 38, 9.0, -side[1] * 38]) + np.array([12.0, 0, 0]), mid + up * 2.0, 55))
    foot = tr.fr.world(bg.point(np.array([-9.0, 14.0]), np.array([0.0, 0.0])), tr.H.ground(bg.point(np.array([-9.0, 14.0]), np.array([0.0, 0.0]))))
    shots.append(("bridge_ramp", foot[0] + up * 1.1, foot[1] + up * 4.0, 75))
    # the original circuit outside the lap: from the air, and from a car on each of its roads
    import circuit

    def at(e, n, h):
        en = np.array([[float(e), float(n)]])
        return tr.fr.world(en, tr.H.ground(en))[0] + up * h
    for name, eye, tgt in (("air_start", (45, -125, 70), (65, -22)), ("air_plaza", (-75, 15, 60), (12, 76)), ("air_east", (235, -75, 60), (150, -8)),
                           ("air_sw", (-105, -115, 50), (-33, -42)), ("air_paddock", (-190, -60, 70), (-70, 0))):
        shots.append((name, at(*eye), at(*tgt, 0.0), 60))
    for rname, en, _w in circuit.roads():
        for frac in (0.12, 0.5):
            i = int(frac * len(en))
            j = min(len(en) - 1, i + 28)
            shots.append((f"road_{rname}_{int(frac * 100):02d}", at(*en[i], 1.05), at(*en[j], 0.5), 75))
    for name, eye, tgt, fov in shots:
        if wanted and name not in wanted:
            continue
        aim(cam, eye, tgt, fov)
        scene.render.filepath = os.path.join(PREV, name + ".png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name, flush=True)
        if name == "chase_grid":                     # also used as the picture in the track selection menu
            from PIL import Image
            Image.open(scene.render.filepath).convert("RGB").resize((355, 200), Image.LANCZOS).save(os.path.join(OUT, "ui", "preview.png"))
    if not wanted or "top" in wanted:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 720
        cam.location = Vector(to_bl(np.array([0.0, 900.0, 60.0])))
        # looking straight down with +Z (the start direction) up the picture and +X (driver's left) to the left
        cam.rotation_euler = Matrix(((0, -1, 0), (1, 0, 0), (0, 0, 1))).to_euler()
        scene.render.resolution_x, scene.render.resolution_y = 1400, 1400
        scene.render.filepath = os.path.join(PREV, "top.png")
        bpy.ops.render.render(write_still=True)
        print("rendered top", flush=True)


if __name__ == "__main__":
    main()
