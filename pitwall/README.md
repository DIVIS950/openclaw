# PITWALL Telemetry

Lap timing and car telemetry for a 2006 Škoda Fabia circuit car, on your iPhone.

Today it runs in **Expo Go** with a built-in **simulator**: a fake 1.8 km, 10-corner
circuit at 25 Hz, with tyre, brake, coolant, oil and EGT temperatures. Later it
gets the same data over **Bluetooth (BLE)** from an ESP32 box in the car with a
25 Hz u-blox GPS. Only one file has to change for that: `src/telemetry/BleSource.ts`.

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
   red = slower), current lap time, speed, last and best lap, and sector times.
   Turn the phone sideways for the landscape layout. The screen stays on during a session.
2. **TRACK**: the map builds itself from GPS. After the first lap the best lap is
   drawn as the racing line, coloured by speed, with the car moving live.
   **SET START / FINISH HERE** moves the line to where the car is. The table shows
   sector times for the lap in progress, the last lap and the best lap, plus the ideal lap (best S1 + S2 + S3).
3. **TEMPS**: top view of the car. The 4 tyres and 2 front discs go blue (cold) →
   green (optimal) → amber → red (over the limit). Gauges for coolant, oil and EGT,
   with the limit shown as a red tick.
4. **SESSIONS**: every finished lap is saved automatically. Open a session to
   see its laps. Tap a lap for its line on the map and graphs of speed and temps
   over distance. Tick two laps and press **COMPARE** to overlay them, including
   a time-gap graph showing where you gain or lose. Long-press a session to delete it.
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
    BleSource.ts        ESP32 stub: UUIDs, packet layout, decodeFrame()
  lap/
    LapTimer.ts         start/finish crossing, lap + sector times, live delta
    geo.ts              lat/lon ↔ metres, segment intersection
    record.ts           how a lap is stored (12.5 Hz columns)
  store/
    live.ts             session engine: source → lap timer → warnings → saving
    settings.ts         limits, sensors, units, start/finish (saved on the phone)
  storage/sessions.ts   AsyncStorage: sessions and their laps
  app/                  screens (Expo Router)
  ui/                   theme, map, gauges, car diagram, charts
scripts/sim-check.ts    headless test of simulator + lap timer
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

## Plug in the real ESP32

The rest of the app only ever sees `TelemetryFrame` objects, so this is the whole job:

1. **Make a development build.** BLE does not work in Expo Go.
   ```bash
   npx expo install react-native-ble-plx
   ```
   Add the plugin to `app.json` (`"plugins": ["expo-router", ["react-native-ble-plx", { "isBackgroundEnabled": false }]]`),
   then `npx expo run:ios` (Mac with Xcode) or `npx eas-cli@latest build --profile development --platform ios`.
2. **Fill in `src/telemetry/BleSource.ts`.** The TODOs are there: scan for a device
   named `PITWALL…`, connect, `requestMTU(64)`, subscribe to `FRAME_CHAR_UUID`,
   and for every notification do `this.emitFrame(decodeFrame(bytes))`.
   `decodeFrame()` is already written. ble-plx gives you base64; convert it with
   `Uint8Array.from(atob(value), (c) => c.charCodeAt(0))`.
3. On the phone, open **DEVICE**, pick **ESP32 · BLE**, and press **CONNECT & START**.

### What the ESP32 must send

| | |
|---|---|
| Service UUID | `7a1f0001-5c3e-4b8a-9f2d-0b1e2c3d4e5f` |
| Frame characteristic (notify) | `7a1f0002-5c3e-4b8a-9f2d-0b1e2c3d4e5f` |
| Config characteristic (write) | `7a1f0003-5c3e-4b8a-9f2d-0b1e2c3d4e5f` |
| Device name | starts with `PITWALL` |
| Rate | one 42-byte notification per GPS fix (25 Hz) |

The packet is little-endian. The full byte table is at the top of `BleSource.ts`:
version, flags (GPS fix + which sensors are OK), sequence number, time, lat/lon × 1e7,
speed × 100, heading × 100, satellites, GPS rate, then tyres FL/FR/RL/RR, brakes
FL/FR, coolant, oil and EGT as °C × 10, and battery in millivolts. A sensor whose
flag bit is off shows as "—" and never raises a warning.

Firmware tips: set the u-blox to 25 Hz (`UBX-CFG-RATE` 40 ms) and read `UBX-NAV-PVT`
over UART at 230400 baud or more. Send one notification per GPS fix, and fill in the
latest temperature readings. On the ESP32, NimBLE with MTU 64+ handles 1 kB/s easily.

## Checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint (expo config)
npm run sim:check   # runs the simulator through the lap timer: lap times, sectors, delta accuracy, temps
```
