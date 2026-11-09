#!/usr/bin/env python3
"""Fetch the circuit centerline from OpenStreetMap (Overpass API).

Usage:
    python fetch_osm.py --bbox 50.60,14.48,50.74,14.64 --out ../source/centerline.json
    python fetch_osm.py --name "Sosnov" --out ../source/centerline.json

Writes a simple JSON file: {"name": ..., "points": [[lat, lon], ...], "closed": true}
The longest closed `highway=raceway` way (or ring of ways) in the area is used.
"""
import argparse
import json
import math
import sys
import urllib.parse
import urllib.request

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def query(q: str) -> dict:
    last = None
    for url in OVERPASS:
        try:
            data = urllib.parse.urlencode({"data": q}).encode()
            with urllib.request.urlopen(url, data=data, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # try the next mirror
            last = e
    raise SystemExit(f"Overpass query failed: {last}")


def stitch(ways: list[dict]) -> list[list[float]]:
    """Join raceway ways that share end nodes into one loop; return the longest loop."""
    segs = [[(n["lat"], n["lon"]) for n in w["geometry"]] for w in ways if w.get("geometry")]
    loops: list[list[tuple[float, float]]] = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for s in list(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += list(reversed(s))[1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = list(reversed(s))[:-1] + cur
                else:
                    continue
                segs.remove(s)
                changed = True
        loops.append(cur)

    def length(pts):
        return sum(
            math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])))
            for a, b in zip(pts, pts[1:])
        )

    closed = [l for l in loops if l[0] == l[-1]] or loops
    best = max(closed, key=length)
    return [list(p) for p in best]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="50.60,14.48,50.74,14.64", help="south,west,north,east")
    ap.add_argument("--name", default=None, help="regex on the name tag, e.g. Sosnov")
    ap.add_argument("--out", default="centerline.json")
    ap.add_argument("--raw", default=None, help="also save the raw Overpass JSON here (for georef_route.py --osm)")
    a = ap.parse_args()
    name_filter = f'["name"~"{a.name}",i]' if a.name else ""
    q = f'[out:json][timeout:90];(way["highway"="raceway"]{name_filter}({a.bbox}););out tags geom;'
    res = query(q)
    if a.raw:
        with open(a.raw, "w", encoding="utf-8") as f:
            json.dump(res, f)
    ways = [e for e in res.get("elements", []) if e["type"] == "way"]
    if not ways:
        sys.exit("No highway=raceway ways found in that area. Widen --bbox or drop --name.")
    pts = stitch(ways)
    name = next((w["tags"].get("name") for w in ways if w.get("tags", {}).get("name")), "circuit")
    out = {"name": name, "points": pts, "closed": pts[0] == pts[-1], "source": "OpenStreetMap (ODbL)"}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {a.out}: {len(pts)} points, name={name!r}, closed={out['closed']}")


if __name__ == "__main__":
    main()
