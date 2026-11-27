import { BleSource } from './BleSource';
import { SimulatorSource } from './SimulatorSource';
import type { SourceKind, TelemetrySource } from './types';

/** The one place that decides which data source the app uses. */
export function createSource(kind: SourceKind): TelemetrySource {
  return kind === 'ble' ? new BleSource() : new SimulatorSource();
}

export * from './types';
