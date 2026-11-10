"""Measured geometry of the concrete overpass in the middle of the circuit (from the orthophoto and DMP 1G)."""
from __future__ import annotations

import numpy as np

A = np.array([-38.05, 10.75])        # south-west foot of the ramp, centre of the deck (east, north)
B = np.array([2.90, 45.50])          # north-east foot
WIDTH = 3.8                          # deck width (m)
SPAN = (18.5, 31.5)                  # distance along the deck (m) of the opening the lower road passes through
SLAB = 0.6                           # thickness of the deck over the opening (m)
# deck height above the terrain along the deck, read from the surface model (distance m, height m)
PROFILE = np.array([(0, 0.0), (2, 0.55), (4, 1.2), (6, 1.9), (8, 2.6), (10, 3.2), (12, 3.75), (14, 4.15), (16, 4.45), (18, 4.7),
                    (20, 4.9), (22, 5.02), (24, 5.1), (26, 5.18), (28, 5.2), (30, 5.16), (32, 5.08), (34, 4.9), (36, 4.6), (38, 4.25),
                    (40, 3.9), (42, 3.5), (44, 3.0), (46, 2.45), (48, 1.85), (50, 1.2), (52, 0.52), (53.7, 0.0)])
LENGTH = float(np.linalg.norm(B - A))
AXIS = (B - A) / LENGTH
LEFT = np.array([-AXIS[1], AXIS[0]])  # towards north-west


PEAK = 5.2                           # highest point of the deck above the terrain (m)


def height(t):
    """Deck height above the terrain at distance t along the deck: a smooth hump through the surveyed profile
    (peak and both feet exact, ramps within about 0.6 m of the model, never steeper than 31 %)."""
    t = np.asarray(t, float)
    return np.where((t <= 0) | (t >= LENGTH), 0.0, PEAK * np.sin(np.pi * np.clip(t, 0, LENGTH) / LENGTH))


def point(t, s):
    """East/north of a point t metres along the deck and s metres to the left of its centre line."""
    t, s = np.asarray(t, float), np.asarray(s, float)
    return A + AXIS * t[..., None] + LEFT * s[..., None]


def footprint(t0=0.0, t1=None, half=None, grow=0.0):
    t1 = LENGTH if t1 is None else t1
    half = WIDTH / 2 if half is None else half
    return np.array([A + AXIS * (t0 - grow) - LEFT * (half + grow), A + AXIS * (t1 + grow) - LEFT * (half + grow),
                     A + AXIS * (t1 + grow) + LEFT * (half + grow), A + AXIS * (t0 - grow) + LEFT * (half + grow)])


def shadow_polygon():
    """Ground covered by the deck's shadow in the photo (sun in the east-south-east, about 40 degrees up)."""
    t = np.linspace(1.0, LENGTH - 1.0, 40)
    near = point(t, np.full_like(t, WIDTH / 2 - 0.3))
    far = point(t, WIDTH / 2 + 0.6 + 1.25 * height(t))
    return np.vstack([near, far[::-1]])
