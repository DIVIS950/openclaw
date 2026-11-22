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
PIT_X, PIT_Z0, PIT_DZ = 16.5, -30.0, 5.6       # 5.6 m apart: the last box then has asphalt, not the grass corner, ahead of it
SPAWN_DY = 0.05
STACK_ROOM = 1.7        # the racing line keeps this far from the side of a tyre stack (m)
AI_SIDE_GAP = 0.3       # the AI's track limit stops this far short of a solid thing on the road (m)


def grid_slots() -> list[tuple[float, float]]:
    """(station, lateral) of every grid slot; pole is at the front, on the left."""
    return [(-4.0 - GRID_STEP * k, GRID_LAT if k % 2 == 0 else -GRID_LAT) for k in range(GRID_SLOTS)]


def make_dummies(tr: Track, surface=None) -> tuple[list[Dummy], dict]:
    """surface: optional lookup (world x, z) -> height of the built asphalt, so the pit boxes sit exactly on it."""
    out, info = [], {}

    def facing(st: float) -> tuple:
        t = tr.fr.vec(tr.interp(tr.tan, np.array([st])))[0]
        return (float(t[0]), 0.0, float(t[1]))

    for k, (st, lat) in enumerate(grid_slots()):
        # identity rotation: the world is built so that +Z is the direction of the start straight
        out.append(Dummy(f"AC_START_{k}", tuple(tr.world(st, lat, SPAWN_DY)[0]), (0.0, 0.0, 1.0)))
    ang = np.radians(30.0)
    pf = tr.pit_ref_en(1.0) - tr.pit_ref_en(0.0)                 # the pit line: its direction and its left
    pl = np.array([-pf[1], pf[0]])
    face = tr.fr.vec((np.cos(ang) * pf - np.sin(ang) * pl)[None, :])[0]
    for k in range(PIT_SLOTS):
        en = tr.pit_ref_en(PIT_Z0 + PIT_DZ * k, PIT_X)           # a fixed place on the pit apron
        x, z = (float(v) for v in tr.fr.xz(en[None, :])[0])
        y = float(tr.H.ground(en[None, :])[0]) - tr.fr.ref + SPAWN_DY
        if surface is not None and surface.y(x, z) is not None:
            y = surface.y(x, z) + SPAWN_DY
        out.append(Dummy(f"AC_PIT_{k}", (x, y, z), (float(face[0]), 0.0, float(face[1]))))
    out.append(Dummy("AC_HOTLAP_START_0", tuple(tr.world(-80.0, 0.0, SPAWN_DY)[0]), facing(-80.0)))
    from common import RACE_LAYOUT
    # the plain circuit has the start/finish gate only: with a sector gate on one route, a lap on any other route of
    # the circuit would not count
    for idx, st in (((0, 0.0), (1, float(round(tr.n / 2)))) if RACE_LAYOUT else ((0, 0.0),)):
        wl, wr = float(tr.interp(tr.wl, np.array([st]))[0]), float(tr.interp(tr.wr, np.array([st]))[0])
        if idx == 0:
            wl = max(wl, PIT_X + 0.5)                            # the start line reaches across the pit apron too
        out.append(Dummy(f"AC_TIME_{idx}_L", tuple(tr.world(st, wl + 2.5, 0.5)[0]), facing(st)))
        out.append(Dummy(f"AC_TIME_{idx}_R", tuple(tr.world(st, -(wr + 2.5), 0.5)[0]), facing(st)))
    info["sector_station"] = float(round(tr.n / 2)) if RACE_LAYOUT else None
    return out, info


def racing_line(tr: Track, margin: float = 1.7, iters: int = 60) -> np.ndarray:
    """Lateral offset (m, + = left) of a smooth line that uses the width of the road."""
    lo, hi = -(tr.wr - margin), tr.wl - margin
    # the tyre stacks are measured against the lap as it is now (the lap line was moved after they were registered)
    from scipy.spatial import cKDTree
    near = cKDTree(tr.c).query(tr.cones_en)[1] if len(tr.cones_en) else np.zeros(0, int)
    lats = np.einsum("ij,ij->i", tr.cones_en - tr.c[near], tr.nrm[near]) if len(tr.cones_en) else np.zeros(0)
    for st, lat in zip(near, lats):                             # keep clear of tyre stacks standing on or beside the road
        idx = (int(round(st)) + np.arange(-7, 8)) % tr.n
        if 0 < lat < tr.wl[idx].max() + 0.8:
            hi[idx] = np.minimum(hi[idx], lat - 0.36 - STACK_ROOM)
        elif 0 > lat > -(tr.wr[idx].max() + 0.8):
            lo[idx] = np.maximum(lo[idx], lat + 0.36 + STACK_ROOM)
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
    # room to the left and right of the line: not more than there is before a tyre stack, a row of bags or a
    # plastic barrier (the AI takes these two numbers for its track limits when it leaves the line)
    import racekit
    from scipy.spatial import cKDTree
    solid = racekit.solid_points(tr) if len(tr.cones_en) else np.zeros((0, 3))
    if len(solid):
        en = tr.en(st, lat)
        t = np.roll(en, -1, axis=0) - np.roll(en, 1, axis=0)
        t /= np.linalg.norm(t, axis=1, keepdims=True)
        nl = np.column_stack([-t[:, 1], t[:, 0]])
        tree = cKDTree(solid[:, :2])
        for i, near in enumerate(tree.query_ball_point(en, 14.0)):
            if not near:
                continue
            q = solid[near]
            d = q[:, :2] - en[i]
            along, side = d @ t[i], d @ nl[i]
            hit = np.abs(along) < 2.2 + q[:, 2]                      # beside the car, not ahead of it or behind
            for col, sgn in ((5, 1.0), (6, -1.0)):
                m = hit & (sgn * side > 0)
                if m.any():
                    extra[i, col] = min(extra[i, col], max(0.5, float((sgn * side[m] - q[m, 2]).min()) - AI_SIDE_GAP))
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
        f.write(struct.pack("<i", 0))                            # "has grid" flag: none, the game builds its own
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
GRASS_MATERIALS = {grass}
OCCLUDING_MATERIALS = {hard}, paint, concrete, building, garage, hall, hut, softwall, arch, roofphoto, tyres, bags
SHAPE_SIZE = 0.8, 1.0
SHAPE_TIDY = 0.4

[RAIN_FX]
PUDDLES_MATERIALS = {asphalt}
SOAKING_MATERIALS = {hard}, {grass}, photo, photofar, concrete
SMOOTH_MATERIALS = hall, garage, paint
ROUGH_MATERIALS = softwall, gravel
LINES_MATERIALS = paint
"""


INSTALL = """AUTODROM SOSNOVA v17.1 for Assetto Corsa: the race route of 5.12.2026
======================================================================

INSTALL
1. Delete older versions first, if you have them:
      ...\\assettocorsa\\content\\tracks\\sosnova, sosnova_v2 ... sosnova_v6, sosnova_v7_race, sosnova_v7_standard, sosnova_v8_race, sosnova_v8_standard
   An older "sosnova_v9" is replaced by this one.
2. Copy the whole folder "sosnova_v9" into:
      ...\\Steam\\steamapps\\common\\assettocorsa\\content\\tracks\\
   so that this file exists:
      ...\\content\\tracks\\sosnova_v9\\sosnova_v9.kn5
   (With Content Manager you can also just drag the zip onto its window.)
3. Start the game and pick the track "Autodrom Sosnova v17.1 - Racing Days 5.12.2026".

THE ROUTE
The red line of the organiser's map for the Liqui Moly Racing Days, 5.12.2026. __LAP__ m, anticlockwise:
  1. Start on the start straight, heading east (the red arrow of the map). The start line is at the real
     painted line.
  2. Turn 1: left round the white concrete pad. Four tyre stacks stand on its edge.
  3. Back west on the upper road. Then a chicane, left and right, between two rows of tyre stacks.
  4. North under the green bridge.
  5. After the bridge turn right. A single stack is on the inside, a curved row of nine stacks on the outside.
     Then east along the infield road.
  6. Right into the east loop. Round its hairpin to the left; a stack stands at the apex. Then back north-west
     on the outer road, past the junction that a row of six stacks closes.
  7. Left onto the north straight. Its chicane has three rows of stacks: pass right, left, right. The middle
     row stands on the road. The route passes it on the strip of asphalt beside the road, as the map shows.
  8. The west loop (left) and the long west straight.
  9. The long right-hander at its end, then south on the road west of the bridge.
 10. The S-bend: left, right, left, with a stack at each apex. Then onto the start straight.

WHAT STANDS ON THE TRACK
- A tyre stack at each of the __DOTS__ yellow dots of the organiser's map. Each is four tyres high.
- Dots that stand in a row are joined with yellow soft bags and red and white tape (__ROWS__ rows). Some rows close
  roads that are not part of the route. The others make the chicanes.
- New in 17.1, more barriers and tape. The organiser's map does not show these. They stand where track helpers
  would put them, so you can always see where to go:
    - red and white plastic barriers across every side road of the route, from grass to grass
      (__BROWS__ rows, __BM__ m);
    - red and white tape on posts along the edges of the big square and at the north chicane
      (__TLINES__ lines, __TM__ m);
    - arrow boards at the chicanes and round the outside of the east hairpin. They point to the side to pass.
- Orange cones mark the edge where nothing else does.
- Solid, you hit them: tyre stacks, bags, plastic barriers. Not solid, a car goes through: tape, posts, cones,
  arrow boards.
- Three places stay open: the pit apron beside the start straight, the way in from the paddock at the west end
  of the bottom road, and the way out to the pits outside turn 1 (the two blue arrows of the map).
- The places of the tyre stacks come from dots on a small picture. Each stack can be 1 to 2 m away from its real
  place. On the day the organiser may place them a little differently.

THE CIRCUIT
- Built from the aerial photo (12.5 cm per pixel) and the laser scan of the Czech state survey. The asphalt has
  the outline and the widths the photo shows.
- The road looks like the aerial photo, with a detailed asphalt picture on top. The concrete strips along the
  edges (the kerbs of Sosnova are flat grey concrete) and the white pad of turn 1 are part of the surface.
- The sand run-offs, the tyre walls of the photo (about __WALLS__ m), the pit wall and the paddock wall.
- The landscape, the buildings with their roofs, the trees and the motorway viaduct come from the laser scan.
- How exact it is: the edges of the road are right to about 20 cm, the heights to about 10 to 20 cm. It is not
  exact to the millimetre.
- Chequered start line, start lights, 16 grid boxes, 16 pit boxes on the wide asphalt beside the start straight.
- Lap timing: the time is taken at the start line. There is one check line half-way round. A lap counts only
  if you cross both. The game cannot see if you go through tape.
- AI cars should follow the race route (not tested in the game). Use a race from the grid: there is no pit lane
  line for the AI, so in practice or qualifying AI cars may stay in the pits.
- The track is big: 93 MB and many textures. It needs a graphics card with at least 2 GB of memory.

NOT TESTED IN THE GAME
The track was built and checked with tools (file structure, surfaces, AI line, spawn points, timing gates), and
pictures were rendered from the same file. It has not been started in Assetto Corsa itself. If it does not load,
please send a screenshot of the error.

OPTIONAL
- Custom Shaders Patch adds 3D grass. Rain and puddles need CSP with RainFX and a weather script (Sol or Pure).

DATA
Route and tyre stacks: the organiser's map (semerad_rally, Liqui Moly Racing Days 5.12.2026).
Orthophoto, terrain model DMR 5G and surface model DMP 1G: CUZK, CC BY 4.0.
Materials and tree models: Poly Haven, CC0. Not affiliated with the circuit owner or the organiser.
"""


def write_data(tr: Track, out: str, ai: dict, bounds_xz: np.ndarray, materials: list[str] | None = None, facts: dict | None = None) -> None:
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    os.makedirs(os.path.join(out, "ui"), exist_ok=True)
    os.makedirs(os.path.join(out, "extension"), exist_ok=True)
    open(os.path.join(out, "data", "surfaces.ini"), "w", newline="\r\n").write(SURFACES)
    from props import race_rows
    rows = sum(1 for r in race_rows(tr) if len(r) > 1)
    import racekit
    extras = racekit.extra_lines(tr)
    bar, tap = [e for e in extras if e["kind"] == "barrier"], [e for e in extras if e["kind"] == "tape"]
    install = INSTALL.replace("__LAP__", str(int(round(tr.lap)))).replace("__DOTS__", str(tr.map_dots)).replace("__ROWS__", str(rows))
    install = install.replace("__BROWS__", str(len(bar))).replace("__BM__", str(int(round(sum(e["length"] for e in bar)))))
    install = install.replace("__TLINES__", str(len(tap))).replace("__TM__", str(int(round(racekit.tape_length(tap)))))
    install = install.replace("__WALLS__", str(int(round((facts or {}).get("tyre_wall_m", 0.0) / 10.0)) * 10))
    assert "__" not in install
    open(os.path.join(out, "INSTALL.txt"), "w", newline="\r\n").write(install)
    names = sorted(materials or [])
    asphalt = [m for m in names if m.startswith("lap") or (m[:1] == "a" and m[1:].isdigit()) or (m[:2] in ("kl", "kr") and m[2:].isdigit()) or (m[:1] == "c" and m[1:].isdigit())]
    grass = ["grass"] + [m for m in names if m[:1] == "g" and m[1:].isdigit()]      # not the worn strip beside the asphalt
    cfg = EXT_CONFIG.format(grass=", ".join(grass), asphalt=", ".join(asphalt + ["pad", "padwhite"]), hard=", ".join(asphalt + ["pad", "padwhite", "gravel"]))
    open(os.path.join(out, "extension", "ext_config.ini"), "w", newline="\r\n").write(cfg)
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
        "name": "Autodrom Sosnová v17.1 - Racing Days 5.12.2026",
        "description": "Autodrom Sosnová near Česká Lípa, Czech Republic, set up for the Liqui Moly Racing Days of 5.12.2026: the race "
                       "route of the organiser's map (%d m, anticlockwise) with a tyre stack at each of its %d yellow dots, bags and "
                       "tape along their rows, plastic barriers across every side road, tape on posts along the open squares "
                       "and arrow boards at the chicanes. The circuit is built from the 12.5 cm aerial photo and the laser "
                       "scan of the Czech state survey: asphalt outline and widths, concrete strips, sand run-offs, tyre walls, "
                       "landscape and buildings. Not tested in the game. "
                       "16 grid slots, 16 pit boxes, lap timing with one sector gate. Data: ČÚZK (CC BY 4.0), "
                       "materials from Poly Haven (CC0). Optional CSP grass and rain. Not affiliated with the circuit owner or "
                       "the organiser." % (int(round(tr.lap)), tr.map_dots),
        "tags": ["circuit", "czech", "sosnova", "bridge", "race layout", "csp"],
        "geotags": ["50.65900", "14.53906"],
        "country": "Czech Republic",
        "city": "Sosnová (Česká Lípa)",
        "length": str(int(round(tr.lap))),
        "width": "%d-%d" % (int(round(float((tr.wl + tr.wr).min()))), int(round(float((tr.wl + tr.wr).max())))),
        "pitboxes": str(PIT_SLOTS),
        "run": "anticlockwise",
        "author": "Sosnova track kit (data: ČÚZK Ortofoto ČR + DMR 5G, CC BY 4.0)",
        "version": "17.1",
        "url": "",
    }
    json.dump(ui, open(os.path.join(out, "ui", "ui_track.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
