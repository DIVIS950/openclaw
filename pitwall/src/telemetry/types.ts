/**
 * One telemetry frame. The ESP32 sends 25 of these per second.
 * Temperatures are °C. A sensor that is missing or unplugged reports NaN.
 */
export interface TelemetryFrame {
  /** Milliseconds, monotonic clock of the data source. */
  t: number;
  lat: number;
  lon: number;
  speedKmh: number;
  /** Degrees, 0 = north, clockwise. */
  heading: number;
  sats: number;
  gpsHz: number;
  tyre: { fl: number; fr: number; rl: number; rr: number };
  brake: { fl: number; fr: number };
  coolant: number;
  oil: number;
  egt: number;
  battV: number;
}

export type SourceKind = 'simulator' | 'ble';

export type SourceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Everything the app knows about where data comes from.
 * The simulator and the real ESP32 (BLE) both implement this, so the rest of
 * the app never needs to know which one is plugged in.
 */
export interface TelemetrySource {
  readonly kind: SourceKind;
  /** Current connection state. */
  readonly status: SourceStatus;
  /** Human readable reason for the last error, if any. */
  readonly statusMessage?: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Subscribe to frames. Returns an unsubscribe function. */
  onFrame(cb: (frame: TelemetryFrame) => void): () => void;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatus(cb: (status: SourceStatus, message?: string) => void): () => void;
}
