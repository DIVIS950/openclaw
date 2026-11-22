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

# Barriers and tape beyond the organiser's dots (race of 5.12.2026). The map closes some roads with rows of dots and
# leaves the rest to the marshals. Here every side road of the route is closed with red and white plastic barriers
# (solid), from grass to grass, and the edges of the open squares are marked with tape on posts (a car goes through
# tape). Two places stay open: the pit apron beside the start straight, and the way in from the paddock at the west
# end of the bottom road (the blue arrow of the map). check.py floods the asphalt from the lap
# with a car 2 m wide and finds no other way off the route. A line runs beside the lap (side "l" / "r" of the driver, stations in metres from the start line, `off`
# metres outside the edge of the lap) or through given east/north points; head_dot / tail_dot tie its end to a dot
# of the map (numbered from 1 in lap order). arrows: arrow boards stand on the barriers.
RACE_EXTRAS = [
    dict(name="pit apron", kind="barrier", side="l", st=(262, 298), off=1.6, tail_dot=7),
    dict(name="kart road", kind="barrier", side="r", st=(295, 309), off=2.0),
    dict(name="connector, north end", kind="barrier", head_dot=21, side="l", st=(349, 360), off=1.5),
    dict(name="square, south edge", kind="tape", head_dot=33, side="l", st=(419, 506), off=1.5, tail_dot=41),
    dict(name="bridge ramp", kind="barrier", side="r", st=(428, 445), off=1.5),
    dict(name="island tip", kind="barrier", head_dot=41, en=[(85.3, 88.9)]),
    dict(name="hairpin", kind="barrier", side="r", st=(566, 604), off=3.0, arrows=True),
    dict(name="link road", kind="barrier", en=[(154.2, 4.1), (181.1, 4.1)]),
    dict(name="gravel apron", kind="tape", side="r", st=(646, 662), off=1.5),
    dict(name="north road", kind="barrier", head_dot=36, side="l", st=(692, 704), off=1.8),
    dict(name="north chicane, before the row", kind="tape", side="l", st=(870, 880), off=1.3, tail_dot=50),
    dict(name="north chicane, after the row", kind="tape", head_dot=50, side="l", st=(891, 914), off=1.3),
    dict(name="service lane", kind="barrier", side="r", st=(1432, 1444), off=1.5),
    dict(name="square, west edge", kind="tape", side="l", st=(1436, 1489), off=1.5, tail_dot=25),
    dict(name="paddock road", kind="barrier", side="r", st=(1488, 1512), off=1.5),
    dict(name="connector, S-bend end", kind="barrier", side="l", st=(1553, 1561), off=1.5),
    dict(name="west road", kind="barrier", en=[(-56.6, -11.5), (-46.1, -12.25)]),
    dict(name="south loop", kind="barrier", side="r", st=(1586, 1610), off=2.0),
    dict(name="car park road", kind="barrier", en=[(-61.8, -38.0), (-48.6, -38.3)]),
]

# Where the race layout is meant to stay open (east/north of a point in each opening): the pit apron, and the two
# blue arrows of the organiser's map (in from the paddock, out to the pits).
RACE_OPEN = dict(pit_apron=(100.0, -33.0), way_in=(-63.7, -25.9), way_out=(184.5, -70.0))
