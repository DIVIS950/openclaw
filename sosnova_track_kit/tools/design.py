"""The racetrack design laid over the survey: what makes the place read as a circuit rather than a survey.

  * the lap has one constant width, so both white lines run parallel all the way round
  * a grass verge of one width runs along both sides of the lap (except at the pit apron)
  * gravel traps of one depth sit on the outside of every real corner
  * the pit apron is a clean slab beside the start straight
  * every other road and paved area of the original circuit comes from the hand-traced layout in circuit.py:
    roads with one width along a smooth centre line, paved areas as clean polygons
"""
from __future__ import annotations

import os
import sys

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from track import Track, cyclic_runs  # noqa: E402

LAP_HALF = 4.5          # half width of the lap (m): 9 m of asphalt everywhere
VERGE = 4.0             # grass strip along both sides of the lap (m)
TRAP_R = 45.0           # corners tighter than this get a gravel trap on the outside
TRAP_DEPTH = 11.0       # depth of a gravel trap (m)
PIT_DEPTH = 20.0        # depth of the pit apron beside the start straight (m)


def verge(tr: Track, R: Polygon):
    """Grass strip beside the lap; left open where the pit apron joins the start straight."""
    v = R.buffer(VERGE).difference(R)
    st = np.where(tr.in_pit_stretch())[0]
    st = np.where(st > tr.n / 2, st - tr.n, st)
    s = np.arange(st.min() + 3, st.max() - 2).astype(float)
    inner, outer = tr.en(s, np.full_like(s, LAP_HALF - 0.05)), tr.en(s, np.full_like(s, LAP_HALF + VERGE + 0.5))
    import circuit
    v = v.difference(circuit.areas("road").buffer(0.5))            # the outside of turn 1 is asphalt up to the lap
    return v.difference(Polygon(np.vstack([inner, outer[::-1]])))


def pit_apron(tr: Track) -> Polygon:
    """The pit apron: a clean slab beside the start straight, with rounded corners."""
    st = np.where(tr.in_pit_stretch())[0]
    st = np.where(st > tr.n / 2, st - tr.n, st)
    s = np.arange(st.min(), st.max() + 1).astype(float)
    inner, outer = tr.en(s, np.full_like(s, LAP_HALF)), tr.en(s, np.full_like(s, LAP_HALF + PIT_DEPTH))
    p = Polygon(np.vstack([inner, outer[::-1]]))
    cut = Polygon(np.vstack([tr.en(s, np.full_like(s, LAP_HALF - 2.0)), tr.en(s, np.full_like(s, LAP_HALF + 3.0))[::-1]]))
    return unary_union([p.buffer(-3.0).buffer(3.0), p.intersection(cut)]).buffer(0)       # round only the far corners


def other_asphalt(tr: Track, R: Polygon):
    """The original circuit outside the lap, from the hand-traced layout in tools/circuit.py.

    Every real road is a ribbon of constant width along its own smooth centre line and joins the lap where the
    real road does; paved areas are clean polygons with rounded corners.
    Returns (all asphalt, paved areas, roads [(centre line east/north, width m)], roads polygon, concrete pads)."""
    import circuit
    roads = [(en, w) for _, en, w in circuit.roads()]
    roads_poly = unary_union([circuit.roads_polygon(), circuit.areas("road")]).buffer(0)
    clear = unary_union([verge(tr, R).buffer(0.05), roads_poly.buffer(VERGE)])     # the same grass verge beside every road

    def tidy(g):                                          # keep off the verge and off the roads; no slivers
        g = g.difference(clear)
        parts = [p.buffer(-1.2).buffer(1.2) for p in getattr(g, "geoms", [g]) if p.area > 60.0]
        return unary_union([p for p in parts if not p.is_empty and p.area > 60.0]) if parts else Polygon()
    pads = tidy(circuit.areas("pad"))
    paved = unary_union([tidy(circuit.areas("apron").difference(pads.buffer(1.0))), pit_apron(tr)]).buffer(0)
    A = unary_union([paved, pads, roads_poly]).buffer(0.3).buffer(-0.3).difference(R)
    A = unary_union([p for p in getattr(A, "geoms", [A]) if p.area > 15.0]).buffer(0).simplify(0.1)
    return A, paved, roads, roads_poly, pads


def gravel_pockets(A):
    """Gravel that belongs to the original circuit (not a trap of the lap); kept clear of the asphalt outline."""
    import circuit
    g = circuit.areas("gravel")
    return g.difference(A.buffer(0.35)).buffer(-0.3).buffer(0.3) if not g.is_empty else g


def gravel_traps(tr: Track, R: Polygon, avoid):
    """One gravel trap on the outside of every corner, behind the verge. avoid: asphalt, buildings."""
    traps = []
    for a, ln in cyclic_runs(np.abs(tr.k) > 1.0 / TRAP_R, 5, 8):
        side = -int(np.sign(tr.k[(a + ln // 2) % tr.n]))
        st = np.arange(a - 6, a + ln + 16).astype(float)
        m = len(st)
        ramp = np.clip(np.minimum(np.arange(m), m - 1 - np.arange(m)) / 9.0, 0, 1)
        depth = TRAP_DEPTH * ramp * ramp * (3 - 2 * ramp)
        ok = depth > 0.8
        if ok.sum() < 6:
            continue
        inner = tr.en(st[ok], np.full(ok.sum(), side * (LAP_HALF + VERGE)))
        outer = tr.en(st[ok], side * (LAP_HALF + VERGE + depth[ok]))
        p = Polygon(np.vstack([inner, outer[::-1]])).buffer(0)
        if not p.is_empty:
            traps.append(p)
    G = unary_union(traps).difference(unary_union([avoid.buffer(1.2), R.buffer(VERGE - 0.01)]))
    G = G.buffer(-0.8).buffer(1.6).buffer(-0.8).difference(unary_union([avoid.buffer(1.0), R.buffer(VERGE - 0.01)])).simplify(0.2)
    return unary_union([p for p in getattr(G, "geoms", [G]) if p.geom_type == "Polygon" and p.area > 60.0]).buffer(0)


def trap_barriers(tr: Track, G) -> list[dict]:
    """A padded barrier along the back of every gravel trap (east/north polylines)."""
    out = []
    for a, ln in cyclic_runs(np.abs(tr.k) > 1.0 / TRAP_R, 5, 8):
        side = -int(np.sign(tr.k[(a + ln // 2) % tr.n]))
        st = np.arange(a - 6, a + ln + 16).astype(float)
        m = len(st)
        ramp = np.clip(np.minimum(np.arange(m), m - 1 - np.arange(m)) / 9.0, 0, 1)
        depth = TRAP_DEPTH * ramp * ramp * (3 - 2 * ramp)
        ok = depth > 4.0
        if ok.sum() < 8:
            continue
        line = tr.en(st[ok], side * (LAP_HALF + VERGE + depth[ok] + 0.7))
        from shapely import contains_xy
        back = tr.en(st[ok], side * (LAP_HALF + VERGE + depth[ok] - 1.5))
        if contains_xy(G, back[:, 0], back[:, 1]).mean() > 0.7:                 # only where the trap was really built
            out.append(dict(en=line.round(2).tolist(), width=0.8, height=0.95))
    return out


def _road_trap_runs():
    """(road, slice, side, depth) of the gravel trap on the outside of every bend of the other roads."""
    import circuit
    for road in circuit.road_frames():
        k, m = road["k"], len(road["k"])
        on = np.abs(k) > 1.0 / TRAP_R
        d = np.diff(np.concatenate([[0], on.astype(int), [0]]))
        for a, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            if e - a < 10:
                continue
            side = -int(np.sign(k[(a + e) // 2]))
            sl = slice(max(0, a - 12), min(m, e + 32))
            n = sl.stop - sl.start
            ramp = np.clip(np.minimum(np.arange(n), n - 1 - np.arange(n)) / 18.0, 0, 1)
            yield road, sl, side, TRAP_DEPTH * ramp * ramp * (3 - 2 * ramp)


def road_gravel(R: Polygon, avoid):
    """Gravel traps on the outside of the bends of the other roads, behind their verge, like those of the lap."""
    import circuit
    traps = []
    for road, sl, side, depth in _road_trap_runs():
        ok = depth > 0.8
        if ok.sum() < 12:
            continue
        q, nrm = road["en"][sl][ok], road["nrm"][sl][ok] * side
        p = Polygon(np.vstack([q + nrm * (road["half"] + VERGE), (q + nrm * (road["half"] + VERGE + depth[ok])[:, None])[::-1]])).buffer(0)
        if not p.is_empty:
            traps.append(p)
    if not traps:
        return Polygon()
    keep_off = unary_union([avoid.buffer(1.2), R.buffer(VERGE - 0.01), circuit.roads_polygon().buffer(VERGE - 0.01)])
    G = unary_union(traps).difference(keep_off)
    G = G.buffer(-0.8).buffer(1.6).buffer(-0.8).difference(keep_off).simplify(0.2)
    return unary_union([p for p in getattr(G, "geoms", [G]) if p.geom_type == "Polygon" and p.area > 60.0]).buffer(0)


def road_barriers(G) -> list[dict]:
    """A padded barrier along the back of every road trap that was really built."""
    from shapely import contains_xy
    out = []
    for road, sl, side, depth in _road_trap_runs():
        ok = depth > 4.0
        if ok.sum() < 16:
            continue
        q, nrm = road["en"][sl][ok], road["nrm"][sl][ok] * side
        back = q + nrm * (road["half"] + VERGE + depth[ok] - 1.5)[:, None]
        if contains_xy(G, back[:, 0], back[:, 1]).mean() > 0.7:
            out.append(dict(en=(q + nrm * (road["half"] + VERGE + depth[ok] + 0.7)[:, None]).round(2).tolist(), width=0.8, height=0.95))
    return out
