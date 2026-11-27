import type { SourceKind, SourceStatus, TelemetryFrame, TelemetrySource } from './types';

/** Shared listener plumbing so each source only implements connect/disconnect. */
export abstract class BaseSource implements TelemetrySource {
  abstract readonly kind: SourceKind;
  status: SourceStatus = 'disconnected';
  statusMessage?: string;

  private frameListeners = new Set<(frame: TelemetryFrame) => void>();
  private statusListeners = new Set<(status: SourceStatus, message?: string) => void>();

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  onFrame(cb: (frame: TelemetryFrame) => void) {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  onStatus(cb: (status: SourceStatus, message?: string) => void) {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  protected emitFrame(frame: TelemetryFrame) {
    for (const cb of this.frameListeners) cb(frame);
  }

  protected setStatus(status: SourceStatus, message?: string) {
    this.status = status;
    this.statusMessage = message;
    for (const cb of this.statusListeners) cb(status, message);
  }
}
