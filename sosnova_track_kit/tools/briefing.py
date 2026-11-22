"""Driver briefing video: one lap on board, along the racing line of the track as built.

What it shows
  * the racing line on the road: red where the computer's guide brakes, green where it is on the throttle
  * every corner with its number, its direction and how far it turns, and a magenta post at each apex
  * a guide speed, the distance round the lap and a small map with the car on it

    python3 briefing.py plan                 prints the corners and writes source/briefing/plan.json
    python3 briefing.py frames [a b]         renders frames a..b-1 with Cycles into source/briefing/frames
    python3 briefing.py video                puts the text and the map on the frames and encodes briefing.mp4 (ffmpeg)

The guide speed is the point-mass speed profile of the AI line (layout.write_ai): an estimate, not a measured lap.
"""
from __future__ import annotations

import json
import os
import struct
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EVENT, OUT, SRC, periodic_gauss  # noqa: E402

DIR = os.path.join(SRC, "briefing")
FRAMES = os.path.join(DIR, "frames")
FPS = 12                 # rendered frames per second of driving
SIZE = (960, 540)
LEAD_IN = 70.0           # the video starts this many metres before the start line (m)
EYE = 1.10               # height of the driver's eye (m)
LOOK = 14.0              # the camera looks at the line this far ahead (m)
BEND_R, BEND_DEG = 110.0, 11.0   # a corner: tighter than this radius (m) and turning at least this much (degrees)
# What to say at each corner of the race route of 5.12.2026 (number -> note). Left out when the corners found do not
# match in number.
NOTES = {
    1: "Turn 1. Left round the white pad. Four tyre stacks mark the inside.",
    2: "Left kink onto the upper road. Barriers close the link road on the right.",
    3: "Chicane: first stack on your left, row of three on your right. Then right, north to the bridge.",
    4: "After the bridge: tight right. One stack inside, a row of nine outside.",
    5: "Right into the east loop.",
    6: "East hairpin: left round the single stack. Barriers and arrows on the outside.",
    7: "Left kink on the way back out.",
    8: "Right kink past the closed junction. The row of six stacks is on your left.",
    9: "Left onto the north straight.",
    10: "North chicane: row 1 on your right, middle row on your left (use the strip beside the road), row 3 on your right.",
    11: "Fast left kink towards the west loop.",
    12: "West loop: a long left.",
    13: "Long right at the end of the west straight. Late apex.",
    14: "S-bend 1: left. Stack on the inside.",
    15: "S-bend 2: right, round the island.",
    16: "S-bend 3: tight left onto the start straight. Stack on the inside.",
}


def read_ai():
    b = open(os.path.join(OUT, "ai", "fast_lane.ai"), "rb").read()
    n = struct.unpack_from("<4i", b, 0)[1]
    rec = np.frombuffer(b, np.dtype([("p", "<f4", 3), ("d", "<f4"), ("i", "<i4")]), n, 16)
    m = struct.unpack_from("<i", b, 16 + n * 20)[0]
    extra = np.frombuffer(b, "<f4", m * 18, 20 + n * 20).reshape(m, 18)
    return rec["p"].astype(float), extra.astype(float)


def make_plan() -> dict:
    p, ex = read_ai()
    n = len(p)
    v, brake, gas, left, right = ex[:, 0], ex[:, 2], ex[:, 1], ex[:, 5], ex[:, 6]
    d = np.roll(p, -1, axis=0) - p
    seg = np.linalg.norm(d, axis=1)
    lap = float(seg.sum())
    a, b = (p - np.roll(p, 1, axis=0))[:, [0, 2]], d[:, [0, 2]]
    cross = a[:, 1] * b[:, 0] - a[:, 0] * b[:, 1]                         # + = turning left
    k = 2 * cross / np.maximum(np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) * np.linalg.norm(a + b, axis=1), 1e-9)
    k = periodic_gauss(k, 3.0)
    sign = np.where(np.abs(k) > 1 / BEND_R, np.sign(k), 0).astype(int)
    for _ in range(2):                                                    # close gaps of up to 8 m inside one corner
        for i in range(n):
            if sign[i] == 0:
                j = 1
                while j <= 8 and sign[(i + j) % n] == 0:
                    j += 1
                if j <= 8 and sign[(i - 1) % n] != 0 and sign[(i - 1) % n] == sign[(i + j) % n]:
                    sign[i] = sign[(i - 1) % n]
    corners, i = [], 0
    start = int(np.argmin(np.abs(sign)))                                  # begin the search on a straight
    idx = (start + np.arange(n)) % n
    while i < n:
        if sign[idx[i]] != 0:
            j = i
            while j < n and sign[idx[j]] == sign[idx[i]]:
                j += 1
            run = idx[i:j]
            angle = float(np.degrees(np.sum(k[run] * seg[run])))
            if abs(angle) >= BEND_DEG:
                room = left[run] if angle > 0 else right[run]             # room to the inside of the bend
                near = np.where(room <= room.min() + 0.15)[0]
                tight = np.argsort(-np.abs(k[run]))[: max(3, len(run) // 4)]
                both = np.intersect1d(near, tight)
                apex = int(run[int(np.median(both if len(both) else near))])
                corners.append(dict(first=int(run[0]), last=int(run[-1]), apex=apex, left=bool(angle > 0), angle=round(abs(angle)), radius=round(float(1 / np.abs(k[run]).max()), 1),
                                    apex_kmh=round(float(v[apex] * 3.6)), min_kmh=round(float(v[run].min() * 3.6))))
            i = j
        else:
            i += 1
    corners.sort(key=lambda c: c["first"])
    for q, c in enumerate(corners):
        c["n"] = q + 1
    # frames: the car at the guide speed, FPS pictures per second, from LEAD_IN before the line to the line again
    t_of = np.concatenate([[0], np.cumsum(seg / np.maximum(v, 3.0))])     # time at each point, one lap
    s0 = n - int(LEAD_IN)
    order = (s0 + np.arange(n + int(LEAD_IN) + 1)) % n
    tt = np.concatenate([[0], np.cumsum((seg / np.maximum(v, 3.0))[order[:-1]])])
    frames = np.interp(np.arange(0, tt[-1], 1.0 / FPS), tt, np.arange(len(order), dtype=float))
    stations = (s0 + frames) % n
    plan = dict(lap_m=lap, lap_s=float(t_of[-1]), points=n, fps=FPS, corners=corners, stations=stations.round(3).tolist(), event=EVENT,
                notes={str(c["n"]): NOTES[c["n"]] for c in corners} if len(corners) == len(NOTES) else {})
    os.makedirs(DIR, exist_ok=True)
    json.dump(plan, open(os.path.join(DIR, "plan.json"), "w"))
    return plan


def at(arr: np.ndarray, s):
    """Value of a per-point array at fractional point numbers s (closed loop)."""
    s = np.asarray(s, float)
    n = len(arr)
    a = np.floor(s).astype(int) % n
    f = (s - np.floor(s))
    f = f if arr.ndim == 1 else f[..., None]
    return arr[a] * (1 - f) + arr[(a + 1) % n] * f


# --- 3D: the racing line and the apex posts, then the frames --------------------------------------------------------

def render_frames(first: int, last: int) -> None:
    import bpy
    from mathutils import Vector

    import render as R
    plan = json.load(open(os.path.join(DIR, "plan.json")))
    p, ex = read_ai()
    n = len(p)
    scene, _ = R.load_scene()
    cam = R.setup(scene)
    scene.cycles.samples = 6
    scene.cycles.max_bounces = 2
    scene.render.resolution_x, scene.render.resolution_y = SIZE
    scene.render.use_persistent_data = True
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92

    def emit(name, rgb, strength):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out, em = nt.nodes.new("ShaderNodeOutputMaterial"), nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*rgb, 1.0)
        em.inputs["Strength"].default_value = strength
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        return mat
    mats = [emit("line_brake", (1.0, 0.05, 0.03), 1.6), emit("line_coast", (1.0, 0.75, 0.05), 1.4), emit("line_gas", (0.05, 0.9, 0.15), 1.3),
            emit("line_apex", (1.0, 0.1, 0.9), 2.5)]
    d = np.roll(p, -1, axis=0) - np.roll(p, 1, axis=0)
    d[:, 1] = 0
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    side = np.column_stack([d[:, 2], np.zeros(n), -d[:, 0]])              # the driver's left
    apex = np.zeros(n, bool)
    for c in plan["corners"]:
        apex[(c["apex"] + np.arange(-2, 3)) % n] = True
    kind = np.where(apex, 3, np.where(ex[:, 2] > 0.05, 0, np.where(ex[:, 1] >= 0.6, 2, 1)))
    half = np.where(apex, 0.55, 0.16)
    up = np.array([0.0, 0.035, 0.0])
    verts = np.vstack([p + side * half[:, None] + up, p - side * half[:, None] + up])
    faces = [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    me = bpy.data.meshes.new("briefing_line")
    me.from_pydata(R.to_bl(verts).tolist(), [], faces)
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", kind.tolist())
    ob = bpy.data.objects.new("briefing_line", me)
    scene.collection.objects.link(ob)
    ob.visible_shadow = False
    # a post at each apex, on the inside edge of the room the line has there
    pv, pf = [], []
    for c in plan["corners"]:
        i = c["apex"]
        room = ex[i, 5] if c["left"] else ex[i, 6]
        base = p[i] + side[i] * (1.0 if c["left"] else -1.0) * max(1.0, min(room, 3.0) - 0.2)
        r, h, o = 0.07, 2.4, len(pv)
        for dx, dz in ((-r, -r), (r, -r), (r, r), (-r, r)):
            pv += [base + np.array([dx, 0.0, dz]), base + np.array([dx, h, dz])]
        for q in range(4):
            a0, a1, b0, b1 = o + 2 * q, o + 2 * q + 1, o + 2 * ((q + 1) % 4), o + 2 * ((q + 1) % 4) + 1
            pf.append((a0, b0, b1, a1))
        top = base + np.array([0.0, h, 0.0])                              # a flag: a square facing the oncoming car
        o = len(pv)
        pv += [top + side[i] * 0.45, top - side[i] * 0.45, top - side[i] * 0.45 + np.array([0, 0.6, 0]), top + side[i] * 0.45 + np.array([0, 0.6, 0])]
        pf.append((o, o + 1, o + 2, o + 3))
    me2 = bpy.data.meshes.new("briefing_apex")
    me2.from_pydata(R.to_bl(np.array(pv)).tolist(), [], pf)
    me2.materials.append(mats[3])
    ob2 = bpy.data.objects.new("briefing_apex", me2)
    scene.collection.objects.link(ob2)
    ob2.visible_shadow = False
    os.makedirs(FRAMES, exist_ok=True)
    st = np.array(plan["stations"])
    upv = np.array([0.0, 1.0, 0.0])
    for f in range(first, min(last, len(st))):
        path = os.path.join(FRAMES, f"f_{f:05d}.jpg")
        if os.path.exists(path):
            continue
        eye = at(p, st[f]) + upv * EYE
        tgt = (at(p, st[f] + LOOK * 0.6) + at(p, st[f] + LOOK * 1.4)) / 2 + upv * 0.55
        R.aim(cam, eye, tgt, 78.0)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("frame", f, flush=True)


# --- 2D: text, map, encoding ----------------------------------------------------------------------------------------

def _font(size: int):
    from PIL import ImageFont
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _north_up(p: np.ndarray) -> np.ndarray:
    """(east, north) of world points, so that the map of the video is north-up like the organiser's map."""
    fr = json.load(open(os.path.join(SRC, "work", "build_summary.json")))["frame"]
    f = np.array(fr["fwd_en"]) / np.linalg.norm(fr["fwd_en"])
    left = np.array([-f[1], f[0]])
    q = np.atleast_2d(p)
    return np.array(fr["origin_en"]) + q[:, [0]] * left + q[:, [2]] * f


def _map_xy(p: np.ndarray, box: tuple[int, int, int, int]):
    """North-up top view of the lap in a box (x0, y0, w, h) of the picture."""
    x0, y0, w, h = box
    en = _north_up(p)
    lo, hi = en.min(0), en.max(0)
    sc = min((w - 16) / (hi[0] - lo[0]), (h - 16) / (hi[1] - lo[1]))
    ce, cn = (lo + hi) / 2

    def xy(q):
        e = _north_up(q)
        return x0 + w / 2 + (e[:, 0] - ce) * sc, y0 + h / 2 - (e[:, 1] - cn) * sc
    return xy


def make_video() -> None:
    from PIL import Image, ImageDraw
    plan = json.load(open(os.path.join(DIR, "plan.json")))
    p, ex = read_ai()
    n = len(p)
    st = np.array(plan["stations"])
    corners, notes = plan["corners"], plan["notes"]
    W, H = SIZE
    big, mid, small = _font(30), _font(20), _font(15)
    out_dir = os.path.join(DIR, "out")
    os.makedirs(out_dir, exist_ok=True)
    kind = np.where(ex[:, 2] > 0.05, 0, np.where(ex[:, 1] >= 0.6, 2, 1))
    cols = [(235, 40, 30), (240, 190, 30), (40, 210, 70)]

    def draw_map(d, box, dot=None, numbers=False, width=2):
        xy = _map_xy(p, box)
        x, y = xy(p)
        for i in range(n):
            j = (i + 1) % n
            d.line([(x[i], y[i]), (x[j], y[j])], fill=cols[kind[i]], width=width)
        mx, my = float(np.mean(x)), float(np.mean(y))
        for c in corners:
            ax, ay = (float(v_[0]) for v_ in xy(p[c["apex"]]))
            r = 3 if not numbers else 5
            d.ellipse([ax - r, ay - r, ax + r, ay + r], fill=(255, 40, 230))
            if numbers:                                                   # the number stands outside the lap, away from its middle
                ux, uy = ax - mx, ay - my
                ln = max(float(np.hypot(ux, uy)), 1e-6)
                tx, ty = ax + ux / ln * 20 - 9, ay + uy / ln * 20 - 12
                if c["n"] in (14, 15, 16):                                # the three corners of the S-bend lie close together
                    tx, ty = ax - 44 + (c["n"] - 14) * 6, ay - 34 + (c["n"] - 14) * 24
                d.text((tx, ty), str(c["n"]), fill=(255, 255, 255), font=mid, stroke_width=2, stroke_fill=(0, 0, 0))
        sx, sy = (float(v_[0]) for v_ in xy(p[0]))
        d.rectangle([sx - 4, sy - 4, sx + 4, sy + 4], fill=(255, 255, 255))
        if numbers:
            d.text((sx + 8, sy + 2), "start", fill=(255, 255, 255), font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        if dot is not None:
            dx, dy = (float(v_[0]) for v_ in xy(at(p, dot)))
            d.ellipse([dx - 6, dy - 6, dx + 6, dy + 6], fill=(255, 255, 255), outline=(0, 0, 0), width=2)

    def card(lines, k):
        im = Image.new("RGB", SIZE, (14, 16, 20))
        d = ImageDraw.Draw(im)
        draw_map(d, (W - 500, 40, 480, H - 60), numbers=True, width=3)
        y = 34
        for text, font, col in lines:
            d.text((30, y), text, fill=col, font=font)
            y += font.size + 10
        im.save(os.path.join(out_dir, f"o_{k:05d}.jpg"), quality=92)

    white, grey, pink = (240, 240, 240), (170, 175, 185), (255, 90, 235)
    intro = [("TRACK BRIEFING", big, white), ("Autodrom Sosnová", big, white), (plan["event"], mid, white), ("", small, grey),
             (f"{plan['lap_m']:.0f} m on the racing line, anticlockwise", mid, grey), (f"{len(corners)} corners, numbered on the map", mid, grey), ("", small, grey),
             ("Line on the road:", mid, white), ("  red = brake", mid, cols[0]), ("  yellow = roll", mid, cols[1]), ("  green = throttle", mid, cols[2]),
             ("  pink post and pink band = apex", mid, pink), ("", small, grey),
             ("Speeds are a computer estimate,", small, grey), ("not a measured lap. The track was", small, grey), ("not tested in the game.", small, grey)]
    k = 0
    for _ in range(FPS * 6):
        card(intro, k)
        k += 1
    frames = sorted(f for f in os.listdir(FRAMES) if f.endswith(".jpg"))
    assert len(frames) == len(st), f"{len(frames)} frames rendered, {len(st)} planned"
    v = ex[:, 0]
    for f, name in enumerate(frames):
        im = Image.open(os.path.join(FRAMES, name)).convert("RGBA")
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        s = st[f]
        # which corner: the one we are in, or the next one within 90 m
        cur, dist = None, 1e9
        for c in corners:
            to_apex = (c["apex"] - s + n / 2) % n - n / 2                  # metres to the apex (points are 1 m apart)
            to_first = (c["first"] - s + n / 2) % n - n / 2
            to_last = (c["last"] - s + n / 2) % n - n / 2
            if to_first <= 90 and to_last >= -6 and to_apex < dist:
                if to_apex > -8 or to_last >= 0:
                    cur, dist = c, to_apex
        d.rectangle([0, 0, W, 74], fill=(0, 0, 0, 150))
        if cur:
            side = "LEFT" if cur["left"] else "RIGHT"
            title = f"T{cur['n']}  {side}  {cur['angle']}°"
            d.text((16, 6), title, fill=white, font=big)
            d.text((30 + d.textlength(title, font=big), 16), f"about {cur['apex_kmh']} km/h at the apex", fill=(225, 225, 225), font=small)
            d.text((16, 48), notes.get(str(cur["n"]), ""), fill=(225, 225, 225), font=small)
            if abs(dist) <= 4:
                d.rectangle([W // 2 - 90, 92, W // 2 + 90, 138], fill=(255, 40, 230, 220))
                d.text((W // 2 - 50, 96), "APEX", fill=(255, 255, 255), font=big)
            elif dist > 0:
                label = f"apex in {dist:.0f} m"
                d.text((W - 16 - d.textlength(label, font=mid), 12), label, fill=pink, font=mid)
        else:
            d.text((16, 18), "straight", fill=grey, font=mid)
        d.rectangle([0, H - 62, 262, H], fill=(0, 0, 0, 150))
        i = int(s) % n
        state = ("BRAKE", cols[0]) if kind[i] == 0 else (("THROTTLE", cols[2]) if kind[i] == 2 else ("ROLL", cols[1]))
        d.text((14, H - 58), f"{float(at(v, s)) * 3.6:3.0f} km/h", fill=white, font=big)
        d.text((168, H - 50), state[0], fill=state[1], font=small)
        d.text((14, H - 22), f"guide speed   {s if s < n - 80 or f > len(st) / 2 else s - n:5.0f} m", fill=grey, font=small)
        d.rectangle([W - 216, H - 196, W, H], fill=(0, 0, 0, 150))
        draw_map(d, (W - 212, H - 192, 208, 188), dot=s)
        Image.alpha_composite(im, ov).convert("RGB").save(os.path.join(out_dir, f"o_{k:05d}.jpg"), quality=92)
        k += 1
    table = [("CORNERS", big, white)] + [(f"T{c['n']:<2d} {'left ' if c['left'] else 'right'} {c['angle']:3d}°   apex about {c['apex_kmh']:3d} km/h", small, white) for c in corners]
    table += [("", small, grey), (f"guide lap: {plan['lap_s']:.0f} s (computer estimate)", small, grey)]
    for _ in range(FPS * 6):
        card(table, k)
        k += 1
    mp4 = os.path.join(DIR, "briefing.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(out_dir, "o_%05d.jpg"), "-vf", "fps=24", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], check=True)
    print(mp4, f"{os.path.getsize(mp4) / 1e6:.1f} MB, {k} pictures, {k / FPS:.0f} s")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if what == "plan":
        pl = make_plan()
        print(f"lap {pl['lap_m']:.0f} m, guide lap {pl['lap_s']:.1f} s, {len(pl['stations'])} frames at {FPS} per second")
        for c in pl["corners"]:
            print(f"  T{c['n']:<2d} {'left ' if c['left'] else 'right'} {c['angle']:3d} deg  R {c['radius']:5.1f} m  points {c['first']:4d}-{c['last']:4d}  apex {c['apex']:4d}  about {c['apex_kmh']} km/h")
    elif what == "frames":
        a, b = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 10 ** 9)
        render_frames(a, b)
    elif what == "video":
        make_video()
