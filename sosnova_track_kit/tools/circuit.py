"""Hand-traced pieces of the venue that the survey cannot give (east/north, metres from the site centre)."""
from __future__ import annotations

# The wall between the west straight and the paddock, measured on the photo
BARRIERS = [
    dict(name="paddock_wall", en=[(-56.0, 33.5), (-56.7, 10), (-57.4, -10), (-57.9, -22.5)], width=0.5, height=1.0),      # measured on the photo
]


# The barrier line the owner drew on the organiser's map: on the left of the east leg, from the infield loop down
# to the return road. It continues the organiser's row of yellow dots there (138, 21..40) in both directions, so
# after turn 1 the only way is north. Points are tyre barrels, 6.5 m left of the lap where the line runs beside it.
EXTRA_DOTS = [(128.6, 59.3), (131.3, 55.0), (134.0, 50.7), (136.2, 45.6), (139.5, 15.5), (141.5, 10.0), (143.5, 4.5), (146.0, -1.0)]
