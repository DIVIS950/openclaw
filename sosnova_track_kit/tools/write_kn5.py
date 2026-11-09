#!/usr/bin/env python3
"""Write an Assetto Corsa .kn5 directly from the generated OBJ/MTL + layout.json (no ksEditor needed).

kn5 format (version 5, as documented by the modding community and used by the Blender kn5 add-ons):
  "sc6969" + int32 version
  textures:  int32 count, then per texture: int32 active, str name, int32 size, bytes
  materials: int32 count, then per material: str name, str shader, u8 alphaBlendMode, u8 alphaTested,
             int32 depthMode, int32 propCount, props (str name, f32 a, f32[2] b, f32[3] c, f32[4] d),
             int32 texCount, textures (str sampler, int32 slot, str textureName)
  nodes (recursive): int32 type, str name, int32 childCount, u8 active, then
             type 1 (dummy): f32[16] matrix (row-major, translation in the last row)
             type 2 (mesh):  u8 castShadows, u8 visible, u8 transparent, int32 vertexCount,
                             vertices (pos f32[3], normal f32[3], uv f32[2], tangent f32[3]),
                             int32 indexCount, u16 indices, int32 materialId, int32 layer,
                             f32 lodIn, f32 lodOut, f32[3] sphereCenter, f32 sphereRadius, u8 isRenderable
Strings are int32 length + bytes. Coordinates are kept exactly as in the OBJ (the AC space the kit
generates: x east, y up, z = -north); UV v is flipped to the DirectX convention.

Usage: python write_kn5.py [--obj source/sosnova.obj] [--layout source/layout.json] [--out content/tracks/sosnova/sosnova.kn5]
"""
from __future__ import annotations

import argparse
import math
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)

SHADERS = {  # material -> (shader, alphaTested, extra props)
    "tree": ("ksTree", 1, {"ksAlphaRef": 0.45}),
    "tape": ("ksPerPixelAT", 1, {"ksAlphaRef": 0.4}),
    "aerial": ("ksPerPixel", 0, {"ksSpecular": 0.05, "ksSpecularEXP": 10.0}),
    "road": ("ksPerPixel", 0, {"ksSpecular": 0.35, "ksSpecularEXP": 30.0}),
    "roadlow": ("ksPerPixel", 0, {"ksSpecular": 0.5, "ksSpecularEXP": 40.0}),
    "grass": ("ksPerPixel", 0, {"ksSpecular": 0.02, "ksSpecularEXP": 10.0}),
    "ground": ("ksPerPixel", 0, {"ksSpecular": 0.02, "ksSpecularEXP": 10.0}),
}
DEFAULT_PROPS = {"ksAmbient": 0.45, "ksDiffuse": 0.45, "ksSpecular": 0.2, "ksSpecularEXP": 50.0, "ksAlphaRef": 0.0,
                 "diffuseMult": 1.0, "normalMult": 1.0, "useDetail": 0.0, "detailUVMultiplier": 1.0}


class W:
    def __init__(self) -> None:
        self.b = bytearray()

    def s(self, text: str) -> None:
        data = text.encode("utf-8")
        self.b += struct.pack("<i", len(data)) + data

    def i(self, v: int) -> None:
        self.b += struct.pack("<i", v)

    def u8(self, v: int) -> None:
        self.b += struct.pack("<B", v)

    def f(self, *vals: float) -> None:
        self.b += struct.pack(f"<{len(vals)}f", *vals)

    def raw(self, data: bytes) -> None:
        self.b += data


def read_obj(path: str):
    v, vt, vn = [], [], []
    objects: list[tuple[str, str, list[tuple[tuple[int, int, int], ...]]]] = []
    cur_name, cur_mat, faces = None, None, []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                v.append(tuple(map(float, line.split()[1:4])))
            elif line.startswith("vt "):
                vt.append(tuple(map(float, line.split()[1:3])))
            elif line.startswith("vn "):
                vn.append(tuple(map(float, line.split()[1:4])))
            elif line.startswith("o "):
                if cur_name is not None:
                    objects.append((cur_name, cur_mat, faces))
                cur_name, cur_mat, faces = line[2:].strip(), None, []
            elif line.startswith("usemtl "):
                cur_mat = line.split()[1]
            elif line.startswith("f "):
                corners = []
                for tok in line.split()[1:]:
                    parts = tok.split("/")
                    corners.append((int(parts[0]) - 1, int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1, int(parts[2]) - 1 if len(parts) > 2 and parts[2] else -1))
                faces.append(tuple(corners))
    if cur_name is not None:
        objects.append((cur_name, cur_mat, faces))
    return np.array(v, np.float32), np.array(vt, np.float32), np.array(vn, np.float32), objects


def read_mtl(path: str) -> dict[str, str]:
    mats, cur = {}, None
    with open(path) as f:
        for line in f:
            if line.startswith("newmtl "):
                cur = line.split()[1]
                mats[cur] = ""
            elif line.startswith("map_Kd ") and cur:
                mats[cur] = line.split(None, 1)[1].strip()
    return mats


def mesh_arrays(v, vt, vn, faces):
    """Triangulate faces (fan), build a per-object vertex buffer with (pos, normal, uv) uniqueness."""
    index_of: dict[tuple[int, int, int], int] = {}
    verts: list[tuple[int, int, int]] = []
    tris: list[int] = []
    for face in faces:
        ids = []
        for key in face:
            if key not in index_of:
                index_of[key] = len(verts)
                verts.append(key)
            ids.append(index_of[key])
        for k in range(1, len(ids) - 1):
            tris += [ids[0], ids[k], ids[k + 1]]
    pos = np.array([v[k[0]] for k in verts], np.float32)
    uv = np.array([vt[k[1]] if k[1] >= 0 else (0.0, 0.0) for k in verts], np.float32)
    nrm = np.array([vn[k[2]] if k[2] >= 0 else (0.0, 1.0, 0.0) for k in verts], np.float32)
    uv[:, 1] = 1.0 - uv[:, 1]  # DirectX: v grows downwards
    # tangents: any unit vector perpendicular to the normal is fine for shaders without normal maps
    up = np.where(np.abs(nrm[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]], np.float32), np.array([[1.0, 0.0, 0.0]], np.float32))
    tan = np.cross(up, nrm)
    tan /= np.maximum(np.linalg.norm(tan, axis=1)[:, None], 1e-6)
    return pos, nrm, uv, tan.astype(np.float32), np.array(tris, np.uint16)


def dummy_matrix(pos_ac, heading_blender_deg: float | None) -> list[float]:
    """Row-major 4x4 with translation in the last row. Local -Z points along the direction of travel
    (same orientation the Blender/FBX path produces, see register of AC_START in the kit)."""
    if heading_blender_deg is None:
        rx, ry, rz = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    else:
        a = math.radians(heading_blender_deg)
        t = (math.cos(a), 0.0, -math.sin(a))  # travel direction in AC space (east, up, -north)
        rz = (-t[0], 0.0, -t[2])
        ry = (0.0, 1.0, 0.0)
        rx = (-rz[2], 0.0, rz[0])  # Y x Z
    x, y, z = pos_ac
    return [*rx, 0.0, *ry, 0.0, *rz, 0.0, x, y, z, 1.0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--obj", default=os.path.join(KIT, "source", "sosnova.obj"))
    ap.add_argument("--layout", default=os.path.join(KIT, "source", "layout.json"))
    ap.add_argument("--out", default=os.path.join(KIT, "content", "tracks", "sosnova", "sosnova.kn5"))
    a = ap.parse_args()
    import json

    v, vt, vn, objects = read_obj(a.obj)
    mtl = read_mtl(os.path.splitext(a.obj)[0] + ".mtl")
    layout = json.load(open(a.layout))
    src_dir = os.path.dirname(a.obj)

    w = W()
    w.raw(b"sc6969")
    w.i(5)

    # textures (embedded files, keep their own format: AC loads DDS/PNG/JPG)
    tex_names = []
    for m, tex in mtl.items():
        if tex and tex not in tex_names:
            tex_names.append(tex)
    w.i(len(tex_names))
    for tex in tex_names:
        data = open(os.path.join(src_dir, tex), "rb").read()
        w.i(1)
        w.s(os.path.basename(tex))
        w.i(len(data))
        w.raw(data)

    # materials
    mat_ids = {m: i for i, m in enumerate(mtl)}
    w.i(len(mtl))
    for m, tex in mtl.items():
        shader, alpha_tested, extra = SHADERS.get(m, ("ksPerPixel", 0, {}))
        props = dict(DEFAULT_PROPS)
        props.update(extra)
        w.s(m)
        w.s(shader)
        w.u8(0)  # alphaBlendMode: opaque
        w.u8(alpha_tested)
        w.i(0)  # depthMode
        w.i(len(props) + 1)
        for name, val in props.items():
            w.s(name)
            w.f(val)
            w.f(0.0, 0.0)
            w.f(0.0, 0.0, 0.0)
            w.f(0.0, 0.0, 0.0, 0.0)
        w.s("ksEmissive")
        w.f(0.0)
        w.f(0.0, 0.0)
        w.f(0.0, 0.0, 0.0)
        w.f(0.0, 0.0, 0.0, 0.0)
        if tex:
            w.i(1)
            w.s("txDiffuse")
            w.i(0)
            w.s(os.path.basename(tex))
        else:
            w.i(0)

    # nodes: root dummy -> meshes + layout dummies
    dummies = []
    for k, p in enumerate(layout["AC_START"]):
        dummies.append((f"AC_START_{k}", p["pos_ac"], p["heading_deg_blender"]))
    for k, p in enumerate(layout["AC_PIT"]):
        dummies.append((f"AC_PIT_{k}", p["pos_ac"], p["heading_deg_blender"]))
    for k, p in enumerate(layout.get("AC_CREW", [])):
        dummies.append((f"AC_CREW_{k}", p["pos_ac"], p["heading_deg_blender"]))
    for t in layout["AC_TIME"]:
        dummies.append((f"AC_TIME_{t['index']}_L", t["L"]["pos_ac"], None))
        dummies.append((f"AC_TIME_{t['index']}_R", t["R"]["pos_ac"], None))
    for k, p in enumerate(layout["AC_HOTLAP_START"]):
        dummies.append((f"AC_HOTLAP_START_{k}", p["pos_ac"], p["heading_deg_blender"]))

    w.i(1)
    w.s("sosnova")
    w.i(len(objects) + len(dummies))
    w.u8(1)
    w.f(*[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

    total_tris = 0
    for name, mat, faces in objects:
        pos, nrm, uv, tan, tris = mesh_arrays(v, vt, vn, faces)
        if len(pos) > 65535:
            raise SystemExit(f"{name}: {len(pos)} vertices > 65535, split the object")
        centre = (pos.min(0) + pos.max(0)) / 2
        radius = float(np.linalg.norm(pos - centre, axis=1).max())
        w.i(2)
        w.s(name)
        w.i(0)
        w.u8(1)
        w.u8(1)  # castShadows
        w.u8(1)  # visible
        w.u8(0)  # transparent
        w.i(len(pos))
        inter = np.hstack([pos, nrm, uv, tan]).astype("<f4")
        w.raw(inter.tobytes())
        w.i(len(tris))
        w.raw(tris.astype("<u2").tobytes())
        w.i(mat_ids.get(mat, 0))
        w.i(0)  # layer
        w.f(0.0, 0.0)  # lodIn, lodOut (0 = always)
        w.f(*map(float, centre), radius)
        w.u8(1)  # isRenderable
        total_tris += len(tris) // 3

    for name, pos_ac, heading in dummies:
        w.i(1)
        w.s(name)
        w.i(0)
        w.u8(1)
        w.f(*dummy_matrix(pos_ac, heading))

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "wb") as f:
        f.write(w.b)
    print(f"wrote {a.out}: {len(w.b) / 1e6:.1f} MB, {len(objects)} meshes, {total_tris} triangles, {len(dummies)} dummies, {len(tex_names)} textures, {len(mtl)} materials")


if __name__ == "__main__":
    main()
