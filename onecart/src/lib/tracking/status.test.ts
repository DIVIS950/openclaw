import { describe, expect, it } from 'vitest';

import { currentStatus, DEMO_TIME_SCALE, simulateTracking } from './status';

const start = Date.parse('2026-01-01T00:00:00Z');
const at = (simHours: number) => start + (simHours * 3_600_000) / DEMO_TIME_SCALE;

describe('simulateTracking', () => {
  it('starts with a label', () => {
    expect(currentStatus(simulateTracking({ createdAt: new Date(start).toISOString() }, start))).toBe('label_created');
  });

  it('ends delivered with newest event first', () => {
    const events = simulateTracking({ createdAt: new Date(start).toISOString() }, at(100));
    expect(events[0].status).toBe('delivered');
    expect(events.at(-1)?.status).toBe('label_created');
  });

  it('is out for delivery before it is delivered', () => {
    expect(currentStatus(simulateTracking({ createdAt: new Date(start).toISOString() }, at(58)))).toBe(
      'out_for_delivery',
    );
  });
});
