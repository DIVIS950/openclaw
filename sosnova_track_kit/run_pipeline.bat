@echo off
REM Windows helper: regenerate everything from the layout screenshot + Czech state orthophoto/LiDAR.
REM Steps 1-2 need internet (ags.cuzk.gov.cz, ags.cuzk.cz). Then run tools\blender_build.py inside Blender.
cd /d "%~dp0"
pip install -r requirements.txt
python tools\fetch_cuzk.py --center 50.65900,14.53906 --half 320,290 || exit /b 1
python tools\trace_route.py source\trace\aerial.png --out source\trace\route_pixels.json --start 770,604 --east-at 480,900,560 || exit /b 1
python tools\register_route.py || exit /b 1
python tools\build_track.py --track sosnova --grid 16 --step 1 --smooth 3 --pit-left --sf-at-first-point --kerb-radius 60 || exit /b 1
echo.
echo Now open Blender, Scripting tab, open tools\blender_build.py and press Run Script.
pause
