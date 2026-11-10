# Autodrom Sosnová for Assetto Corsa (v4.1)

A drivable Assetto Corsa (2014) copy of Autodrom Sosnová near Česká Lípa, Czech Republic.

**Download:** [`download/sosnova_v4.zip`](download/sosnova_v4.zip). Install notes are in
[`content/tracks/sosnova_v4/INSTALL.txt`](content/tracks/sosnova_v4/INSTALL.txt). Delete older `sosnova*`
folders from `content/tracks` first.

## What v4.1 is

Geometry from survey data, look from real materials. The event barriers and slalom tyres of the 14.11.2026
layout are left out on purpose and come back in a later step.

| Part | How it is made |
| --- | --- |
| Where things are | Czech state orthophoto (12.5 cm per pixel), lidar terrain model DMR 5G and surface model DMP 1G. |
| Surfaces | Photo-scanned CC0 materials from Poly Haven, brought to game brightness: race-track asphalt on the lap, pit-lane asphalt on the aprons, a light concrete-like surface on pads and flat kerbs, grass, gravel. The aerial photo decides which one goes where. Far from the track the ground shows the aerial photo itself. |
| Trees | Pictures rendered from scanned 3D trees (Poly Haven `fir_tree_01`, `tree_small_02`), placed where the surface model shows canopy, at the measured height. |
| Lap | 1764 m anticlockwise, the route of the 14.11.2026 event, moved onto the real asphalt (`refine.py`). Structured ribbon with an analytic, smooth height. Solid white lines along both edges. |
| Kerbs | Red and white kerbs (`kerbs.py`): 1 m wide on the verge outside the edge line, along the inside of every corner tighter than 60 m radius and on the outside of the exit of corners tighter than 28 m. 20 kerbs, 759 m. Physical surface `KERB`. These are a racing addition, the real circuit has flat concrete kerbs. |
| Other paint | Start boxes and clear lines traced from the aerial photo, as sharp geometry 2 cm above the asphalt. |
| Gravel | Light bare ground beside the asphalt, from the photo. Physical surface `SAND`. |
| Bridge | The green arch bridge: 54 m long, 3.8 m wide, deck 5.2 m above the lower road, open underneath, mesh railings. Position from the aerial photo, height from the surface model, look from the circuit's own 2026 photos. |
| Buildings | Footprints and heights from the surface model, pit complex outlines measured on the photo, walls on scanned plaster and sheet metal, roofs from the aerial photo. |
| Barriers, pylons | Barriers traced from the aerial photo, shown as the green and yellow padded modules of the 2026 photos. Three lattice power pylons north of the bridge. |

Earlier versions used generated noise textures (v2) and the aerial photo as the road texture (v3). Both looked
poor at driver height, which is why v4 uses scanned materials.

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
python3 build.py           # writes content/tracks/sosnova_v4
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
- Which asphalt is new and which is old is judged from the aerial photo and may differ from today.
- Rain and puddles depend on Custom Shaders Patch with RainFX and a weather script.

## Data and licence

Orthophoto: ČÚZK Ortofoto ČR. Terrain: ČÚZK DMR 5G. Surface: ČÚZK DMP 1G. All CC BY 4.0.
Materials and tree models: Poly Haven, CC0. Not affiliated with the circuit owner.

## Check renders

Rendered from the built `sosnova_v4.kn5` with `tools/render.py`.

![Pole position](previews/ac_start_0.jpg)
![Approaching the bridge](previews/lap_0600.jpg)
![Hairpin](previews/lap_0400.jpg)
![The bridge from the side](previews/bridge_side.jpg)
![Start straight from behind](previews/chase_grid.jpg)
![From above](previews/top.jpg)
