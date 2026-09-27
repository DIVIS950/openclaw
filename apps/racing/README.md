# Apex: lap timer, live delta, onboard video and AI coach (iOS)

Apex is an iPhone app for track days, club racing, karting and sim racing, in the spirit of RaceChrono.
It times laps from GPS and shows a live predictive delta. It syncs GoPro video with your data and
includes an AI race engineer (Claude) that briefs you before a session and debriefs you after it.

## Features

| Area | What it does |
| --- | --- |
| **Live timing** | Start/finish and sector gates with sub-sample interpolation. A debounced lap state machine and point-to-point (hill climb) support. |
| **Predictive delta** | The current position is projected onto the reference lap, so the delta holds up on a different line. Shows delta, predicted lap and a gain/loss trend arrow. Split deltas per sector. The reference auto-switches to each new personal best. |
| **GPS** | iPhone GPS fused with the 100 Hz IMU through a Kalman filter. RaceBox Mini/Micro at 25 Hz over BLE. Generic Bluetooth NMEA receivers. |
| **IMU alignment** | Works with the phone mounted at any angle. The yaw between the IMU frame and North is learned from GPS acceleration, so the unreliable magnetometer isn't needed in a car. |
| **Tracks** | More than 60 circuits and kart tracks built in. Auto-detects the nearest track. Custom tracks. |
| **Timing lines** | Set start/finish and sectors on the Apple Maps satellite view: tap once and the direction snaps to your driving line. Or just drive: the start/finish line is found automatically after one lap. |
| **Maps** | Apple Maps (MapKit) satellite and 3D imagery in the app. Directions open in Apple Maps or Google Maps. |
| **GoPro** | Open GoPro BLE: auto-record with the session, keep-alive. After the session it joins the camera Wi-Fi and downloads the video. |
| **Video sync** | Reads GoPro GPMF GPS (GPS5 and HERO11+ GPS9). Seeds with UTC, then cross-correlates the speed traces for about ±0.05 s alignment. Falls back to the shutter timestamp. Manual nudge. |
| **Onboard** | Video player with a synced overlay: speed, lap time, live delta, G-meter and track map. |
| **Analysis** | Lap list with purple best sectors. Theoretical best. Speed and delta vs distance charts. Automatic corner detection. Per-corner time loss, brake point, minimum and exit speed. |
| **Ideal line** | The fastest segment through each corner stitched together from your own laps, drawn on the map. |
| **AI coach** | Claude (`claude-opus-5`, streamed). The pre-session briefing walks the track and the ideal line. The debrief names the 3 corners where you lose most time, and why. Replies are read aloud. |
| **Export** | CSV and GPX. |

## Build

Requirements: Xcode 16 or newer, iOS 17 or newer, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd apps/racing
xcodegen generate
open Apex.xcodeproj
```

Set your signing team in the project settings. Run on a real iPhone: GPS, Bluetooth and the GoPro
don't work in the simulator.

The Wi-Fi join (`NEHotspotConfiguration`) needs the Hotspot Configuration capability on your App ID.

### Engine tests

All timing, delta, fusion, parsing, sync and analysis logic lives in the `RaceCore` Swift package.
It has no UIKit dependency and comes with unit tests that use a synthetic track with exact ground truth.

```bash
cd apps/racing/RaceCore
swift test
```

## Using it

1. **Settings:** pick the GPS source, pair the GoPro (camera: Connections ▸ Connect Device ▸ Quik App)
   and paste your Anthropic API key. The key is stored in the Keychain.
2. **Drive:** the track is auto-detected. Optionally tap **AI briefing**, then **Start session**. Mount the phone
   landscape for the big dashboard. To stop, hold the stop button.
3. **Sessions:** open the session, tap **From GoPro** to download and auto-sync the video, then check
   the charts and corners and tap **AI debrief**.

## Architecture

```
RaceCore (Swift package, pure logic, unit tested)
  Geo / LocalProjection        WGS-84 ↔ local metric plane
  LapTimer + GateCrossing      line crossing, splits, auto start/finish inference
  DeltaEngine / ReferenceLap   predictive delta by projection onto the reference
  SensorFusion + ImuAligner    2×(pos, vel) Kalman with IMU control input; yaw alignment
  NMEAParser / RaceBoxParser   external GNSS
  GPMFParser / VideoSync       GoPro telemetry, speed cross-correlation
  LapAnalysis                  corners, per-corner metrics, ideal line
  Coach (CoachPrompts, ClaudeAPI)  data packs + Messages API wire format

Apex (SwiftUI app)
  Live/      LiveSessionController (sensors → fusion → timer → delta → UI/voice/GoPro), dashboard
  Tracks/    catalog, satellite maps, timing-line editor, directions
  Sessions/  analysis, charts, onboard video
  Coach/     chat, briefing, debrief
  Services/  CoreLocation, CoreMotion, CoreBluetooth (GPS + GoPro), video import, Claude streaming
```

## Notes

- Track coordinates in the catalog are approximate circuit centres, used for auto-detection and for
  framing the map. Start/finish lines are deliberately not hard-coded. You place them on the map, or
  the app learns them from your first lap. They are then saved.
- iPhone GPS runs at about 1 Hz (up to 10 Hz on newer models). Fusion makes the delta smooth. For karting
  and the most exact lap times, use a 10-25 Hz receiver.
- The AI coach sends compact session statistics, not raw GPS traces, to the Anthropic API. Nothing
  is sent until you ask the coach something.
