"""Everything that is not geometry: spawn / timing dummies, AI line, data and UI files, track map."""
from __future__ import annotations

import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import periodic_gauss  # noqa: E402
from kn5 import Dummy  # noqa: E402
from track import Track, speed_profile  # noqa: E402

GRID_SLOTS = 16
GRID_LAT = 2.2          # metres left / right of the centre line
GRID_STEP = 4.0         # metres between rows (staggered grid)
PIT_SLOTS = 16
PIT_X, PIT_Z0, PIT_DZ = 16.5, -30.0, 6.0
SPAWN_DY = 0.05


def grid_slots() -> list[tuple[float, float]]:
    """(station, lateral) of every grid slot; pole is at the front, on the left."""
    return [(-4.0 - GRID_STEP * k, GRID_LAT if k % 2 == 0 else -GRID_LAT) for k in range(GRID_SLOTS)]


def make_dummies(tr: Track) -> tuple[list[Dummy], dict]:
    out, info = [], {}

    def facing(st: float) -> tuple:
        t = tr.fr.vec(tr.interp(tr.tan, np.array([st])))[0]
        return (float(t[0]), 0.0, float(t[1]))

    for k, (st, lat) in enumerate(grid_slots()):
        # identity rotation: the world is built so that +Z is the direction of the start straight
        out.append(Dummy(f"AC_START_{k}", tuple(tr.world(st, lat, SPAWN_DY)[0]), (0.0, 0.0, 1.0)))
    ang = np.radians(30.0)
    for k in range(PIT_SLOTS):
        x, z = PIT_X, PIT_Z0 + PIT_DZ * k
        en = tr.fr.o + x * tr.fr.l + z * tr.fr.f
        y = float(tr.H.ground(en[None, :])[0]) - tr.fr.ref + SPAWN_DY
        out.append(Dummy(f"AC_PIT_{k}", (x, y, z), (-np.sin(ang), 0.0, np.cos(ang))))
    out.append(Dummy("AC_HOTLAP_START_0", tuple(tr.world(-80.0, 0.0, SPAWN_DY)[0]), facing(-80.0)))
    for idx, st in ((0, 0.0), (1, float(round(tr.n / 2)))):
        wl, wr = float(tr.interp(tr.wl, np.array([st]))[0]), float(tr.interp(tr.wr, np.array([st]))[0])
        out.append(Dummy(f"AC_TIME_{idx}_L", tuple(tr.world(st, wl + 2.5, 0.5)[0]), facing(st)))
        out.append(Dummy(f"AC_TIME_{idx}_R", tuple(tr.world(st, -(wr + 2.5), 0.5)[0]), facing(st)))
    info["sector_station"] = float(round(tr.n / 2))
    return out, info


def racing_line(tr: Track, margin: float = 1.7, iters: int = 60) -> np.ndarray:
    """Lateral offset (m, + = left) of a smooth line that uses the width of the road."""
    lo, hi = -(tr.wr - margin), tr.wl - margin
    for st, lat in zip(tr.cone_station, tr.cone_lat):           # keep clear of tyre stacks standing on the road
        idx = (int(round(st)) + np.arange(-7, 8)) % tr.n
        if 0 < lat < tr.wl[idx].max():
            hi[idx] = np.minimum(hi[idx], lat - 0.36 - 1.4)
        elif 0 > lat > -tr.wr[idx].max():
            lo[idx] = np.maximum(lo[idx], lat + 0.36 + 1.4)
    lo, hi = periodic_gauss(lo, 2.0), periodic_gauss(hi, 2.0)
    hi = np.maximum(hi, lo + 0.2)
    off = np.zeros(tr.n)
    for _ in range(iters):
        p = periodic_gauss(tr.c + tr.nrm * off[:, None], 7.0)
        off = np.clip(np.einsum("ij,ij->i", p - tr.c, tr.nrm), lo, hi)
    return periodic_gauss(np.clip(off, lo, hi), 2.0)


def write_ai(tr: Track, path: str) -> dict:
    off = racing_line(tr)
    dense_i = np.arange(tr.n * 4 + 1) / 4.0
    dense_off = tr.interp(off, dense_i)
    dense = tr.world(dense_i, dense_off)
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    length = float(cum[-1])
    n = int(round(length))
    s = np.arange(n) * length / n
    st = np.interp(s, cum, dense_i)
    lat = tr.interp(off, st)
    p = tr.world(st, lat)
    nxt, prv = np.roll(p, -1, axis=0), np.roll(p, 1, axis=0)
    fwd = nxt - prv
    fwd /= np.linalg.norm(fwd, axis=1, keepdims=True)
    a, b = (p - prv)[:, [0, 2]], (nxt - p)[:, [0, 2]]
    cross = a[:, 1] * b[:, 0] - a[:, 0] * b[:, 1]              # + = turning left (towards +X when heading +Z)
    k = 2 * cross / np.maximum(np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) * np.linalg.norm((nxt - prv)[:, [0, 2]], axis=1), 1e-9)
    k = periodic_gauss(k, 2.0)
    step = length / n
    v = speed_profile(k, step)
    acc = (np.roll(v, -1) ** 2 - v ** 2) / (2 * step)
    gas = np.clip(np.where(acc >= -0.2, 0.35 + acc / 4.5, 0.0), 0, 1)
    brake = np.clip(-acc / 9.5, 0, 1) * (acc < -0.2)
    camber = tr.interp(tr.H.camber, st)
    left = np.column_stack([fwd[:, 2], camber, -fwd[:, 0]])     # +X side when heading +Z
    left /= np.linalg.norm(left, axis=1, keepdims=True)
    normal = np.cross(fwd, left)
    normal *= np.sign(normal[:, 1:2])
    extra = np.zeros((n, 18), np.float32)
    extra[:, 0], extra[:, 1], extra[:, 2] = v, gas, brake
    extra[:, 3] = v ** 2 * np.abs(k) / 9.81
    extra[:, 4] = np.minimum(1.0 / np.maximum(np.abs(k), 1e-6), 2000.0)
    extra[:, 5] = tr.interp(tr.wl, st) - lat
    extra[:, 6] = tr.interp(tr.wr, st) + lat
    extra[:, 7] = camber
    extra[:, 9:12] = normal
    extra[:, 12] = s
    extra[:, 13:16] = fwd
    extra[:, 17] = fwd[:, 1]
    with open(path, "wb") as f:
        f.write(struct.pack("<4i", 7, n, 0, 0))
        rec = np.zeros(n, np.dtype([("p", "<f4", 3), ("d", "<f4"), ("i", "<i4")]))
        rec["p"], rec["d"], rec["i"] = p, s, np.arange(n)
        f.write(rec.tobytes())
        f.write(struct.pack("<i", n))
        f.write(extra.astype("<f4").tobytes())
    return dict(points=n, length=length, lap_s=float((step / v).sum()), v_min=float(v.min() * 3.6), v_max=float(v.max() * 3.6),
                off_min=float(off.min()), off_max=float(off.max()), line=p, speed=v)


SURFACES = """[SURFACE_0]
KEY=ROAD
FRICTION=0.98
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0
IS_VALID_TRACK=1
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0
VIBRATION_LENGTH=0

[SURFACE_1]
KEY=APRON
FRICTION=0.96
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0
IS_VALID_TRACK=1
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0
VIBRATION_LENGTH=0

[SURFACE_2]
KEY=KERB
FRICTION=0.93
DAMPING=0
WAV=kerb.wav
WAV_PITCH=1.3
FF_EFFECT=1
DIRT_ADDITIVE=0
IS_VALID_TRACK=1
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=1.0
VIBRATION_LENGTH=1.5

[SURFACE_3]
KEY=GRASS
FRICTION=0.60
DAMPING=0.2
WAV=grass.wav
WAV_PITCH=0
FF_EFFECT=1
DIRT_ADDITIVE=1
IS_VALID_TRACK=0
BLACK_FLAG_TIME=0
SIN_HEIGHT=0.03
SIN_LENGTH=0.5
IS_PITLANE=0
VIBRATION_GAIN=0.2
VIBRATION_LENGTH=0.6

[SURFACE_4]
KEY=SAND
FRICTION=0.75
DAMPING=0.35
WAV=sand.wav
WAV_PITCH=0
FF_EFFECT=1
DIRT_ADDITIVE=1
IS_VALID_TRACK=0
BLACK_FLAG_TIME=0
SIN_HEIGHT=0.03
SIN_LENGTH=0.4
IS_PITLANE=0
VIBRATION_GAIN=0.4
VIBRATION_LENGTH=0.5

[SURFACE_5]
KEY=WALL
FRICTION=0.6
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0
IS_VALID_TRACK=0
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0
VIBRATION_LENGTH=0
"""

EXT_CONFIG = """; Custom Shaders Patch settings (optional; the track also runs without CSP).
; Rain, wet grip and puddles need CSP with RainFX and a weather script such as Sol or Pure.
[BASIC]
DESCRIPTION = Autodrom Sosnova

[GRASS_FX]
GRASS_MATERIALS = grass
OCCLUDING_MATERIALS = road, road_g1, road_g2, road_g3, apron, pad, gravel, paint, kerb, concrete, building, garage, hall, hut, softwall, arch, roofphoto
SHAPE_SIZE = 0.8, 1.0
SHAPE_TIDY = 0.4

[RAIN_FX]
PUDDLES_MATERIALS = road, road_g1, road_g2, road_g3, apron, pad
SOAKING_MATERIALS = road, road_g1, road_g2, road_g3, apron, pad, gravel, grass, photo, photofar, concrete
SMOOTH_MATERIALS = hall, garage, paint
ROUGH_MATERIALS = softwall, gravel
LINES_MATERIALS = paint
"""


INSTALL = """AUTODROM SOSNOVA v5.0 for Assetto Corsa
=======================================

INSTALL
1. Delete older versions first, if you have them:
      ...\\assettocorsa\\content\\tracks\\sosnova, sosnova_v2, sosnova_v3, sosnova_v4
2. Copy the whole folder "sosnova_v5" into:
      ...\\Steam\\steamapps\\common\\assettocorsa\\content\\tracks\\
   so that this file exists:
      ...\\content\\tracks\\sosnova_v5\\sosnova_v5.kn5
   (With Content Manager you can also just drag the zip onto its window.)
3. Start the game and pick the track "Autodrom Sosnova v5.0".

WHAT IT IS
- The lap of Autodrom Sosnova (1764 m, anticlockwise, under the green bridge), redesigned as a clean racetrack:
  the road is 9 m wide everywhere, both white lines run parallel, and a 4 m grass verge runs along both sides.
- Red and white kerbs on every corner. A gravel trap with a barrier behind it on the outside of every corner.
- A rubbered racing line, chequered start line, 16 grid boxes, start lights, a pit apron with 16 painted bays, brake boards.
- Real materials: asphalt, grass, gravel and walls are photo scans of real surfaces, the trees are pictures of scanned trees.
- The position and the heights of the lap, the bridge, the buildings and the trees come from Czech state survey data.
- The event barriers and slalom tyres are NOT in this version.

OPTIONAL
- Custom Shaders Patch adds 3D grass. Rain and puddles need CSP with RainFX and a weather script (Sol or Pure).

DATA
Orthophoto, terrain model DMR 5G and surface model DMP 1G: CUZK, CC BY 4.0.
Materials and tree models: Poly Haven, CC0. Not affiliated with the circuit owner.
"""


def write_data(tr: Track, out: str, ai: dict, bounds_xz: np.ndarray) -> None:
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    os.makedirs(os.path.join(out, "ui"), exist_ok=True)
    os.makedirs(os.path.join(out, "extension"), exist_ok=True)
    open(os.path.join(out, "data", "surfaces.ini"), "w", newline="\r\n").write(SURFACES)
    open(os.path.join(out, "INSTALL.txt"), "w", newline="\r\n").write(INSTALL)
    open(os.path.join(out, "extension", "ext_config.ini"), "w", newline="\r\n").write(EXT_CONFIG)
    # the start straight points 8 degrees south of east, i.e. world +Z; the sun stands in the south-west
    open(os.path.join(out, "data", "lighting.ini"), "w", newline="\r\n").write("[LIGHTING]\nSUN_PITCH_ANGLE=48\nSUN_HEADING_ANGLE=35\n")
    # map: 1 px per metre, x to the right, z down
    margin = 20
    lo, hi = bounds_xz.min(0), bounds_xz.max(0)
    w, h = int(np.ceil(hi[0] - lo[0])) + 2 * margin, int(np.ceil(hi[1] - lo[1])) + 2 * margin
    xo, zo = margin - lo[0], margin - lo[1]
    ss = 4
    im = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    left, right = tr.fr.xz(tr.edge_en(1)), tr.fr.xz(tr.edge_en(-1))
    for k in range(tr.n):
        j = (k + 1) % tr.n
        quad = [left[k], left[j], right[j], right[k]]
        d.polygon([((x + xo) * ss, (z + zo) * ss) for x, z in quad], fill=(255, 255, 255, 255))
    im = im.resize((w, h), Image.LANCZOS)
    im.save(os.path.join(out, "map.png"))
    open(os.path.join(out, "data", "map.ini"), "w", newline="\r\n").write(
        f"[PARAMETERS]\nWIDTH={w}\nHEIGHT={h}\nMARGIN={margin}\nSCALE_FACTOR=1\nX_OFFSET={xo:.2f}\nZ_OFFSET={zo:.2f}\nDRAWING_SIZE=10\nMAX_SIZE=1600\n")
    # outline for the UI (track shape on transparent background)
    ow, oh = 365, 192
    sc = min((ow - 24) / (hi[0] - lo[0]), (oh - 24) / (hi[1] - lo[1]))
    line = ai["line"][:, [0, 2]]
    pts = [((ow / 2 + (x - (lo[0] + hi[0]) / 2) * sc) * ss, (oh / 2 + (z - (lo[1] + hi[1]) / 2) * sc) * ss) for x, z in line]
    o = Image.new("RGBA", (ow * ss, oh * ss), (0, 0, 0, 0))
    od = ImageDraw.Draw(o)
    od.line(pts + pts[:2], fill=(255, 255, 255, 255), width=3 * ss, joint="curve")
    od.ellipse([pts[0][0] - 4 * ss, pts[0][1] - 4 * ss, pts[0][0] + 4 * ss, pts[0][1] + 4 * ss], fill=(230, 40, 40, 255))
    o.resize((ow, oh), Image.LANCZOS).save(os.path.join(out, "ui", "outline.png"))
    # trackside cameras
    cams = ["[HEADER]\nVERSION=2\nSET_NAME=Default\nCAMERA_COUNT=10\n"]
    ncam = 10
    for k in range(ncam):
        st = (k + 0.5) * tr.n / ncam
        i = int(st) % tr.n
        side = -1 if tr.k[i] > 0 else 1                       # stand on the outside of the bend
        w_ = (tr.wl if side > 0 else tr.wr)[i]
        pos = tr.world(st, side * (w_ + 6.0), 4.5)[0]
        look = tr.world(st - 25.0, 0.0, 0.8)[0] - pos
        look /= np.linalg.norm(look)
        cams.append(f"[CAMERA_{k}]\nNAME=CAM_{k}\nPOSITION={pos[0]:.3f},{pos[1]:.3f},{pos[2]:.3f}\nFORWARD={look[0]:.4f},{look[1]:.4f},{look[2]:.4f}\n"
                    f"UP=0,1,0\nMIN_FOV=8\nMAX_FOV=55\nIN_POINT={k / ncam:.4f}\nOUT_POINT={(k + 1) / ncam:.4f}\nSHADOW_SPLIT0=20\nSHADOW_SPLIT1=80\n"
                    "SHADOW_SPLIT2=300\nNEAR_PLANE=0.5\nFAR_PLANE=5000\nMIN_EXPOSURE=0.3\nMAX_EXPOSURE=0.8\nDOF_FACTOR=0\nDOF_RANGE=1000\nDOF_FOCUS=0\n"
                    "DOF_MANUAL=0\nSPLINE=0\nSPLINE_ANIMATION_LENGTH=0\nIS_FIXED=0\n")
    open(os.path.join(out, "data", "cameras.ini"), "w", newline="\r\n").write("\n".join(cams))
    ui = {
        "name": "Autodrom Sosnová v5.0",
        "description": "Autodrom Sosnová near Česká Lípa, Czech Republic. Geometry from the Czech state orthophoto and lidar models "
                       "(ČÚZK): all asphalt of the complex, gravel run-offs, the green arch bridge, buildings with real heights, "
                       "barriers, pylons. Surfaces are photo-scanned materials and the trees are pictures of scanned 3D trees "
                       "(Poly Haven, CC0). The timed lap is the combined route of the 14.11.2026 event, anticlockwise from the "
                       "start straight and under the bridge. 16 grid slots, 16 pit boxes, AI line. Optional CSP grass and rain. "
                       "Not affiliated with the circuit owner.",
        "tags": ["circuit", "czech", "sosnova", "bridge", "lidar", "orthophoto", "csp"],
        "geotags": ["50.65900", "14.53906"],
        "country": "Czech Republic",
        "city": "Sosnová (Česká Lípa)",
        "length": str(int(round(tr.lap))),
        "width": "7-10",
        "pitboxes": str(PIT_SLOTS),
        "run": "anticlockwise",
        "author": "Sosnova track kit (data: ČÚZK Ortofoto ČR + DMR 5G, CC BY 4.0)",
        "version": "5.0",
        "url": "",
    }
    json.dump(ui, open(os.path.join(out, "ui", "ui_track.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
