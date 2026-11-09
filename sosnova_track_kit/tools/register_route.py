#!/usr/bin/env python3
"""Map the route traced on the layout screenshot onto the ČÚZK orthophoto.

The screenshot (source/trace/aerial.png) and the orthophoto (source/cuzk/ortho.png) show the same
place at different scales. SIFT features + RANSAC give the similarity transform between them, so the
traced route (and the cone dots) land on the orthophoto with its exact metric scale and position.

Writes source/centerline.json (lat/lon, exact scale) and source/cuzk/route_ortho.json (route and cones
in orthophoto pixel coordinates) and a check image source/cuzk/register_check.png.
"""
from __future__ import annotations

import json
import math
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
SRC = os.path.join(KIT, "source")


def main() -> None:
    meta = json.load(open(os.path.join(SRC, "cuzk", "meta.json")))
    route = json.load(open(os.path.join(SRC, "trace", "route_pixels.json")))
    P = np.array(route["pixels"], float)
    shot = cv2.imread(os.path.join(SRC, "trace", "aerial.png"), cv2.IMREAD_GRAYSCALE)
    ortho_full = Image.open(os.path.join(SRC, "cuzk", "ortho.png")).convert("L")
    gsd = meta["gsd"]
    # bring the orthophoto roughly to the screenshot's resolution (about 0.45 m/px) for matching
    down = 4
    ortho = np.asarray(ortho_full.resize((ortho_full.width // down, ortho_full.height // down), Image.LANCZOS))
    print(f"screenshot {shot.shape[::-1]}, ortho (down {down}x) {ortho.shape[::-1]}")

    sift = cv2.SIFT_create(nfeatures=12000)
    k1, d1 = sift.detectAndCompute(shot, None)
    k2, d2 = sift.detectAndCompute(ortho, None)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    raw = matcher.knnMatch(d1, d2, k=2)
    good = [m for m, n in raw if m.distance < 0.75 * n.distance]
    print(f"features {len(k1)} / {len(k2)}, good matches {len(good)}")
    src = np.float32([k1[m.queryIdx].pt for m in good])
    dst = np.float32([k2[m.trainIdx].pt for m in good])
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=5000, confidence=0.999)
    if M is None:
        raise SystemExit("registration failed: no similarity transform found")
    n_in = int(inl.sum())
    scale = math.hypot(M[0, 0], M[0, 1])
    rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    resid = np.linalg.norm((src[inl.ravel() == 1] @ M[:, :2].T + M[:, 2]) - dst[inl.ravel() == 1], axis=1)
    print(f"inliers {n_in}, scale {scale:.4f} (screenshot px -> ortho/{down} px), rotation {rot:.2f} deg, median residual {np.median(resid) * down * gsd:.2f} m")
    if n_in < 12:
        raise SystemExit("registration unreliable (<12 inliers)")

    # ---- refinement: maximise the overlap (IoU) of the asphalt masks of both images, rotation fixed
    # at 0 (both north-up). This uses the whole site, not only the route, so it pins scale and position.
    from scipy import ndimage as ndi
    from scipy.optimize import minimize

    def asphalt_mask(rgb: np.ndarray, overlay: np.ndarray | None = None) -> np.ndarray:
        r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        sat, bri = rgb.max(-1) - rgb.min(-1), rgb.mean(-1)
        m = (sat < 0.10) & (bri > 0.22) & (bri < 0.72) & (g_ - r_ < 0.03) & (r_ - b_ < 0.09)
        m = ndi.binary_closing(ndi.binary_opening(m, iterations=1), iterations=2)
        if overlay is not None:
            m |= overlay
        return m

    shot_rgb = np.asarray(Image.open(os.path.join(SRC, "trace", "aerial.png")).convert("RGB")).astype(float) / 255.0
    r_, g_, b_ = shot_rgb[..., 0], shot_rgb[..., 1], shot_rgb[..., 2]
    drawn = ndi.binary_dilation((r_ > 0.62) & (g_ < 0.45) & (b_ < 0.45) & (r_ - g_ > 0.28), iterations=3)
    m_shot = asphalt_mask(shot_rgb, drawn).astype(np.uint8)
    oc = np.asarray(ortho_full.convert("RGB").resize((ortho_full.width // down, ortho_full.height // down), Image.LANCZOS)).astype(float) / 255.0
    m_ortho = asphalt_mask(oc)
    hh, ww = m_ortho.shape

    ones = np.ones_like(m_shot)

    def iou(params):
        s_, tx, ty = params
        A = np.array([[s_, 0.0, tx], [0.0, s_, ty]], dtype=np.float32)
        warped = cv2.warpAffine(m_shot, A, (ww, hh), flags=cv2.INTER_NEAREST) > 0
        foot = cv2.warpAffine(ones, A, (ww, hh), flags=cv2.INTER_NEAREST) > 0  # only compare inside the screenshot footprint
        tgt = m_ortho & foot
        inter = np.logical_and(warped, tgt).sum()
        union = np.logical_or(warped, tgt).sum()
        return -inter / max(union, 1)

    x0 = np.array([scale, M[0, 2], M[1, 2]])
    print(f"refine: start IoU {-iou(x0):.3f}")
    bounds = [(scale * 0.97, scale * 1.03), (x0[1] - 25, x0[1] + 25), (x0[2] - 25, x0[2] + 25)]
    best = minimize(iou, x0, method="Powell", bounds=bounds, options={"xtol": 1e-3, "ftol": 1e-4, "maxiter": 2000})
    scale, tx, ty = best.x
    print(f"refine: end IoU {-best.fun:.3f}, scale {scale:.4f}, shift {tx - M[0, 2]:+.1f},{ty - M[1, 2]:+.1f} px (ortho/{down})")
    M = np.array([[scale, 0.0, tx], [0.0, scale, ty]])

    # full-resolution orthophoto pixel coordinates
    to_ortho = lambda pts: (np.asarray(pts, float) @ M[:, :2].T + M[:, 2]) * down
    P_o = to_ortho(P)
    cones_px = route.get("cones_px")  # optional, written by trace step
    C_o = to_ortho(cones_px) if cones_px else None

    # metres per screenshot pixel, lat/lon of each route point
    m_per_shot_px = scale * down * gsd
    W, H = meta["ortho_size"]
    lat0, lon0 = meta["center"]
    east = (P_o[:, 0] - W / 2.0) * gsd
    north = -(P_o[:, 1] - H / 2.0) * gsd
    lat = lat0 + north / 110_540.0
    lon = lon0 + east / (111_320.0 * math.cos(math.radians(lat0)))
    LL = np.column_stack([lat, lon])
    length = float(np.sum(np.linalg.norm(np.diff(np.vstack([P_o, P_o[:1]]), axis=0), axis=1)) * gsd)
    out = {"name": "Autodrom Sosnová 14.11.2026 layout", "points": LL.tolist() + [LL[0].tolist()], "closed": True,
           "scale_m_per_px": m_per_shot_px, "image_center": [float(lat0 + (-(shot.shape[0] / 2 - 0) ) * 0), lon0],
           "source": "traced route registered onto ČÚZK orthophoto", "registration": {"inliers": n_in, "rotation_deg": rot, "median_residual_m": float(np.median(resid) * down * gsd)}}
    # image_center for the screenshot: where its centre pixel lands
    c_o = to_ortho([[shot.shape[1] / 2.0, shot.shape[0] / 2.0]])[0]
    out["image_center"] = [float(lat0 - (c_o[1] - H / 2.0) * gsd / 110_540.0), float(lon0 + (c_o[0] - W / 2.0) * gsd / (111_320.0 * math.cos(math.radians(lat0))))]
    json.dump(out, open(os.path.join(SRC, "centerline.json"), "w"), indent=1)
    json.dump({"route_px": P_o.tolist(), "cones_px": C_o.tolist() if C_o is not None else None, "gsd": gsd, "ortho_size": [W, H], "lap_m": length},
              open(os.path.join(SRC, "cuzk", "route_ortho.json"), "w"))
    print(f"lap length on orthophoto: {length:.1f} m; screenshot scale {m_per_shot_px:.3f} m/px")

    # check image: route drawn on a 1/4 orthophoto
    chk = ortho_full.resize((W // down, H // down), Image.LANCZOS).convert("RGB")
    d = ImageDraw.Draw(chk)
    pts = [tuple(p / down) for p in P_o]
    d.line(pts + pts[:1], fill=(255, 0, 0), width=2)
    if C_o is not None:
        for x, y in C_o / down:
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 220, 0))
    chk.save(os.path.join(SRC, "cuzk", "register_check.png"))


if __name__ == "__main__":
    main()
