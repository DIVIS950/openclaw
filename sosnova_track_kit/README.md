# Autodrom Sosnová for Assetto Corsa (v5.1)

A drivable Assetto Corsa (2014) track based on Autodrom Sosnová near Česká Lípa, Czech Republic.

**Download:** [`download/sosnova_v5.zip`](download/sosnova_v5.zip). Install notes are in
[`content/tracks/sosnova_v5/INSTALL.txt`](content/tracks/sosnova_v5/INSTALL.txt). Delete older `sosnova*`
folders from `content/tracks` first.

## What v5.1 is

The surveyed lap, redesigned as a clean racetrack (`tools/design.py`), plus the rest of the original circuit
finished to the same standard (`tools/circuit.py`). Up to v4 the asphalt followed the aerial photo exactly,
which gave uneven road widths, wobbly lines and ragged grass edges. From v5 the survey decides where things
are, and the design decides how they are finished. v5.0 left most of the other asphalt out. v5.1 brings it back.

| Part | How it is made |
| --- | --- |
| Lap position and height | From the survey: the route of the 14.11.2026 event moved onto the real asphalt (`refine.py`), 1764 m anticlockwise, heights from the lidar terrain model as a smooth analytic surface. |
| Road | 9 m wide everywhere. White lines on both edges, parallel all the way round, dashed along the pit apron. A rubbered racing line in three gentle steps of darker asphalt. |
| Verge | A 4 m grass strip along both sides of the lap, except where the pit apron joins. |
| Kerbs | Red and white, 1 m wide, on the inside of every corner tighter than 60 m radius and on the outside of the exit of corners tighter than 28 m. 27 kerbs, 1175 m. |
| Gravel traps | One on the outside of every corner tighter than 45 m radius, behind the verge, 11 m deep with tapered ends, and a padded barrier along its back. Physical surface `SAND`. |
| Pit apron | A clean slab 20 m deep beside the start straight with 16 painted bays. |
| Start | Chequered band, 16 grid boxes, start lights on a gantry, brake boards 150/100/50. |
| Original circuit roads | Traced by hand from the 12.5 cm orthophoto as centre lines with one width: the return road from the east hairpin (9.5 m), the loop south-west of the start (8.5 m), the link by the bridge (7 m) and the outer hairpin road (8 m). Same dark asphalt as the lap, two parallel white lines, flat red and white kerbs on the inside of their bends. 384 m in total. |
| Paved areas | Clean polygons with rounded corners and a white line along every edge that meets grass: the big square, the start area up to the bridge, the north junction, the fan at the east hairpin and the paddock. Lighter asphalt than the roads. |
| Concrete and gravel | The white apron inside the east hairpin with its gravel pocket, the skid pad on the square, the slab at the foot of the bridge, the paddock lane and the lay-by on the north straight. |
| Seams | Mesh edges follow every seam between road, apron and concrete, so no seam is jagged. |
| Barriers | Padded barriers behind the gravel traps, and the concrete wall between the paddock and the west leg. A barrier is cut where it would cross asphalt. |
| Still from the survey | The green arch bridge, buildings with their heights and photo roofs, pylons, trees at measured heights, the terrain and the distant ground photo. |
| Materials | Photo-scanned CC0 surfaces and pictures of scanned 3D trees from Poly Haven. |

The event barriers and slalom tyres of the 14.11.2026 layout are still left out.

## Rebuilding

```
pip install numpy scipy pillow opencv-python-headless shapely triangle scikit-image bpy
cd tools
# survey data, only needed when the files in source/cuzk and source/cuzk_far are missing
python3 fetch_cuzk.py --center 50.65900,14.53906 --half 320,290 --dsm
python3 fetch_cuzk.py --center 50.65900,14.53906 --half 1250,1000 --gsd 1 --dem-gsd 4 --out ../source/cuzk_far
python3 prep.py            # photo at 25 cm and first colour classes
python3 survey.py          # object heights, buildings, canopy, hard surface
python3 paint.py           # trace painted markings and barriers
python3 refine.py          # move the lap onto the real asphalt, limit its widths to the real edges
python3 heights.py         # smooth road surface and blended ground
python3 mkbuildings.py     # building footprints and heights
python3 build.py           # writes content/tracks/sosnova_v5 (the original circuit comes from circuit.py)
python3 check.py           # validates the files the game will load
python3 render.py          # check renders from the spawn points, along the lap and at the bridge
```

The orthophoto files are not stored in the repository because of their size. `fetch_cuzk.py` downloads them
again. The scanned materials and the tree pictures are stored in `source/assets` (see `SOURCES.md` there).
`mktrees.py` and `tree_atlas.py` remake the tree pictures from the Poly Haven models.

## Conventions that matter

- kn5 space is right-handed with `+Y` up. A dummy matrix has rows local X, local Y, local Z, position. A car
  faces local `+Z`. `AC_TIME_n_L` is on the driver's left.
- World origin is on the start/finish line. `+Z` is the direction of travel on the start straight and `+X`
  is the driver's left. Grid dummies carry no rotation.
- Physical meshes are named `<digit><KEY>_name`, with the keys defined in `data/surfaces.ini`:
  `ROAD`, `APRON`, `KERB`, `GRASS`, `SAND`, `WALL`.
- Only the stock shaders `ksPerPixel` and `ksPerPixelAT` are used.

## Reference photos

Ground-level photos were used only to learn what things look like (colours, shapes, materials). None of them
is stored here or used as a texture.

- Driving Camp Autodrom Sosnová, track day galleries 2026: <https://www.autodrom.cz/>
- corners.cz, "Novinky na okruhu v Sosnové" (2022): <https://www.corners.cz/en/blog/novinky-na-okruhu-v-sosnove/>

## Limits

- Source accuracy is about 0.25 m in plan and 0.2 m in height. Millimetre accuracy is not possible from
  aerial survey data. No public laser scan of the track surface itself was found.
- The track was validated by reading back the built files and by renders. It was not run inside the game here.
- The road width, verges, kerbs, gravel traps, lines and the pit apron are a design, not a copy of the real circuit.
- The other roads and paved areas are in their real places, traced by eye to about 1 m. Their widths, lines and kerbs are a design.
- Rain and puddles depend on Custom Shaders Patch with RainFX and a weather script.

## Data and licence

Orthophoto: ČÚZK Ortofoto ČR. Terrain: ČÚZK DMR 5G. Surface: ČÚZK DMP 1G. All CC BY 4.0.
Materials and tree models: Poly Haven, CC0. Not affiliated with the circuit owner.

## Check renders

Rendered from the built `sosnova_v5.kn5` with `tools/render.py`.

![Pole position](previews/ac_start_0.jpg)
![Start straight from behind](previews/chase_grid.jpg)
![Start area and return road](previews/air_start.jpg)
![The big square](previews/air_plaza.jpg)
![South-west loop, link and paddock](previews/air_sw.jpg)
![East hairpin](previews/air_east.jpg)
![On the return road](previews/road_return_12.jpg)
![Under the bridge](previews/lap_0600.jpg)
![From above](previews/top.jpg)
