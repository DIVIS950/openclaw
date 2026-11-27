/**
 * ESP32 over Bluetooth Low Energy — STUB.
 *
 * This file is the ONLY thing to replace when the real box is ready.
 * It deliberately imports nothing native, so the app keeps running in Expo Go.
 *
 * ── Plan ────────────────────────────────────────────────────────────────
 * 1. `npx expo install react-native-ble-plx` and add its config plugin to
 *    app.json, then make a development build (`npx expo run:ios` or
 *    `eas build --profile development`). BLE does not work in Expo Go.
 * 2. In connect():
 *      - manager = new BleManager()
 *      - scan for devices whose name starts with DEVICE_NAME_PREFIX
 *        (or that advertise SERVICE_UUID)
 *      - device.connect(), then device.requestMTU(64)  ← the packet is 42 bytes
 *      - device.discoverAllServicesAndCharacteristics()
 *      - device.monitorCharacteristicForService(SERVICE_UUID, FRAME_CHAR_UUID, cb)
 *        cb gets base64 → bytes → decodeFrame(bytes) → this.emitFrame(frame)
 *      - device.onDisconnected → setStatus('error', 'Lost connection') and retry
 * 3. In disconnect(): cancel the monitor subscription, device.cancelConnection().
 *
 * Nothing else in the app changes: the lap timer, warnings, recording and
 * all screens only ever see TelemetryFrame objects.
 *
 * ── Packet layout (ESP32 → phone, one BLE notification, little-endian) ──
 *  offset size type  field        scale / unit
 *   0     1   u8    version      = 1
 *   1     1   u8    flags        bit0 GPS fix, bit1 tyres ok, bit2 brakes ok,
 *                                bit3 coolant ok, bit4 oil ok, bit5 EGT ok
 *   2     2   u16   seq          wraps, detects dropped packets
 *   4     4   u32   t            ms since ESP32 boot
 *   8     4   i32   lat          degrees × 1e7
 *  12     4   i32   lon          degrees × 1e7
 *  16     2   u16   speed        km/h × 100
 *  18     2   u16   heading      degrees × 100
 *  20     1   u8    sats
 *  21     1   u8    gpsHz
 *  22     2   i16   tyre FL      °C × 10
 *  24     2   i16   tyre FR      °C × 10
 *  26     2   i16   tyre RL      °C × 10
 *  28     2   i16   tyre RR      °C × 10
 *  30     2   i16   brake FL     °C × 10
 *  32     2   i16   brake FR     °C × 10
 *  34     2   i16   coolant      °C × 10
 *  36     2   i16   oil          °C × 10
 *  38     2   i16   EGT          °C × 10
 *  40     2   u16   battery      millivolts
 *  = 42 bytes, 25 per second ≈ 1 kB/s.
 */
import { BaseSource } from './BaseSource';
import type { TelemetryFrame } from './types';

export const DEVICE_NAME_PREFIX = 'PITWALL';
/** Custom 128-bit UUIDs. Use the same ones in the ESP32 firmware. */
export const SERVICE_UUID = '7a1f0001-5c3e-4b8a-9f2d-0b1e2c3d4e5f';
/** Notify: one telemetry packet (layout above) per notification. */
export const FRAME_CHAR_UUID = '7a1f0002-5c3e-4b8a-9f2d-0b1e2c3d4e5f';
/** Write: config for the box, e.g. [0x01, hz] sets the GPS rate. */
export const CONFIG_CHAR_UUID = '7a1f0003-5c3e-4b8a-9f2d-0b1e2c3d4e5f';

export const PACKET_BYTES = 42;

/** Bytes from the ESP32 → TelemetryFrame. Sensors flagged as not ok become NaN. */
export function decodeFrame(bytes: Uint8Array): TelemetryFrame | null {
  if (bytes.length < PACKET_BYTES || bytes[0] !== 1) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = v.getUint8(1);
  const ok = (bit: number) => (flags & (1 << bit)) !== 0;
  const temp = (offset: number, bit: number) => (ok(bit) ? v.getInt16(offset, true) / 10 : NaN);
  const fix = ok(0);
  return {
    t: v.getUint32(4, true),
    lat: fix ? v.getInt32(8, true) / 1e7 : NaN,
    lon: fix ? v.getInt32(12, true) / 1e7 : NaN,
    speedKmh: v.getUint16(16, true) / 100,
    heading: v.getUint16(18, true) / 100,
    sats: v.getUint8(20),
    gpsHz: v.getUint8(21),
    tyre: { fl: temp(22, 1), fr: temp(24, 1), rl: temp(26, 1), rr: temp(28, 1) },
    brake: { fl: temp(30, 2), fr: temp(32, 2) },
    coolant: temp(34, 3),
    oil: temp(36, 4),
    egt: temp(38, 5),
    battV: v.getUint16(40, true) / 1000,
  };
}

export class BleSource extends BaseSource {
  readonly kind = 'ble' as const;

  async connect() {
    this.setStatus('connecting');
    // TODO(BLE): scan, connect, requestMTU(64), monitor FRAME_CHAR_UUID,
    // and call this.emitFrame(decodeFrame(bytes)) for every notification.
    this.setStatus('error', 'ESP32 Bluetooth needs a development build. Use the Simulator in Expo Go.');
  }

  async disconnect() {
    // TODO(BLE): cancel the notification subscription and the connection.
    this.setStatus('disconnected');
  }
}
