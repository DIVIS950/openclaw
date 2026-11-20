"""Hand-traced pieces of the venue that the survey cannot give (east/north, metres from the site centre)."""
from __future__ import annotations

# The wall between the west straight and the paddock, measured on the photo
BARRIERS = [
    dict(name="paddock_wall", en=[(-56.0, 33.5), (-56.7, 10), (-57.4, -10), (-57.9, -22.5)], width=0.5, height=1.0),      # measured on the photo
]


# Points added to the yellow dots of the organiser's map (east/north, m). None for the race of 5.12.2026: the map is
# built as the organiser drew it.
EXTRA_DOTS: list[tuple[float, float]] = []

# The start straight as it really runs: a point on its axis, the direction of the axis (parallel to the pit wall,
# 8.1 degrees south of east) and the stretch of it that is straight (metres before / after the point). Measured on
# the photo for the earlier versions. A lap drawn by hand on a map is laid onto this line where it runs along it,
# and the start/finish line is at the point when the organiser's start arrow is within 30 m of it.
START_AXIS = dict(o=(71.512921, -45.015993), f=(0.9900655, -0.1406069), z=(-72.0, 58.0))
