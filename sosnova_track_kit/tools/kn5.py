"""Assetto Corsa .kn5 writer and reader (version 5, textures embedded).

Conventions (checked against a working track):
  * right-handed space, +Y up; triangles are counter-clockwise seen from the side their normal points to
  * a dummy node is a 4x4 matrix whose rows are local X, local Y (up), local Z (the way a car faces), position
  * meshes hold at most 65535 vertices (16-bit indices)
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

VERTEX = np.dtype([("pos", "<f4", 3), ("normal", "<f4", 3), ("uv", "<f4", 2), ("tangent", "<f4", 3)])
MAX_VERTS = 65535


@dataclass
class Material:
    name: str
    texture: str
    shader: str = "ksPerPixel"
    alpha_tested: bool = False
    ambient: float = 0.55
    diffuse: float = 0.6
    specular: float = 0.05
    specular_exp: float = 20.0
    emissive: float = 0.0
    alpha_ref: float = 0.5


@dataclass
class Mesh:
    name: str
    material: str
    pos: np.ndarray            # (n, 3)
    normal: np.ndarray         # (n, 3)
    uv: np.ndarray             # (n, 2), v measured upwards (flipped on write)
    tris: np.ndarray           # (m, 3) int
    cast_shadows: bool = True
    transparent: bool = False

    def __post_init__(self):
        self.pos = np.asarray(self.pos, np.float64).reshape(-1, 3)
        self.normal = np.asarray(self.normal, np.float64).reshape(-1, 3)
        self.uv = np.asarray(self.uv, np.float64).reshape(-1, 2)
        self.tris = np.asarray(self.tris, np.int64).reshape(-1, 3)
        assert len(self.pos) == len(self.normal) == len(self.uv), self.name
        assert len(self.pos) <= MAX_VERTS, f"{self.name}: {len(self.pos)} vertices"
        assert self.tris.size == 0 or (self.tris.min() >= 0 and self.tris.max() < len(self.pos)), self.name
        assert np.isfinite(self.pos).all() and np.isfinite(self.normal).all() and np.isfinite(self.uv).all(), self.name


@dataclass
class Dummy:
    name: str
    pos: tuple
    facing: tuple = (0.0, 0.0, 1.0)   # direction the car faces (local +Z)

    def matrix(self) -> list[float]:
        z = np.asarray(self.facing, float)
        z = z / np.linalg.norm(z)
        y = np.array([0.0, 1.0, 0.0])
        x = np.cross(y, z)
        x /= np.linalg.norm(x)
        y = np.cross(z, x)
        return [*x, 0.0, *y, 0.0, *z, 0.0, *map(float, self.pos), 1.0]


class _W:
    def __init__(self):
        self.parts: list[bytes] = []

    def s(self, text: str):
        b = text.encode("utf-8")
        self.parts.append(struct.pack("<i", len(b)) + b)

    def i(self, v: int):
        self.parts.append(struct.pack("<i", int(v)))

    def u8(self, v: int):
        self.parts.append(struct.pack("<B", int(v)))

    def f(self, *vals: float):
        self.parts.append(struct.pack(f"<{len(vals)}f", *vals))

    def raw(self, b: bytes):
        self.parts.append(b)


IDENTITY = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _tangents(normal: np.ndarray) -> np.ndarray:
    ref = np.where(np.abs(normal[:, 1:2]) > 0.9, np.array([[0.0, 0.0, 1.0]]), np.array([[0.0, 1.0, 0.0]]))
    t = np.cross(ref, normal)
    return t / np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)


def write(path: str, root_name: str, textures: dict[str, bytes], materials: list[Material],
          meshes: list[Mesh], dummies: list[Dummy]) -> None:
    w = _W()
    w.raw(b"sc6969")
    w.i(5)
    used = {m.texture for m in materials}
    tex = [(n, d) for n, d in textures.items() if n in used]
    assert used <= set(textures), f"missing textures: {used - set(textures)}"
    w.i(len(tex))
    for name, data in tex:
        w.i(1)
        w.s(name)
        w.i(len(data))
        w.raw(data)
    w.i(len(materials))
    mat_id = {}
    for k, m in enumerate(materials):
        mat_id[m.name] = k
        w.s(m.name)
        w.s(m.shader)
        w.u8(0)                       # blend: opaque
        w.u8(1 if m.alpha_tested else 0)
        w.i(0)                        # depth mode: normal
        props = [("ksAmbient", m.ambient), ("ksDiffuse", m.diffuse), ("ksSpecular", m.specular),
                 ("ksSpecularEXP", m.specular_exp), ("ksEmissive", m.emissive), ("ksAlphaRef", m.alpha_ref),
                 ("diffuseMult", 1.0), ("normalMult", 1.0), ("useDetail", 0.0), ("detailUVMultiplier", 1.0)]
        w.i(len(props))
        for pn, pv in props:
            w.s(pn)
            w.f(pv)
            w.f(0, 0)
            w.f(0, 0, 0)
            w.f(0, 0, 0, 0)
        w.i(1)
        w.s("txDiffuse")
        w.i(0)
        w.s(m.texture)
    w.i(1)
    w.s(root_name)
    w.i(len(dummies) + len(meshes))
    w.u8(1)
    w.f(*IDENTITY)
    for d in dummies:
        w.i(1)
        w.s(d.name)
        w.i(0)
        w.u8(1)
        w.f(*d.matrix())
    for m in meshes:
        v = np.zeros(len(m.pos), VERTEX)
        n = m.normal / np.maximum(np.linalg.norm(m.normal, axis=1, keepdims=True), 1e-9)
        v["pos"], v["normal"] = m.pos, n
        v["uv"] = np.column_stack([m.uv[:, 0], 1.0 - m.uv[:, 1]])
        v["tangent"] = _tangents(n)
        lo, hi = m.pos.min(0), m.pos.max(0)
        c = (lo + hi) / 2
        r = float(np.linalg.norm(m.pos - c, axis=1).max())
        w.i(2)
        w.s(m.name)
        w.i(0)
        w.u8(1)
        w.u8(1 if m.cast_shadows else 0)
        w.u8(1)                       # visible
        w.u8(1 if m.transparent else 0)
        w.i(len(v))
        w.raw(v.tobytes())
        w.i(m.tris.size)
        w.raw(m.tris.astype("<u2").tobytes())
        w.i(mat_id[m.material])
        w.i(0)                        # layer
        w.f(0.0, 0.0)                 # lod in / out
        w.f(*c, r)
        w.u8(1)                       # renderable
    with open(path, "wb") as f:
        f.write(b"".join(w.parts))


def read(path: str, with_meshes: bool = True) -> dict:
    b = open(path, "rb").read()
    pos = [0]

    def take(fmt):
        v = struct.unpack_from(fmt, b, pos[0])
        pos[0] += struct.calcsize(fmt)
        return v if len(v) > 1 else v[0]

    def string():
        n = take("<i")
        s = b[pos[0]:pos[0] + n].decode("utf-8", "replace")
        pos[0] += n
        return s

    assert b[:6] == b"sc6969", "not a kn5"
    pos[0] = 6
    version = take("<i")
    if version > 5:
        take("<i")
    textures = []
    for _ in range(take("<i")):
        take("<i")
        name = string()
        size = take("<i")
        textures.append((name, b[pos[0]:pos[0] + size]))
        pos[0] += size
    materials = []
    for _ in range(take("<i")):
        name, shader = string(), string()
        blend, at, depth = take("<B"), take("<B"), take("<i")
        props = {}
        for _ in range(take("<i")):
            pn = string()
            props[pn] = take("<f")
            pos[0] += 36
        maps = {}
        for _ in range(take("<i")):
            mn = string()
            take("<i")
            maps[mn] = string()
        materials.append(dict(name=name, shader=shader, blend=blend, alpha_tested=at, depth=depth, props=props, maps=maps))
    nodes = []

    def node(depth):
        cls = take("<i")
        name = string()
        nchildren = take("<i")
        take("<B")
        n = dict(cls=cls, name=name, depth=depth)
        if cls == 1:
            n["matrix"] = np.array(take("<16f")).reshape(4, 4)
        elif cls == 2:
            n["flags"] = take("<BBB")
            nv = take("<i")
            if with_meshes:
                n["vertices"] = np.frombuffer(b, VERTEX, nv, pos[0])
            pos[0] += nv * VERTEX.itemsize
            ni = take("<i")
            if with_meshes:
                n["indices"] = np.frombuffer(b, "<u2", ni, pos[0])
            pos[0] += ni * 2
            n["material"], n["layer"] = take("<i"), take("<i")
            n["lod"] = take("<ff")
            n["bs"] = take("<3ff")
            n["renderable"] = take("<B")
            n["nv"], n["ni"] = nv, ni
        else:
            raise ValueError(f"node class {cls} ({name}) not supported")
        nodes.append(n)
        for _ in range(nchildren):
            node(depth + 1)

    node(0)
    return dict(version=version, textures=textures, materials=materials, nodes=nodes, end=pos[0], size=len(b))


def split_mesh(name: str, material: str, pos, normal, uv, tris, max_verts: int = 60000, **kw) -> list[Mesh]:
    """Split a big triangle soup into meshes below the vertex limit (triangles kept in their given order)."""
    pos, normal, uv, tris = np.asarray(pos, float), np.asarray(normal, float), np.asarray(uv, float), np.asarray(tris, np.int64)
    out, start, k = [], 0, 0
    per = max_verts // 3
    while start < len(tris) or (k == 0 and len(tris) == 0):
        if len(tris) == 0:
            break
        # grow the chunk until its unique vertex count reaches the limit
        end = min(len(tris), start + per)
        while end < len(tris):
            nxt = min(len(tris), end + per)
            if len(np.unique(tris[start:nxt])) > max_verts:
                break
            end = nxt
        t = tris[start:end]
        ids, inv = np.unique(t, return_inverse=True)
        out.append(Mesh(f"{name}_{k:02d}" if (end < len(tris) or k) else name, material, pos[ids], normal[ids], uv[ids],
                        inv.reshape(-1, 3), **kw))
        start, k = end, k + 1
    return out
