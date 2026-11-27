/**
 * Proves the ESP32 encoder (firmware/pitwall-esp32/packet.h) and the app's
 * decoder (decodeFrame) agree. Run: `npm run packet:check` (needs g++).
 */
import { decodeFrame } from '../src/telemetry/blePacket';

// Node's child_process; typed inline so the app's tsconfig doesn't need Node types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require('child_process') as { execSync: (cmd: string) => { toString(): string } };

const out = execSync('g++ -std=c++17 -o /tmp/pitwall-packet-test firmware/test/packet_test.cpp && /tmp/pitwall-packet-test').toString().trim().split('\n');
const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

const errors: string[] = [];
const near = (name: string, got: number, want: number, tol: number) => {
  const ok = Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) <= tol;
  if (!ok) errors.push(`${name}: got ${got}, want ${want}`);
};

const a = decodeFrame(hex(out[0]))!;
near('t', a.t, 123456789, 0);
near('lat', a.lat, 50.5241234, 1e-7);
near('lon', a.lon, 13.5781234, 1e-7);
near('speed', a.speedKmh, 141.37, 0.01);
near('heading', a.heading, 359.99, 0.01);
near('sats', a.sats, 17, 0);
near('gpsHz', a.gpsHz, 25, 0);
near('tyre fl', a.tyre.fl, 84.2, 0.05);
near('tyre fr', a.tyre.fr, 101.7, 0.05);
near('tyre rl', a.tyre.rl, 61, 0.05);
near('tyre rr', a.tyre.rr, 75.5, 0.05);
near('brake fl', a.brake.fl, 702.4, 0.05);
near('brake fr', a.brake.fr, 643, 0.05);
near('coolant', a.coolant, 98.6, 0.05);
near('oil', a.oil, 104.1, 0.05);
near('egt', a.egt, 887, 0.05);
near('battV', a.battV, 13.84, 0.001);

const b = decodeFrame(hex(out[1]))!;
near('no fix lat', b.lat, NaN, 0);
near('dead tyre rl', b.tyre.rl, NaN, 0);
near('other tyre fl', b.tyre.fl, 84.2, 0.05);
near('no egt', b.egt, NaN, 0);
near('negative coolant', b.coolant, -5.5, 0.05);

if (errors.length) {
  console.error('FAIL\n' + errors.join('\n'));
  throw new Error("packet check failed");
}
console.log(`OK · ${out.length} packets, ${out[0].length / 2} bytes each, encoder and decoder agree`);
