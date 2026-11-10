"""Step: read what really lies along the edges of the lap from the 12.5 cm orthophoto.

Sosnová has no red and white kerbs. Some corners have a flat strip of pale concrete along the asphalt edge, and
two bends have a sand run-off. For every station and side the photo is sampled outwards from the asphalt edge:
a narrow pale strip is a concrete kerb, a deep pale area is sand (beige) or a concrete strip (grey).
Reads source/work/centerline.json, writes source/work/edges.json"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely import contains_xy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import circuit  # noqa: E402
from common import HALF_E, HALF_N, SRC, WORK, closed_frames  # noqa: E402

GSD = 0.125
OFFS = np.arange(-0.4, 14.01, 0.125)   # sampled from just inside the edge to 14 m outside it
KERB_W = (0.75, 2.6)                   # a pale strip this wide is a concrete kerb (m)
SAND_MIN = 3.2                         # a pale area deeper than this is a sand run-off (m)


def runs(mask: np.ndarray, close: int, min_len: int) -> list[tuple[int, int]]:
    n = len(mask)
    m = ndi.binary_opening(ndi.binary_closing(np.tile(mask, 3), structure=np.ones(close)), structure=np.ones(min_len))[n: 2 * n]
    if m.all():
        return [(0, n)]
    k0 = int(np.argmin(m))
    d = np.diff(np.concatenate([[0], np.roll(m, -k0).astype(int), [0]]))
    return [(int((a + k0) % n), int(e - a)) for a, e in zip(np.where(d == 1)[0], np.where(d == -1)[0])]


def main() -> None:
    Image.MAX_IMAGE_PIXELS = None
    im = np.asarray(Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("RGB")).astype(np.int32)
    pale = (im.min(-1) >= 160) & (im.max(-1) - im.min(-1) <= 50)
    cl = json.load(open(os.path.join(WORK, "centerline.json"), encoding="utf-8"))
    c, wl, wr = np.array(cl["en"]), np.array(cl["wl"]), np.array(cl["wr"])
    open_l, open_r = np.array(cl["open_l"], bool), np.array(cl["open_r"], bool)
    _, nrm, _, _ = closed_frames(c)
    n = len(c)
    paved = circuit.all_paved()
    kerbs, sand, slabs = [], [], []
    for side, w, is_open in ((1, wl, open_l), (-1, wr, open_r)):
        en = c[:, None, :] + nrm[:, None, :] * (side * (w[:, None] + OFFS[None, :]))[..., None]
        px = np.clip(((en[..., 0] + HALF_E) / GSD).astype(int), 0, pale.shape[1] - 1)
        py = np.clip(((HALF_N - en[..., 1]) / GSD).astype(int), 0, pale.shape[0] - 1)
        p = pale[py, px]
        warm = (im[..., 0] - im[..., 2])[py, px]             # sand is beige, concrete is grey
        width, tone = np.zeros(n), np.zeros(n)
        for i in range(n):
            row = p[i]
            on = np.where(row[:10])[0]                       # the pale strip must begin within 0.8 m of the edge
            if len(on) == 0:
                continue
            k = on[0]
            gap = 0
            end = k
            while k < len(row) and gap <= 3:                 # bridge gaps of up to 0.4 m (joints, shadows)
                if row[k]:
                    end, gap = k, 0
                else:
                    gap += 1
                k += 1
            width[i] = (end - on[0] + 1) * GSD
            tone[i] = warm[i, on[0]: end + 1][row[on[0]: end + 1]].mean()
        width = ndi.median_filter(width, 7, mode="wrap")
        beside = contains_xy(paved, *(c + nrm * (side * (w + 1.5))[:, None]).T)      # modelled asphalt or concrete lies there already
        ok = ~is_open & ~beside
        for a, ln in runs(ok & (width >= KERB_W[0]) & (width < KERB_W[1]), 5, 8):
            st = (a + np.arange(ln)) % n
            kerbs.append(dict(side=side, start=a, length=ln, width=round(float(np.clip(np.median(width[st]), 0.8, 1.8)), 2)))
        for a, ln in runs(ok & (width >= SAND_MIN), 9, 12):
            st = (a + np.arange(ln)) % n
            depth = np.clip(ndi.gaussian_filter1d(np.maximum(width[st], SAND_MIN), 4.0, mode="nearest"), SAND_MIN, 13.0)
            (sand if np.median(tone[st]) >= 18 else slabs).append(dict(side=side, start=a, length=ln, depth=depth.round(2).tolist()))
    json.dump(dict(kerbs=kerbs, sand=sand, concrete=slabs), open(os.path.join(WORK, "edges.json"), "w"))
    tag = lambda k: f"{'L' if k['side'] > 0 else 'R'}{k['start']}+{k['length']}"
    print(f"{len(kerbs)} concrete kerbs, {sum(k['length'] for k in kerbs)} m:", ", ".join(f"{tag(k)} ({k['width']} m)" for k in kerbs))
    print(f"{len(slabs)} concrete strips:", ", ".join(f"{tag(k)} (to {max(k['depth'])} m)" for k in slabs))
    print(f"{len(sand)} sand run-offs, {sum(k['length'] for k in sand)} m:", ", ".join(f"{tag(k)} (to {max(k['depth'])} m)" for k in sand))


if __name__ == "__main__":
    main()
