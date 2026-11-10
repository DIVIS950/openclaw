"""Track model shared by the mesh builders: centreline, widths, heights, world frame, mesh helpers."""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK, Frame, closed_frames  # noqa: E402
from heights import Heights  # noqa: E402
from kn5 import Mesh, split_mesh  # noqa: E402

SHOULDER = 1.2      # flat verge outside both road edges (m); kerbs and barriers stand on it
PIT_Z = (-36.0, 74.0)   # stretch of the start straight whose left side stays open towards the pit apron


class Track:
    def __init__(self, lap: str = ""):
        from common import lap_file
        self.lap_name = lap
        cl = json.load(open(lap_file("centerline", "json", lap), encoding="utf-8"))
        self.c = np.array(cl["en"])
        self.n = len(self.c)
        self.tan, self.nrm, _, _ = closed_frames(self.c)
        self.k = np.array(cl["curv"])
        self.wl, self.wr = np.array(cl["wl"]), np.array(cl["wr"])
        self.open_l, self.open_r = np.array(cl["open_l"], bool), np.array(cl["open_r"], bool)
        self.H = Heights(lap)
        self.fr = Frame(cl["sf_en"], cl["fwd_en"], float(self.H.z[0]))
        self.cones_en = np.array(cl["cones_en"])
        self.cone_station = np.array(cl["cone_station"], float)
        self.cone_lat = np.array(cl["cone_lat"], float)
        self.lap = float(cl["lap_m"])

    # --- station based lookups (i may be fractional and outside 0..n; + lateral = driver's left) ---
    def _ab(self, i):
        i = np.asarray(i, float)
        a = np.floor(i).astype(int) % self.n
        return a, (a + 1) % self.n, i - np.floor(i)

    def interp(self, v, i):
        a, b, f = self._ab(i)
        f = f if v.ndim == 1 else f[..., None]
        return v[a] * (1 - f) + v[b] * f

    def en(self, i, d):
        nr = self.interp(self.nrm, i)
        nr = nr / np.linalg.norm(nr, axis=-1, keepdims=True)
        return self.interp(self.c, i) + nr * np.asarray(d, float)[..., None]

    def h(self, i, d):
        return self.H.road(np.asarray(i, float), np.asarray(d, float))

    def world(self, i, d, dy=0.0):
        i, d = np.broadcast_arrays(np.asarray(i, float), np.asarray(d, float))
        return self.fr.world(self.en(i.ravel(), d.ravel()), self.h(i.ravel(), d.ravel()) + np.broadcast_to(dy, i.shape).ravel())

    def edge_en(self, side: int) -> np.ndarray:
        """Road edge vertices (exactly the ones used by the road mesh). side +1 = left, -1 = right."""
        return self.c + self.nrm * (self.wl if side > 0 else -self.wr)[:, None]

    def shoulder_en(self, side: int) -> np.ndarray:
        return self.c + self.nrm * ((self.wl + SHOULDER) if side > 0 else -(self.wr + SHOULDER))[:, None]

    def shoulder_h(self, side: int) -> np.ndarray:
        d = (self.wl + SHOULDER) if side > 0 else -(self.wr + SHOULDER)
        return self.H.z + self.H.camber * d

    def edge_h(self, side: int) -> np.ndarray:
        return self.H.z + self.H.camber * (self.wl if side > 0 else -self.wr)

    def in_pit_stretch(self) -> np.ndarray:
        """Stations of the start straight next to the pit apron."""
        s = np.arange(self.n, dtype=float)
        s = np.where(s > self.n / 2, s - self.n, s)
        return (s >= PIT_Z[0]) & (s <= PIT_Z[1])


def cyclic_runs(mask: np.ndarray, min_len: int = 1, close_gap: int = 0) -> list[tuple[int, int]]:
    """Runs of True in a cyclic boolean array as (start, length). Short gaps are closed, short runs dropped."""
    m = np.asarray(mask, bool).copy()
    n = len(m)
    if m.all():
        return [(0, n)]
    if not m.any():
        return []

    def runs(v):
        z = int(np.argmin(v))                      # a False position; rotate so the array starts there
        r = np.roll(v, -z)
        d = np.diff(np.concatenate([[0], r.astype(int), [0]]))
        st, en = np.where(d == 1)[0], np.where(d == -1)[0]
        return [((int(a) + z) % n, int(b - a)) for a, b in zip(st, en)]

    if close_gap:
        for a, ln in runs(~m):
            if ln <= close_gap:
                m[(a + np.arange(ln)) % n] = True
        if m.all():
            return [(0, n)]
    return [(a, ln) for a, ln in runs(m) if ln >= min_len]


def vertex_normals(pos: np.ndarray, tris: np.ndarray) -> np.ndarray:
    fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    out = np.zeros_like(pos)
    for k in range(3):
        np.add.at(out, tris[:, k], fn)
    ln = np.linalg.norm(out, axis=1, keepdims=True)
    return np.where(ln > 1e-12, out / np.maximum(ln, 1e-12), np.array([[0.0, 1.0, 0.0]]))


def wind_up(pos: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Flip triangles whose face normal points down (for ground-like meshes)."""
    fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    t = tris.copy()
    down = fn[:, 1] < 0
    t[down] = t[down][:, ::-1]
    return t


def grid_tris(rows: int, cols: int, closed_rows: bool = False) -> np.ndarray:
    """Triangles of a rows x cols vertex grid (row-major)."""
    r = np.arange(rows if closed_rows else rows - 1)
    c = np.arange(cols - 1)
    rr, cc = np.meshgrid(r, c, indexing="ij")
    a = rr * cols + cc
    b = rr * cols + cc + 1
    r2 = (rr + 1) % rows
    d = r2 * cols + cc
    e = r2 * cols + cc + 1
    return np.concatenate([np.stack([a, b, e], -1).reshape(-1, 3), np.stack([a, e, d], -1).reshape(-1, 3)])


class Parts:
    """Collects geometry per (group name, material) and turns it into kn5 meshes."""

    def __init__(self):
        self.groups: dict[tuple[str, str], list] = {}
        self.flags: dict[str, dict] = {}

    def add(self, group: str, material: str, pos, normal, uv, tris, double_sided: bool = False, **flags):
        pos, normal, uv = np.asarray(pos, float), np.asarray(normal, float), np.asarray(uv, float)
        tris = np.asarray(tris, np.int64).reshape(-1, 3)
        if double_sided:
            pos, uv = np.vstack([pos, pos]), np.vstack([uv, uv])
            tris = np.vstack([tris, tris[:, ::-1] + len(normal)])
            normal = np.vstack([normal, -normal])
        self.groups.setdefault((group, material), []).append((pos, normal, uv, tris))
        if flags:
            self.flags[group] = flags

    def surface(self, group, material, pos, uv, tris, hint=(0.0, 1.0, 0.0), smooth=True, double_sided=False, **flags):
        """Add triangles; winding is fixed so the surface faces `hint` (a vector, or one vector per triangle)."""
        pos, tris = np.asarray(pos, float), np.asarray(tris, np.int64).reshape(-1, 3)
        uv = np.asarray(uv, float)
        fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
        hint = np.broadcast_to(np.asarray(hint, float), fn.shape)
        ok = np.linalg.norm(fn, axis=1) > 1e-7                          # drop degenerate triangles
        tris, fn, hint = tris[ok], fn[ok], hint[ok]
        if len(tris) == 0:
            return
        flip = np.einsum("ij,ij->i", fn, hint) < 0
        tris = tris.copy()
        tris[flip] = tris[flip][:, ::-1]
        if not smooth:                              # flat shading: unshare the vertices
            pos, uv = pos[tris.ravel()], uv[tris.ravel()]
            tris = np.arange(len(pos)).reshape(-1, 3)
        self.add(group, material, pos, vertex_normals(pos, tris), uv, tris, double_sided=double_sided, **flags)

    def quad(self, group, material, p, uvrect, hint, **kw):
        """p: 4 corners in order (bottom-left, bottom-right, top-right, top-left) as seen from the front."""
        u0, v0, u1, v1 = uvrect
        self.surface(group, material, np.asarray(p, float), [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
                     [(0, 1, 2), (0, 2, 3)], hint=hint, **kw)

    def meshes(self) -> list[Mesh]:
        out = []
        per_group: dict[str, int] = {}
        for group, _ in self.groups:
            per_group[group] = per_group.get(group, 0) + 1
        for (group, material), parts in self.groups.items():
            name = group if per_group[group] == 1 else f"{group}_{material}"
            off, P, N, U, T = 0, [], [], [], []
            for pos, normal, uv, tris in parts:
                P.append(pos), N.append(normal), U.append(uv), T.append(tris + off)
                off += len(pos)
            out += split_mesh(name, material, np.vstack(P), np.vstack(N), np.vstack(U), np.vstack(T), **self.flags.get(group, {}))
        return out


def speed_profile(k: np.ndarray, step: float = 1.0, a_lat: float = 11.5, a_acc: float = 4.5, a_brk: float = 9.5,
                  v_max: float = 58.0) -> np.ndarray:
    """Simple point-mass lap speed (m/s) for a closed line with curvature k (1/m) sampled every `step` m."""
    v = np.minimum(np.sqrt(a_lat / np.maximum(np.abs(k), 1e-4)), v_max)
    n = len(v)
    for _ in range(2):
        for i in range(n):                                    # acceleration limit
            j = (i + 1) % n
            v[j] = min(v[j], np.sqrt(v[i] ** 2 + 2 * a_acc * step))
        for i in range(n - 1, -1, -1):                        # braking limit
            j = (i + 1) % n
            v[i] = min(v[i], np.sqrt(v[j] ** 2 + 2 * a_brk * step))
    return v


class SurfaceLookup:
    """Height of triangle meshes under a point (vertical ray), for laying thin objects exactly on the ground."""

    def __init__(self, tri_pos: np.ndarray, cell: float = 6.0):
        self.tri = np.asarray(tri_pos, float)                 # (m, 3, 3) world coordinates
        self.cell = cell
        lo, hi = self.tri[:, :, [0, 2]].min(1), self.tri[:, :, [0, 2]].max(1)
        a, b = np.floor(lo / cell).astype(int), np.floor(hi / cell).astype(int)
        self.buckets: dict[tuple[int, int], list[int]] = {}
        for k in range(len(self.tri)):
            for i in range(a[k, 0], b[k, 0] + 1):
                for j in range(a[k, 1], b[k, 1] + 1):
                    self.buckets.setdefault((i, j), []).append(k)

    @staticmethod
    def from_parts(parts: "Parts", prefixes: tuple[str, ...]) -> "SurfaceLookup":
        tris = [pos[t] for (group, _), items in parts.groups.items() if group.startswith(prefixes) for pos, _, _, t in items]
        return SurfaceLookup(np.vstack(tris))

    def y(self, x: float, z: float):
        ids = self.buckets.get((int(np.floor(x / self.cell)), int(np.floor(z / self.cell))))
        if not ids:
            return None
        t = self.tri[ids]
        a, b, c = t[:, 0], t[:, 1], t[:, 2]
        d = (b[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 2] - c[:, 2])
        d = np.where(np.abs(d) < 1e-12, 1e-12, d)
        w0 = ((b[:, 2] - c[:, 2]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (z - c[:, 2])) / d
        w1 = ((c[:, 2] - a[:, 2]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (z - c[:, 2])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            return None
        return float(np.where(inside, w0 * a[:, 1] + w1 * b[:, 1] + w2 * c[:, 1], -1e9).max())

    def ys(self, xz: np.ndarray, fallback: np.ndarray) -> np.ndarray:
        out = np.array(fallback, float)
        for k, (x, z) in enumerate(np.asarray(xz, float)):
            v = self.y(x, z)
            if v is not None:
                out[k] = v
        return out
