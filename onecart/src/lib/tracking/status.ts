import type { Shipment, ShipmentStatus, TrackingEvent } from '../types';

/**
 * Demo tracking timeline. Real carrier status needs a tracking API account
 * (AfterShip, 17TRACK, EasyPost...). Until one is connected we simulate the
 * usual journey; 1 simulated hour passes per real minute so it moves while you watch.
 */
export const DEMO_TIME_SCALE = 60;

const STEPS: { afterHours: number; status: ShipmentStatus; message: string; location?: string }[] = [
  { afterHours: 0, status: 'label_created', message: 'Shipping label created' },
  { afterHours: 4, status: 'in_transit', message: 'Picked up by carrier', location: 'Origin facility' },
  { afterHours: 20, status: 'in_transit', message: 'Departed sorting hub', location: 'Regional hub' },
  { afterHours: 44, status: 'in_transit', message: 'Arrived at local facility', location: 'Local depot' },
  { afterHours: 56, status: 'out_for_delivery', message: 'Out for delivery', location: 'Local depot' },
  { afterHours: 62, status: 'delivered', message: 'Delivered', location: 'Front door' },
];

export function simulateTracking(shipment: Pick<Shipment, 'createdAt'>, now = Date.now()): TrackingEvent[] {
  const start = Date.parse(shipment.createdAt);
  const elapsedHours = ((now - start) / 3_600_000) * DEMO_TIME_SCALE;
  return STEPS.filter((s) => s.afterHours <= elapsedHours)
    .map((s) => ({
      at: new Date(start + (s.afterHours * 3_600_000) / DEMO_TIME_SCALE).toISOString(),
      status: s.status,
      message: s.message,
      location: s.location,
    }))
    .reverse();
}

export function currentStatus(events: TrackingEvent[]): ShipmentStatus {
  return events[0]?.status ?? 'unknown';
}

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  label_created: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  unknown: 'Unknown',
};

export const STATUS_PROGRESS: Record<ShipmentStatus, number> = {
  unknown: 0,
  label_created: 0.15,
  in_transit: 0.5,
  out_for_delivery: 0.8,
  delivered: 1,
};
