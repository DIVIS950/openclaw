"""The race equipment of the organiser's layout.

From the map: a tyre stack at each yellow dot, yellow bags and tape along each row of dots.
What the map leaves to the marshals (circuit.RACE_EXTRAS): red and white plastic barriers across the side roads of
the route, tape on posts along the open squares, arrow boards at the chicanes and on the hairpin, cones.
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from solid import Soup, _ring, tube  # noqa: E402
from track import Parts, Track  # noqa: E402

UP = np.array([0.0, 1.0, 0.0])
ROW_GAP = 7.0            # dots closer than this stand in one row (m): on the map the dots of a row are 2.4 to 5.2 m
                         # apart, and the four single stacks on the pad of turn 1 are 8.4 m and more apart
TAPE_H = 0.90            # height of barrier tape at its supports (m)
POST_STEP = 4.0          # distance between the posts of a tape line (m)
MODULE = 1.25            # length of one plastic barrier (m)


# --- rows of dots -------------------------------------------------------------------------------------------------

def race_rows(tr: Track, max_gap: float = ROW_GAP) -> list[np.ndarray]:
    """The yellow dots of the organiser's map grouped into rows: dots closer than max_gap belong to one row. The
    dots of a row are joined along the shortest tree that links them, so an L- or U-shaped row keeps its corners and
    no two dots are joined over a gap. Each row comes back as a chain of points in order (a row with a branch gives
    one chain per arm); a single dot is a chain of one."""
    c = np.asarray(tr.cones_en, float).reshape(-1, 2)
    n = len(c)
    d = np.linalg.norm(c[:, None, :] - c[None, :, :], axis=2) if n else np.zeros((0, 0))
    group = list(range(n))

    def find(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if d[i, j] <= max_gap:
                group[find(i)] = find(j)
    members: dict[int, list[int]] = {}
    for i in range(n):
        members.setdefault(find(i), []).append(i)
    out = []
    for ids in members.values():
        if len(ids) == 1:
            out.append(c[ids])
            continue
        adj: dict[int, list[int]] = {i: [] for i in ids}             # shortest tree (Prim)
        inside, rest = [ids[0]], set(ids[1:])
        while rest:
            a, b = min(((i, j) for i in inside for j in rest), key=lambda e: d[e[0], e[1]])
            adj[a].append(b), adj[b].append(a)
            inside.append(b), rest.discard(b)
        used: set[frozenset] = set()
        start = min((i for i in ids if len(adj[i]) == 1), default=ids[0])
        pending = [(start, adj[start][0])]
        while pending:
            a, b = pending.pop()
            if frozenset((a, b)) in used:
                continue
            chain = [a, b]
            used.add(frozenset((a, b)))
            cur = b
            while True:
                nxt = [w for w in adj[cur] if frozenset((cur, w)) not in used]
                if not nxt:
                    break
                pending += [(cur, w) for w in nxt[1:]]
                used.add(frozenset((cur, nxt[0])))
                chain.append(nxt[0])
                cur = nxt[0]
            out.append(c[chain])
    return out


def race_barrier_lines(tr: Track) -> list[dict]:
    """Yellow soft bags that fill each row between its tyre stacks (east/north polylines)."""
    out = []
    for row in race_rows(tr):
        for a, b in zip(row[:-1], row[1:]):
            d = float(np.linalg.norm(b - a))
            if d < 2.2:
                continue
            u = (b - a) / d
            out.append(dict(en=[(a + u * 0.55).round(2).tolist(), (b - u * 0.55).round(2).tolist()], width=0.62, height=0.52, material="bags"))
    return out


# --- what the map leaves to the marshals ----------------------------------------------------------------------------

def extra_lines(tr: Track) -> list[dict]:
    """circuit.RACE_EXTRAS as east/north polylines with a point every half metre: dict(name, kind, en, arrows)."""
    import circuit
    from common import RACE_LAYOUT
    from scipy.ndimage import gaussian_filter1d
    if not RACE_LAYOUT:
        return []
    out = []
    for spec in circuit.RACE_EXTRAS:
        pts = []
        if "head_dot" in spec:
            pts.append(np.asarray(tr.cones_en[spec["head_dot"] - 1], float)[None, :])
        if "st" in spec:
            a, b = spec["st"]
            side = 1.0 if spec["side"] == "l" else -1.0
            w = gaussian_filter1d(np.tile(tr.wl if side > 0 else tr.wr, 3), 3.0)[tr.n: 2 * tr.n]
            st = np.arange(float(a), float(b) + 0.25, 0.5)
            pts.append(tr.en(st, side * (tr.interp(w, st) + spec.get("off", 1.5))))
        if "en" in spec:
            pts.append(np.asarray(spec["en"], float).reshape(-1, 2))
        if "tail_dot" in spec:
            pts.append(np.asarray(tr.cones_en[spec["tail_dot"] - 1], float)[None, :])
        p = np.vstack(pts)
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        m = max(2, int(round(s[-1] / 0.5)) + 1)
        t = np.linspace(0, s[-1], m)
        en = np.column_stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])])
        out.append(dict(name=spec["name"], kind=spec["kind"], en=en, arrows=bool(spec.get("arrows")), length=float(s[-1])))
    return out


def solid_points(tr: Track) -> np.ndarray:
    """Everything solid that the race layout sets on or beside the road, as points (east, north, radius): the tyre
    stacks, the bags between the stacks of a row (a point every 25 cm) and the plastic barriers."""
    out = [np.column_stack([np.asarray(tr.cones_en, float).reshape(-1, 2), np.full(len(tr.cones_en), 0.34)])]
    lines = [(np.asarray(b["en"], float), 0.32) for b in race_barrier_lines(tr)] + [(e["en"], 0.26) for e in extra_lines(tr) if e["kind"] == "barrier"]
    for en, r in lines:
        s, at = _along(en)
        q = at(np.linspace(0, s[-1], max(2, int(s[-1] / 0.25) + 1)))
        out.append(np.column_stack([q, np.full(len(q), r)]))
    return np.vstack(out)


def _along(en: np.ndarray):
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(en, axis=0), axis=1))])
    return s, (lambda t: np.column_stack([np.interp(t, s, en[:, 0]), np.interp(t, s, en[:, 1])]))


# cross-section of a plastic road barrier: (half width, height), from the foot to the top
_BARRIER = np.array([(0.25, 0.0), (0.25, 0.13), (0.13, 0.45), (0.09, 0.80)])


def build_plastic_barriers(tr: Track, parts: Parts, lines: list[dict], seed: int = 23) -> dict:
    """Red and white plastic road barriers, one module after the other along each line: the closed side roads of the
    route. Each module is a single body with the foot and the taper of the real thing; red and white alternate."""
    rng = np.random.default_rng(seed)
    body = Soup()
    count, total = 0, 0.0
    sec = np.vstack([np.column_stack([-_BARRIER[:, 0], _BARRIER[:, 1]]), np.column_stack([_BARRIER[::-1, 0], _BARRIER[::-1, 1]])])   # left foot .. top .. right foot
    for line in lines:
        s, at = _along(line["en"])
        n = int(s[-1] // (MODULE + 0.05))
        if n < 1:
            continue
        pitch = s[-1] / n
        for k in range(n):
            a, b = at(np.array([k * pitch + 0.03]))[0], at(np.array([(k + 1) * pitch - 0.03]))[0]
            d = (b - a) / max(float(np.linalg.norm(b - a)), 1e-9)
            turn = rng.normal(0, 0.02)                                  # nobody sets them down dead straight
            d = np.array([d[0] * np.cos(turn) - d[1] * np.sin(turn), d[0] * np.sin(turn) + d[1] * np.cos(turn)])
            mid = (a + b) / 2 + np.array([-d[1], d[0]]) * rng.normal(0, 0.02)
            a, b = mid - d * (pitch / 2 - 0.03), mid + d * (pitch / 2 - 0.03)
            nrm = np.array([-d[1], d[0]])
            u0 = 0.03 if (count % 2 == 0) else 0.53                     # red, then white
            rows, uvs = [], []
            for t, c in ((0.0, a), (1.0, b)):
                en = c[None, :] + nrm[None, :] * sec[:, :1]
                g = float(tr.H.ground(c[None, :])[0]) - tr.fr.ref
                xz = tr.fr.xz(en)
                rows.append(np.column_stack([xz[:, 0], g - 0.02 + sec[:, 1], xz[:, 1]]))
                uvs.append(np.column_stack([np.full(len(sec), u0 + 0.19 * t), sec[:, 1] / 0.80]))
            pos, m = np.vstack(rows), len(sec)
            i = np.arange(m - 1)
            tris = [np.stack([i, i + 1, m + i + 1], -1), np.stack([i, m + i + 1, m + i], -1)]
            for p0 in (0, m):                                           # the two ends
                tris.append(np.stack([np.full(m - 2, p0), p0 + np.arange(1, m - 1), p0 + np.arange(2, m)], -1))
            c3 = pos.mean(0)
            body.add(pos, np.vstack(uvs), np.concatenate(tris), (c3[0], c3[1] - 0.2, c3[2]))
            count += 1
        total += float(s[-1])
    tris = body.flush(parts, "1WALL_barricade", "barricade", smooth=False, cast_shadows=True)
    return dict(plastic_barriers=count, plastic_barrier_m=round(total), plastic_barrier_rows=len(lines), plastic_barrier_triangles=int(tris))


class _Tape:
    """Collects strips of barrier tape (for the eye only: a car goes through tape)."""

    def __init__(self, tr: Track):
        self.tr, self.P, self.U, self.T, self.HN, self.off, self.total = tr, [], [], [], [], 0, 0.0

    def span(self, a: np.ndarray, b: np.ndarray, h: float = TAPE_H, width: float = 0.075, u0: float = 0.0) -> None:
        """Tape from a to b (east/north), hung at height h at both ends, sagging a little in between."""
        tr = self.tr
        d = float(np.linalg.norm(b - a))
        if d < 0.3:
            return
        m = max(2, int(d / 0.7) + 2)
        t = np.linspace(0, 1, m)
        en = a[None, :] + (b - a)[None, :] * t[:, None]
        g = tr.H.ground(np.array([a, b]))
        y = g[0] + (g[1] - g[0]) * t + h - 0.0025 * d * d * 4 * t * (1 - t)    # 4 cm of sag over 4 m
        self.P.append(np.vstack([tr.fr.world(en, y), tr.fr.world(en, y + width)]))
        u = u0 + t * d
        self.U.append(np.vstack([np.column_stack([u, np.full(m, 0.3)]), np.column_stack([u, np.full(m, 0.6)])]))
        r = np.arange(m - 1)
        self.T.append(np.concatenate([np.stack([r, r + 1, r + m + 1], -1), np.stack([r, r + m + 1, r + m], -1)]) + self.off)
        side = tr.fr.vec(np.array([[-(b - a)[1], (b - a)[0]]]) / d)[0]
        self.HN.append(np.tile(np.array([[side[0], 0.0, side[1]]]), (2 * (m - 1), 1)))
        self.off += 2 * m
        self.total += d

    def flush(self, parts: Parts, group: str) -> None:
        if self.P:
            parts.surface(group, "barricade", np.vstack(self.P), np.vstack(self.U), np.vstack(self.T), hint=np.vstack(self.HN), smooth=False,
                          double_sided=True, cast_shadows=False)


def build_tape(tr: Track, parts: Parts) -> dict:
    """Red and white barrier tape strung from tyre stack to tyre stack along each row, above the bags."""
    tape = _Tape(tr)
    for row in race_rows(tr):
        for a, b in zip(row[:-1], row[1:]):
            tape.span(a, b, h=0.82)
    tape.flush(parts, "TAPE_rows")
    return dict(tape_m=round(tape.total))


def tape_posts(line: dict) -> np.ndarray:
    """Where the posts of a tape line stand (east/north): one every POST_STEP metres or so, at both ends too."""
    s, at = _along(line["en"])
    return at(np.linspace(0, s[-1], max(1, int(round(s[-1] / POST_STEP))) + 1))


def tape_length(lines: list[dict]) -> float:
    """Metres of tape strung from post to post along the lines."""
    return float(sum(np.linalg.norm(np.diff(tape_posts(e), axis=0), axis=1).sum() for e in lines))


def build_tape_lines(tr: Track, parts: Parts, lines: list[dict]) -> dict:
    """Tape on posts along the edges of the open squares: an orange post with a white band on a rubber foot every
    four metres (a stake cannot be driven into asphalt), and red and white tape from post to post."""
    tape = _Tape(tr)
    post, foot = Soup(), Soup()
    posts = 0
    for line in lines:
        q = tape_posts(line)
        g = tr.H.ground(q) - tr.fr.ref
        for (x, z), y in zip(tr.fr.xz(q), g):
            tube(foot, (x, z), 0.17, 0.13, y - 0.01, y + 0.06, 8, cap=True, cap_uv=(0.5, 0.02))
            tube(post, (x, z), 0.035, 0.03, y + 0.06, y + TAPE_H + 0.12, 6, u_rep=1.0, v_rep=1.0, cap=True, cap_uv=(0.5, 0.9))
            posts += 1
        for a, b in zip(q[:-1], q[1:]):
            tape.span(a, b)
    tape.flush(parts, "TAPE_lines")
    post.flush(parts, "POSTS_tape", "cone", cast_shadows=True)
    foot.flush(parts, "POSTS_feet", "tyredark", smooth=False, cast_shadows=False)
    return dict(tape_lines=len(lines), tape_line_m=round(tape.total), tape_posts=posts)


# --- tyre stacks ----------------------------------------------------------------------------------------------------

# one tyre from the side: (radius, height) from the lower bead over the tread to the upper bead
_TYRE = np.array([(0.250, 0.000), (0.305, 0.022), (0.335, 0.065), (0.335, 0.160), (0.305, 0.203), (0.250, 0.225)])
STACK_H = 0.90


def build_tyre_stacks(tr: Track, parts: Parts, seed: int = 29) -> dict:
    """Tyre stacks of the race layout: one at every yellow dot of the organiser's map (tr.cones_en). Four single
    tyres, each with its round shoulders and a little out of line with the one below, and the hole down the middle.
    What a car hits is a plain core inside them."""
    rng = np.random.default_rng(seed)
    SIDES = 12
    rubber, hole, core = Soup(), Soup(), Soup()
    k = np.arange(SIDES)
    for c in np.asarray(tr.cones_en, float).reshape(-1, 2):
        g = float(tr.H.ground(np.array([c]))[0]) - tr.fr.ref
        x0, z0 = tr.fr.xz(c[None, :])[0]
        tube(core, (x0, z0), 0.30, 0.30, g - 0.15, g + STACK_H - 0.04, 10, cap=True, cap_uv=(0.5, 0.02))
        for j in range(4):
            x, z = x0 + rng.normal(0, 0.012), z0 + rng.normal(0, 0.012)
            cx, sx, u = _ring(SIDES, rng.uniform(0, 2 * np.pi))
            rows, uvs = [], []
            for r, y in _TYRE:
                rows.append(np.column_stack([x + cx * r, np.full(SIDES + 1, g + j * 0.225 + y), z + sx * r]))
                uvs.append(np.column_stack([u * 3.0, np.full(SIDES + 1, (j + 0.04 + 0.92 * y / 0.225) / 4.0)]))
            tris = []
            for i in range(len(_TYRE) - 1):
                a, b = i * (SIDES + 1), (i + 1) * (SIDES + 1)
                tris += [np.stack([a + k, a + k + 1, b + k + 1], -1), np.stack([a + k, b + k + 1, b + k], -1)]
            rubber.add(np.vstack(rows), np.vstack(uvs), np.concatenate(tris), (x, g + j * 0.225 + 0.11, z))
            if j == 3:                                                  # the top: the sidewall of the last tyre and its hole
                outer = np.column_stack([x + cx * 0.250, np.full(SIDES + 1, g + STACK_H), z + sx * 0.250])
                inner = np.column_stack([x + cx * 0.185, np.full(SIDES + 1, g + STACK_H - 0.012), z + sx * 0.185])
                rubber.add(np.vstack([outer, inner]), np.tile((0.5, 0.94), (2 * (SIDES + 1), 1)),
                           np.concatenate([np.stack([k, k + 1, k + SIDES + 2], -1), np.stack([k, k + SIDES + 2, k + SIDES + 1], -1)]), (x, g + STACK_H - 1.0, z))
                deep = np.vstack([inner[:SIDES] - UP * 0.10, [(x, g + STACK_H - 0.115, z)]])       # the dark of the hole
                hole.add(deep, np.tile((0.5, 0.02), (SIDES + 1, 1)), np.stack([np.full(SIDES, SIDES), k, (k + 1) % SIDES], -1), (x, g + STACK_H - 1.0, z))
    n = rubber.flush(parts, "TYRES_race", "tyres", cast_shadows=True)
    n += hole.flush(parts, "TYRES_raceholes", "tyredark", smooth=False, cast_shadows=False)
    core.flush(parts, "1WALL_tyrestacks", "tyredark", smooth=False, cast_shadows=False)
    return dict(tyre_stacks=len(tr.cones_en), tyre_stack_triangles=int(n))


# --- arrow boards and cones ---------------------------------------------------------------------------------------

def _board(tr: Track, parts: Parts, legs: Soup, centre_en: np.ndarray, face_en: np.ndarray, point_en: np.ndarray, y0: float, w: float = 1.1, h: float = 0.45) -> None:
    """A board at centre_en whose front faces face_en, with its arrow pointing along point_en (all east/north);
    y0 is the height of its lower edge above the ground."""
    g = float(tr.H.ground(centre_en[None, :])[0]) - tr.fr.ref
    f = tr.fr.vec(face_en[None, :] / np.linalg.norm(face_en))[0]
    n3 = np.array([f[0], 0.0, f[1]])                                    # towards the viewer
    right = np.cross(-n3, UP)                                           # the viewer's right
    x, z = tr.fr.xz(centre_en[None, :])[0]
    c = np.array([x, g, z])
    a, b = c - right * w / 2, c + right * w / 2
    p = np.array([a + UP * y0, b + UP * y0, b + UP * (y0 + h), a + UP * (y0 + h)])
    pe = tr.fr.vec(point_en[None, :])[0]
    forward = float(np.array([pe[0], 0.0, pe[1]]) @ right) > 0           # the arrow of the picture points to +u
    parts.quad("SIGN_arrows", "arrow", p + n3 * 0.015, (0.0, 0.0, 1.0, 1.0) if forward else (1.0, 0.0, 0.0, 1.0), hint=n3, smooth=False)
    parts.quad("SIGN_arrows", "metal", p[[1, 0, 3, 2]] - n3 * 0.015, (0, 0, 1, 1), hint=-n3, smooth=False)
    for q in (a + right * 0.08, b - right * 0.08):
        tube(legs, (q[0], q[2]), 0.02, 0.02, g - 0.05, g + y0 + h, 5)


def build_arrow_boards(tr: Track, parts: Parts, lines: list[dict]) -> dict:
    """Arrow boards, as at the chicanes of a rally stage: one at every row of tyre stacks that stands across the
    route, pointing to the side the route passes on, and a board every few metres on the barriers that carry
    arrows (the outside of the hairpin), pointing the way round."""
    from scipy.spatial import cKDTree
    tree = cKDTree(tr.c)
    legs = Soup()
    count = 0
    for row in race_rows(tr):
        if len(row) < 2:
            continue
        dist, st = tree.query(row)
        e = 0 if dist[0] <= dist[-1] else len(row) - 1                  # the end of the row at the route
        nb = 1 if e == 0 else len(row) - 2
        k = int(st[e])
        lat = float((row[e] - tr.c[k]) @ tr.nrm[k])
        away = (row[nb] - row[e]) / max(float(np.linalg.norm(row[nb] - row[e])), 1e-9)
        if abs(lat) > 6.5 or abs(float(away @ tr.tan[k])) > 0.6:         # far from the route, or a row along it
            continue
        _board(tr, parts, legs, row[e] + away * 1.0, -tr.tan[k], -np.sign(lat) * tr.nrm[k], y0=1.02)
        count += 1
    for line in lines:
        if not line.get("arrows"):
            continue
        s, at = _along(line["en"])
        n = max(1, int(round(s[-1] / 7.0)))
        for q in at((np.arange(n) + 0.5) * s[-1] / n):
            k = int(tree.query(q)[1])
            _board(tr, parts, legs, q, tr.c[k] - q, tr.tan[k], y0=0.88)
            count += 1
    legs.flush(parts, "SIGN_arrowlegs", "metal", smooth=False, cast_shadows=False)
    return dict(arrow_boards=count)


def build_cones(tr: Track, parts: Parts, avoid=None) -> dict:
    """Orange traffic cones along the lap wherever it crosses open asphalt (junctions, the pit apron), one every 8 m,
    so the way of the race route is plain to see. Not where a barrier or a tape line (avoid, a shapely geometry)
    already marks the edge. They are for the eye only: a car passes through them."""
    from shapely.geometry import Point
    SEG = 8
    ang = np.linspace(0, 2 * np.pi, SEG + 1)
    ring = np.column_stack([np.cos(ang), np.sin(ang)])
    P, U, T, HN, off, count = [], [], [], [], 0, 0
    for side in (1, -1):
        w = tr.wl if side > 0 else tr.wr
        m = (tr.open_l & ~tr.conc_l) if side > 0 else (tr.open_r & ~tr.conc_r)
        if side > 0:
            m = m & ~tr.in_pit_stretch()
        for st in np.where(m)[0][::8]:
            c = tr.en(np.array([float(st)]), np.array([side * (w[st] + 0.25)]))[0]
            if avoid is not None and avoid.distance(Point(c)) < 3.0:
                continue
            g = float(tr.h(np.array([float(st)]), np.array([side * w[st]]))[0])
            base = tr.fr.world(c[None, :] + ring * 0.15, np.full(SEG + 1, g))
            tip = tr.fr.world(c[None, :] + ring * 0.025, np.full(SEG + 1, g + 0.52))
            out = tr.fr.vec(ring)
            n3 = np.column_stack([out[:, 0], np.full(SEG + 1, 0.3), out[:, 1]])
            P.append(np.vstack([base, tip]))
            U.append(np.vstack([np.column_stack([ang / (2 * np.pi), np.zeros(SEG + 1)]), np.column_stack([ang / (2 * np.pi), np.ones(SEG + 1)])]))
            r = np.arange(SEG)
            mid = n3[r] + n3[r + 1]
            HN.append(np.vstack([mid, mid]))
            T.append(np.concatenate([np.stack([r, r + SEG + 1, r + SEG + 2], -1), np.stack([r, r + SEG + 2, r + 1], -1)]) + off)
            off += 2 * (SEG + 1)
            count += 1
    if P:
        parts.surface("CONES_route", "cone", np.vstack(P), np.vstack(U), np.vstack(T), hint=np.vstack(HN), smooth=True)
    return dict(cones=count)
