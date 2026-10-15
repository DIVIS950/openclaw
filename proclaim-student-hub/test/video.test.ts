import { describe, expect, it } from "vitest";
import { distinctFrames, frameDifference } from "../src/lib/video.ts";

const frame = (value: number) => new Uint8ClampedArray(64).fill(value);

describe("screen recording frames", () => {
  it("measures how much two frames differ", () => {
    expect(frameDifference(frame(10), frame(10))).toBe(0);
    expect(frameDifference(frame(0), frame(100))).toBe(100);
    expect(frameDifference(frame(0), new Uint8ClampedArray(3))).toBe(255);
  });

  it("keeps only frames where the screen changed", () => {
    // Paused on screen A, scrolled to B, paused, then C.
    const frames = [frame(10), frame(11), frame(12), frame(80), frame(81), frame(150)];
    expect(distinctFrames(frames)).toEqual([0, 3, 5]);
  });

  it("compares against the last kept frame, so slow scrolling still adds screens", () => {
    const slow = [0, 2, 4, 6, 8].map(frame);
    expect(distinctFrames(slow)).toEqual([0, 2, 4]);
  });
});
