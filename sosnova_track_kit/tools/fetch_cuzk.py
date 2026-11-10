#!/usr/bin/env python3
"""Download the Czech state orthophoto (ČÚZK, 12.5 cm/px) and the LiDAR terrain model DMR 5G
(ČÚZK, 1 m grid, height accuracy 0.18 m) for an area around a lat/lon centre.

Usage:
    python fetch_cuzk.py --center 50.64544,14.56002 --half 420,320 --out source/cuzk
Writes:
    <out>/ortho.png     orthophoto, north-up, Web-Mercator, exactly `gsd` metres per pixel on the ground
    <out>/dem.tif       32-bit float heights (m above sea level, Bpv), 1 m per pixel, same extent
    <out>/meta.json     extent, pixel sizes, centre, mercator scale factor

Everything is requested in EPSG:3857 (Web Mercator) with the pixel size scaled by 1/cos(lat), so that
one pixel is exactly `gsd` metres on the ground and the image is north-up. Over a 1 km site the
Mercator distortion is far below the data accuracy.
Data: © ČÚZK, open data (CC BY 4.0). Keep the attribution if you publish.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import urllib.parse
import urllib.request

from PIL import Image

ORTHO_WMS = "https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer"
DEM_IMG = "https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage"
DSM_IMG = "https://ags.cuzk.cz/arcgis2/rest/services/dmp1g/ImageServer/exportImage"
R = 20037508.342789244


def merc(lat: float, lon: float) -> tuple[float, float]:
    return lon * R / 180.0, math.log(math.tan((90 + lat) * math.pi / 360.0)) * R / math.pi


def fetch(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "sosnova-track-kit/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--center", default="50.64544,14.56002", help="lat,lon of the area centre")
    ap.add_argument("--half", default="420,320", help="half width,half height of the area in metres")
    ap.add_argument("--gsd", type=float, default=0.125, help="orthophoto ground sample distance (m/px)")
    ap.add_argument("--dem-gsd", type=float, default=1.0, help="height grid spacing (m/px)")
    ap.add_argument("--tile", type=int, default=4000, help="max orthophoto request size in px (server limit 4096)")
    ap.add_argument("--dsm", action="store_true", help="also fetch the DMP 1G surface model (dsm.tif)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "source", "cuzk"))
    a = ap.parse_args()
    lat0, lon0 = map(float, a.center.split(","))
    hw, hh = map(float, a.half.split(","))
    os.makedirs(a.out, exist_ok=True)

    k = 1.0 / math.cos(math.radians(lat0))  # metres of mercator per metre on the ground
    cx, cy = merc(lat0, lon0)
    x0, x1 = cx - hw * k, cx + hw * k
    y0, y1 = cy - hh * k, cy + hh * k
    W, H = int(round(2 * hw / a.gsd)), int(round(2 * hh / a.gsd))
    print(f"orthophoto {W}x{H} px at {a.gsd} m/px, area {2*hw:.0f} x {2*hh:.0f} m")

    # ---- orthophoto in tiles (WMS 1.3.0, EPSG:3857 is x,y ordered)
    ortho = Image.new("RGB", (W, H))
    nx, ny = math.ceil(W / a.tile), math.ceil(H / a.tile)
    for j in range(ny):
        for i in range(nx):
            px0, px1 = i * a.tile, min((i + 1) * a.tile, W)
            py0, py1 = j * a.tile, min((j + 1) * a.tile, H)
            bx0 = x0 + (x1 - x0) * px0 / W
            bx1 = x0 + (x1 - x0) * px1 / W
            by1 = y1 - (y1 - y0) * py0 / H  # image rows grow southwards
            by0 = y1 - (y1 - y0) * py1 / H
            q = urllib.parse.urlencode({"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": "0", "STYLES": "",
                                        "CRS": "EPSG:3857", "BBOX": f"{bx0:.3f},{by0:.3f},{bx1:.3f},{by1:.3f}",
                                        "WIDTH": px1 - px0, "HEIGHT": py1 - py0, "FORMAT": "image/png"})
            data = fetch(ORTHO_WMS + "?" + q)
            tile = Image.open(io.BytesIO(data)).convert("RGB")
            ortho.paste(tile, (px0, py0))
            print(f"  tile {i},{j}: {tile.size}")
    ortho.save(os.path.join(a.out, "ortho.png"))

    # ---- DMR 5G heights as float tiff
    dw, dh = int(round(2 * hw / a.dem_gsd)), int(round(2 * hh / a.dem_gsd))
    q = urllib.parse.urlencode({"bbox": f"{x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}", "bboxSR": 3857, "imageSR": 3857, "size": f"{dw},{dh}",
                                "format": "tiff", "pixelType": "F32", "noData": -9999, "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    data = fetch(DEM_IMG + "?" + q)
    with open(os.path.join(a.out, "dem.tif"), "wb") as f:
        f.write(data)
    print(f"dem {dw}x{dh} px at {a.dem_gsd} m/px")

    # ---- DMP 1G surface model (buildings, trees, bridges) at twice the DEM resolution
    if a.dsm:
        q = urllib.parse.urlencode({"bbox": f"{x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}", "bboxSR": 3857, "imageSR": 3857, "size": f"{dw * 2},{dh * 2}",
                                    "format": "tiff", "pixelType": "F32", "noData": -9999, "interpolation": "RSP_BilinearInterpolation", "f": "image"})
        with open(os.path.join(a.out, "dsm.tif"), "wb") as f:
            f.write(fetch(DSM_IMG + "?" + q))
        print(f"dsm {dw * 2}x{dh * 2} px")

    meta = {"center": [lat0, lon0], "half_m": [hw, hh], "gsd": a.gsd, "dem_gsd": a.dem_gsd, "mercator_k": k,
            "bbox3857": [x0, y0, x1, y1], "ortho_size": [W, H], "dem_size": [dw, dh],
            "source": "ČÚZK Ortofoto ČR + DMR 5G (CC BY 4.0)", "north_up": True}
    with open(os.path.join(a.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
