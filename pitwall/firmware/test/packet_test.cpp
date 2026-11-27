// Encodes a few known frames and prints them as hex, one per line.
// `npm run packet:check` decodes them with the app's decodeFrame() and compares.
#include <stdio.h>
#include "../pitwall-esp32/packet.h"

static void dump(const PitwallFrame& f) {
  uint8_t b[PITWALL_PACKET_BYTES];
  encodePitwall(f, b);
  for (int i = 0; i < PITWALL_PACKET_BYTES; i++) printf("%02x", b[i]);
  printf("\n");
}

int main() {
  PitwallFrame a = {};
  a.seq = 65535; a.tMs = 123456789; a.gpsFix = true;
  a.lat = 50.5241234; a.lon = 13.5781234; a.speedKmh = 141.37f; a.headingDeg = 359.99f;
  a.sats = 17; a.gpsHz = 25;
  a.tyre[0] = 84.2f; a.tyre[1] = 101.7f; a.tyre[2] = 61.0f; a.tyre[3] = 75.5f;
  a.brake[0] = 702.4f; a.brake[1] = 643.0f;
  a.coolant = 98.6f; a.oil = 104.1f; a.egt = 887.0f; a.battV = 13.84f;
  dump(a);

  PitwallFrame b = a;  // no GPS fix, one tyre sensor dead, no EGT, negative coordinates
  b.seq = 0; b.gpsFix = false; b.lat = -33.8688; b.lon = -151.2093;
  b.tyre[2] = NAN; b.egt = NAN; b.coolant = -5.5f;
  dump(b);
  return 0;
}
