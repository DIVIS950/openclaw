/**
 * ESP32 over Bluetooth Low Energy (react-native-ble-plx).
 *
 * Works in a development build (see README). In Expo Go the native Bluetooth
 * module does not exist, so connect() reports a clear error instead of crashing:
 * the library is only loaded at the moment you connect.
 *
 * Flow: wait for Bluetooth on → scan for SERVICE_UUID / a "PITWALL…" name →
 * connect (MTU 64, the packet is 42 bytes) → subscribe to FRAME_CHAR_UUID →
 * every notification is decoded with decodeFrame() and emitted. If the link
 * drops, it keeps reconnecting until you press Disconnect.
 *
 * Nothing else in the app knows about Bluetooth: the lap timer, warnings,
 * recording and all screens only ever see TelemetryFrame objects.
 *
 * The packet format lives in blePacket.ts.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { BaseSource } from './BaseSource';
import { DEVICE_NAME_PREFIX, FRAME_CHAR_UUID, SERVICE_UUID, decodeFrame } from './blePacket';

export * from './blePacket';

const SCAN_TIMEOUT_MS = 15_000;
const RETRY_MS = 2_000;

/** base64 (what ble-plx gives us) → bytes. `atob` is built into Hermes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Load react-native-ble-plx only when needed; null where Bluetooth cannot work. */
function loadBle(): typeof import('react-native-ble-plx') | null {
  if (Platform.OS === 'web') return null;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null; // Expo Go
  if (!NativeModules.BlePlx) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-ble-plx');
}

export class BleSource extends BaseSource {
  readonly kind = 'ble' as const;
  private manager: BleManager | null = null;
  private device: Device | null = null;
  private subs: Subscription[] = [];
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Packets lost on the radio link, from gaps in the sequence number. */
  dropped = 0;
  private lastSeq = -1;

  async connect() {
    const ble = loadBle();
    if (!ble) {
      this.setStatus('error', Platform.OS === 'web' ? 'Bluetooth is not available in the browser.' : 'ESP32 Bluetooth needs a development build. Use the Simulator in Expo Go.');
      return;
    }
    this.stopped = false;
    this.manager ??= new ble.BleManager();
    await this.attempt(ble);
  }

  private async attempt(ble: typeof import('react-native-ble-plx')) {
    const manager = this.manager;
    if (!manager || this.stopped) return;
    this.setStatus('connecting', 'Looking for the PITWALL box…');
    try {
      await this.waitPoweredOn(manager, ble.State.PoweredOn);
      const found = await this.scan(manager);
      const device = await manager.connectToDevice(found.id, { requestMTU: 64, timeout: 10_000 });
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;
      this.lastSeq = -1;
      this.subs.push(
        device.monitorCharacteristicForService(SERVICE_UUID, FRAME_CHAR_UUID, (err, ch) => {
          if (err || !ch?.value) return;
          const bytes = base64ToBytes(ch.value);
          const frame = decodeFrame(bytes);
          if (!frame) return;
          const seq = bytes[2] | (bytes[3] << 8);
          if (this.lastSeq >= 0) this.dropped += (seq - this.lastSeq - 1 + 65536) % 65536;
          this.lastSeq = seq;
          this.emitFrame(frame);
        }),
        manager.onDeviceDisconnected(device.id, () => {
          this.clearSubs();
          if (!this.stopped) this.retry(ble, 'Lost the ESP32. Reconnecting…');
        }),
      );
      this.setStatus('connected', device.name ?? 'PITWALL');
    } catch (e) {
      this.retry(ble, e instanceof Error ? e.message : String(e));
    }
  }

  private retry(ble: typeof import('react-native-ble-plx'), message: string) {
    if (this.stopped) return;
    this.setStatus('connecting', message);
    this.retryTimer = setTimeout(() => this.attempt(ble), RETRY_MS);
  }

  private waitPoweredOn(manager: BleManager, poweredOn: string) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.remove();
        reject(new Error('Turn on Bluetooth on the phone.'));
      }, 8_000);
      const sub = manager.onStateChange((state) => {
        if (state === poweredOn) {
          clearTimeout(timer);
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  private scan(manager: BleManager) {
    return new Promise<Device>((resolve, reject) => {
      const timer = setTimeout(() => {
        manager.stopDeviceScan();
        reject(new Error('No PITWALL box found. Is it powered and close by?'));
      }, SCAN_TIMEOUT_MS);
      manager.startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
        if (err) {
          clearTimeout(timer);
          manager.stopDeviceScan();
          reject(err);
          return;
        }
        const name = d?.name ?? d?.localName ?? '';
        if (d && (name.startsWith(DEVICE_NAME_PREFIX) || d.serviceUUIDs?.includes(SERVICE_UUID))) {
          clearTimeout(timer);
          manager.stopDeviceScan();
          resolve(d);
        }
      });
    });
  }

  private clearSubs() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  async disconnect() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.clearSubs();
    try {
      await this.manager?.stopDeviceScan();
      if (this.device) await this.device.cancelConnection();
    } catch {
      // already gone
    }
    this.device = null;
    this.setStatus('disconnected');
  }
}
