"""Shared paths, coordinate frames and small numeric helpers for the Sosnova v2 track builder.

Frames
  EN     east / north metres around the orthophoto centre (all 2D geometry is done here)
  WORLD  Assetto Corsa space: +Y up, +Z along the start straight (the way cars face on the grid),
         +X to the driver's left. Origin on the start/finish line. Right-handed.
"""
from __future__ import annotations

import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
SRC = os.path.join(KIT, "source")
WORK = os.path.join(SRC, "work")
TRACK = "sosnova_v4"
OUT = os.path.join(KIT, "content", "tracks", TRACK)

META = json.load(open(os.path.join(SRC, "cuzk", "meta.json"), encoding="utf-8"))
HALF_E, HALF_N = META["half_m"]
GSD = META["gsd"]
ORTHO_W, ORTHO_H = META["ortho_size"]
META_FAR = json.load(open(os.path.join(SRC, "cuzk_far", "meta.json"), encoding="utf-8"))


def px_to_en(px: np.ndarray, gsd: float = GSD, w: int = ORTHO_W, h: int = ORTHO_H) -> np.ndarray:
    px = np.atleast_2d(np.asarray(px, float))
    return np.column_stack([(px[:, 0] - w / 2) * gsd, (h / 2 - px[:, 1]) * gsd])


def en_to_px(en: np.ndarray, gsd: float = GSD, w: int = ORTHO_W, h: int = ORTHO_H) -> np.ndarray:
    en = np.atleast_2d(np.asarray(en, float))
    return np.column_stack([en[:, 0] / gsd + w / 2, h / 2 - en[:, 1] / gsd])


class Frame:
    """EN -> WORLD. origin = start/finish point, fwd = unit direction of the start straight."""

    def __init__(self, origin, fwd, ref_h: float):
        self.o = np.asarray(origin, float)
        f = np.asarray(fwd, float)
        self.f = f / np.linalg.norm(f)
        self.l = np.array([-self.f[1], self.f[0]])  # left of travel
        self.ref = float(ref_h)

    def xz(self, en: np.ndarray) -> np.ndarray:
        d = np.atleast_2d(en) - self.o
        return np.column_stack([d @ self.l, d @ self.f])

    def world(self, en: np.ndarray, h: np.ndarray | float) -> np.ndarray:
        """h is metres above sea level."""
        xz = self.xz(en)
        y = np.broadcast_to(np.asarray(h, float), (len(xz),)) - self.ref
        return np.column_stack([xz[:, 0], y, xz[:, 1]])

    def vec(self, d_en: np.ndarray) -> np.ndarray:
        d = np.atleast_2d(d_en)
        return np.column_stack([d @ self.l, d @ self.f])

    def to_json(self) -> dict:
        return {"origin_en": self.o.tolist(), "fwd_en": self.f.tolist(), "ref_h": self.ref}

    @staticmethod
    def from_json(d: dict) -> "Frame":
        return Frame(d["origin_en"], d["fwd_en"], d["ref_h"])


def closed_resample(p: np.ndarray, step: float) -> np.ndarray:
    """Resample a closed polyline to (about) equal spacing; the result does not repeat the first point."""
    q = np.vstack([p, p[:1]])
    seg = np.linalg.norm(np.diff(q, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(8, int(round(s[-1] / step)))
    t = np.arange(n) * (s[-1] / n)
    return np.column_stack([np.interp(t, s, q[:, 0]), np.interp(t, s, q[:, 1])])


def closed_frames(p: np.ndarray):
    """Unit tangent, left normal, signed curvature (1/m, + = left turn) and spacing of a closed polyline."""
    nxt, prv = np.roll(p, -1, axis=0), np.roll(p, 1, axis=0)
    t = nxt - prv
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.column_stack([-t[:, 1], t[:, 0]])
    a, b = p - prv, nxt - p
    cross = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
    la, lb, lc = np.linalg.norm(a, axis=1), np.linalg.norm(b, axis=1), np.linalg.norm(nxt - prv, axis=1)
    k = 2 * cross / np.maximum(la * lb * lc, 1e-9)
    return t, n, k, lb


def periodic_gauss(v: np.ndarray, sigma: float) -> np.ndarray:
    from scipy.ndimage import gaussian_filter1d
    return gaussian_filter1d(v, sigma, mode="wrap", axis=0)


# --- ground photo: one square texture over the whole site (east/north +-SITE_HALF metres) ---
SITE_HALF = 320.0
PHOTO_PX = 4096


def site_uv(en: np.ndarray) -> np.ndarray:
    """Texture coordinates of the ground photo and its mask (v measured northwards)."""
    en = np.atleast_2d(en)
    return (en + SITE_HALF) / (2 * SITE_HALF)
