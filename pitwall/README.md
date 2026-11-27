# PITWALL Telemetry

Lap timing and car telemetry for a 2006 Škoda Fabia circuit car, on your iPhone.

Today it runs in **Expo Go** with a built-in **simulator**: a fake 1.8 km, 10-corner
circuit at 25 Hz, with tyre, brake, coolant, oil and EGT temperatures. With the
ESP32 box in the car (firmware and wiring in `firmware/`) it gets the same data over
**Bluetooth (BLE)** from a 25 Hz u-blox GPS and real sensors.

## Run it on your iPhone

You need: a computer with **Node.js 20+**, and the **Expo Go** app on the iPhone (App Store).

```bash
cd pitwall
npm install
npx expo start
```

Scan the QR code with the iPhone camera, and it opens in Expo Go.

- Phone and computer must be on the same Wi-Fi. If they can't be, use `npx expo start --tunnel`.
- The project uses **Expo SDK 58**. If Expo Go says the project is incompatible,
  update Expo Go from the App Store.

## Using it

1. **LIVE**: press **START SESSION**. Big delta to your best lap (green = faster,
   red = slower), current lap time, **predicted lap time**, speed, last and best lap,
   and sector times. **Tap the delta** for a full-screen view you can read at a glance
   from a phone mount (the background turns green or red). Every finished lap pops up
   a big card: purple = new best, green = faster, red = slower, with a haptic tap.
   Turn the phone sideways for the landscape layout. The screen stays on during a session.
2. **TRACK**: real **satellite imagery** (Apple Maps) under the racing line, or switch
   to the plain LINE view. After the first lap the best lap is drawn coloured by speed,
   with the car moving live. (The simulator's made-up circuit is placed on open ground,
   so in the demo the line runs over fields; with the real box it sits on your real track.)
   **SET START / FINISH HERE** moves the line to where the car is. The table shows
   sector times for the lap in progress, the last lap and the best lap, plus the ideal lap (best S1 + S2 + S3).
3. **TEMPS**: top view of the car. The 4 tyres and 2 front discs go blue (cold) →
   green (optimal) → amber → red (over the limit). Gauges for coolant, oil and EGT,
   with the limit shown as a red tick.
4. **SESSIONS**: every finished lap is saved automatically, with your **personal best
   across all sessions** at the top. Open a session to see its laps. Tap a lap for its
   line on the map with **braking points**, and graphs of speed and temps over distance.
   Tick two laps and press **COMPARE**: the map turns green where the second lap gains
   and red where it loses, plus a time-gap graph. **EXPORT CSV** sends every sample to
   Files, Mail or AirDrop for Excel or Numbers. Long-press a session to delete it.
5. **DEVICE**: source (Simulator / ESP32), connection status, GPS rate, satellites,
   battery voltage, warning limits, sensor on/off, units (km/h·°C or mph·°F), vibration.

**Warnings:** when a value goes over its limit, a red banner flashes over every
screen and the phone vibrates once, then again only if the value drops back and
goes over again. In the simulator, coolant climbs through the session and passes
the default 105 °C after about 10 minutes. To see a warning straight away, lower
the coolant limit on DEVICE (e.g. to 85 °C) or press **TEST ALARM**.

Timing colours work like F1: **purple** = session best, **green** = better than
your previous lap, **yellow** = slower.

## How it works

```
src/
  telemetry/
    types.ts            TelemetryFrame + TelemetrySource interface
    index.ts            createSource(kind): the one switch between sim and BLE
    SimulatorSource.ts  fake car: physics, GPS, temperatures, 25 Hz timer
    sim/circuit.ts      the fake circuit + speed profile (grip, braking, acceleration)
    BleSource.ts        ESP32 over Bluetooth (react-native-ble-plx), auto-reconnect
    blePacket.ts        UUIDs, 42-byte packet layout, decodeFrame()
  lap/
    LapTimer.ts         start/finish crossing, lap + sector times, live delta
    geo.ts              lat/lon ↔ metres, segment intersection
    record.ts           how a lap is stored (12.5 Hz columns)
    analysis.ts         braking points, gain/loss colouring
  store/
    live.ts             session engine: source → lap timer → warnings → saving
    settings.ts         limits, sensors, units, start/finish (saved on the phone)
  storage/sessions.ts   AsyncStorage: sessions and their laps
  app/                  screens (Expo Router)
  ui/                   theme, map, gauges, car diagram, charts
scripts/sim-check.ts    headless test of simulator + lap timer
scripts/packet-check.ts firmware encoder vs app decoder
firmware/               ESP32 sketch, parts list, wiring
```

**Lap logic.** A lap ends when the line between two GPS points crosses the
start/finish line (a 30 m segment across the track). The exact crossing time
is interpolated between the two points, so a 25 Hz GPS (40 ms apart) still gives
times to a few milliseconds. Crossings in the wrong direction, or less than 15 s
apart, are ignored. Sectors split the lap into thirds by distance.

**Delta.** For every frame the app finds the matching point on the best lap and
compares the time it took to get there, so it is a delta at the same distance
into the lap. It matches by position on the best lap's line rather than only by your
own distance count, so a lap driven a few metres wider or tighter does not drift
the delta.

**Performance.** All 25 frames per second are processed (lap timing needs them),
but the screens update about 12 times a second. Laps are saved at 12.5 Hz, about
70 KB per lap.

## Connect the real ESP32

The Bluetooth code is written (`src/telemetry/BleSource.ts`) and the box's firmware,
parts list and wiring are in [`firmware/`](firmware/README.md). Bluetooth needs a
**development build** of the app instead of Expo Go (Expo Go has no Bluetooth module;
there the app just says so and keeps working with the simulator).

1. Build the box: see `firmware/README.md`.
2. Make a development build once (it installs like a normal app on your iPhone):
   ```bash
   npx expo install expo-dev-client
   npx eas-cli@latest build --profile development --platform ios
   ```
   (or `npx expo run:ios --device` on a Mac with Xcode). Needs an Apple developer account.
   Afterwards `npx expo start` opens in that build instead of Expo Go.
3. On the phone: **DEVICE → ESP32 · BLE → CONNECT & START**. The app scans for the box,
   connects, and reconnects by itself if the link drops.

| | |
|---|---|
| Service UUID | `7a1f0001-5c3e-4b8a-9f2d-0b1e2c3d4e5f` |
| Frame characteristic (notify) | `7a1f0002-5c3e-4b8a-9f2d-0b1e2c3d4e5f` |
| Config characteristic (write) | `7a1f0003-5c3e-4b8a-9f2d-0b1e2c3d4e5f` (`[0x01, hz]` sets the GPS rate) |
| Device name | starts with `PITWALL` |
| Packet | 42 bytes, little-endian, one per GPS fix; layout in `src/telemetry/blePacket.ts` |

The firmware encoder (`firmware/pitwall-esp32/packet.h`) and the app's decoder are
checked against each other by `npm run packet:check`.

## Checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint (expo config)
npm run sim:check   # runs the simulator through the lap timer: lap times, sectors, delta accuracy, temps
npm run packet:check # compiles the firmware packet encoder (g++) and decodes it with the app
```
