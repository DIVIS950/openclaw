@echo off
REM Windows helper: regenerate the mesh and configs from the traced route. Then run tools\blender_build.py inside Blender.
cd /d "%~dp0"
pip install -r requirements.txt
python tools\georef_route.py --scale 0.45 --center 50.6455,14.5600 || exit /b 1
python tools\build_track.py --track sosnova --width 10 --grid 16 --smooth 3 --pit-left --sf-at-first-point --kerb-radius 60 || exit /b 1
echo.
echo Now open Blender, Scripting tab, open tools\blender_build.py and press Run Script.
pause
