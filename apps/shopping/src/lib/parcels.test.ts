import { describe, expect, it } from "vitest";
import { findPlace } from "./geo";
import { heuristicEta, makeParcel, parcelEvents, parcelProgress, parcelStatus } from "./parcels";

const H = 36e5;
const parcel = (shippedAgoH: number, mode: "air" | "road" = "road") =>
  makeParcel({ title: "Shoes", store: "Zalando", carrier: "DPD", from: findPlace("Berlin")!, to: findPlace("Prague")!, mode, maxDays: 3, shippedAt: Date.now() - shippedAgoH * H });

describe("parcels", () => {
  it("progresses from 0 to 1 and then stays delivered", () => {
    expect(parcelProgress(parcel(0))).toBeCloseTo(0, 2);
    expect(parcelProgress(parcel(30))).toBeGreaterThan(0.3);
    expect(parcelProgress(parcel(500))).toBe(1);
    expect(parcelStatus(parcel(500))).toBe("Delivered");
  });

  it("lists journey events in time order with only past ones done", () => {
    const events = parcelEvents(parcel(30));
    for (let i = 1; i < events.length; i++) expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
    expect(events[0].done).toBe(true);
    expect(events[events.length - 1].done).toBe(false);
  });

  it("gives flights a boarding pass and estimates arrival in the future", () => {
    const p = parcel(10, "air");
    expect(p.flight?.number).toMatch(/^[A-Z]{2} \d{3}$/);
    expect(heuristicEta(p).eta).toBeGreaterThan(Date.now());
  });
});
