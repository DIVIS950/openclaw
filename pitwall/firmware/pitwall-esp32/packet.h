// PITWALL telemetry packet: one 42-byte BLE notification per GPS fix.
// Plain C++ (no Arduino headers) so it can be unit-tested on a computer.
// The app decodes this in src/telemetry/BleSource.ts -> decodeFrame(). Keep both in sync.
#pragma once
#include <math.h>
#include <stdint.h>

static const int PITWALL_PACKET_BYTES = 42;
static const int16_t PITWALL_NO_READING = -32768;

struct PitwallFrame {
  uint16_t seq;      // increments every packet, wraps
  uint32_t tMs;      // millis() at the GPS fix
  bool gpsFix;
  double lat, lon;   // degrees
  float speedKmh;
  float headingDeg;
  uint8_t sats;
  uint8_t gpsHz;
  float tyre[4];     // FL FR RL RR, °C, NAN = no reading
  float brake[2];    // FL FR, °C
  float coolant, oil, egt;  // °C
  float battV;
};

namespace pitwall_detail {
inline void put16(uint8_t* b, int o, uint16_t v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; }
inline void put32(uint8_t* b, int o, uint32_t v) {
  b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; b[o + 2] = (v >> 16) & 0xFF; b[o + 3] = (v >> 24) & 0xFF;
}
// °C -> °C × 10 as int16, or the no-reading marker.
inline int16_t temp10(float c) {
  if (!isfinite(c)) return PITWALL_NO_READING;
  float v = c * 10.0f;
  if (v > 32767.0f) v = 32767.0f;
  if (v < -32767.0f) v = -32767.0f;
  return (int16_t)lroundf(v);
}
inline bool anyFinite(const float* xs, int n) {
  for (int i = 0; i < n; i++) if (isfinite(xs[i])) return true;
  return false;
}
}  // namespace pitwall_detail

// Little-endian layout, see the table in BleSource.ts.
inline void encodePitwall(const PitwallFrame& f, uint8_t* b) {
  using namespace pitwall_detail;
  uint8_t flags = 0;
  if (f.gpsFix) flags |= 1 << 0;
  if (anyFinite(f.tyre, 4)) flags |= 1 << 1;
  if (anyFinite(f.brake, 2)) flags |= 1 << 2;
  if (isfinite(f.coolant)) flags |= 1 << 3;
  if (isfinite(f.oil)) flags |= 1 << 4;
  if (isfinite(f.egt)) flags |= 1 << 5;

  b[0] = 1;  // version
  b[1] = flags;
  put16(b, 2, f.seq);
  put32(b, 4, f.tMs);
  put32(b, 8, (uint32_t)(int32_t)llround(f.lat * 1e7));
  put32(b, 12, (uint32_t)(int32_t)llround(f.lon * 1e7));
  float sp = f.speedKmh < 0 ? 0 : f.speedKmh;
  put16(b, 16, (uint16_t)lroundf(sp * 100.0f > 65535.0f ? 65535.0f : sp * 100.0f));
  float hd = fmodf(f.headingDeg < 0 ? f.headingDeg + 360.0f : f.headingDeg, 360.0f);
  put16(b, 18, (uint16_t)lroundf(hd * 100.0f));
  b[20] = f.sats;
  b[21] = f.gpsHz;
  for (int i = 0; i < 4; i++) put16(b, 22 + 2 * i, (uint16_t)temp10(f.tyre[i]));
  put16(b, 30, (uint16_t)temp10(f.brake[0]));
  put16(b, 32, (uint16_t)temp10(f.brake[1]));
  put16(b, 34, (uint16_t)temp10(f.coolant));
  put16(b, 36, (uint16_t)temp10(f.oil));
  put16(b, 38, (uint16_t)temp10(f.egt));
  float mv = f.battV * 1000.0f;
  put16(b, 40, (uint16_t)lroundf(mv < 0 ? 0 : (mv > 65535.0f ? 65535.0f : mv)));
}
