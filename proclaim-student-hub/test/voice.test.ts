import { afterEach, describe, expect, it, vi } from "vitest";
import { listen, MicBlockedError } from "../src/lib/voice.ts";

// A stand-in for the browser's speech recognition that fires only what a test asks for.
class FakeRecognition {
  static fire: string[] = [];
  lang = "";
  interimResults = false;
  private fns = new Map<string, Array<(e?: unknown) => void>>();
  addEventListener(type: string, fn: (e?: unknown) => void) {
    this.fns.set(type, [...(this.fns.get(type) ?? []), fn]);
  }
  emit(type: string, e?: unknown) {
    for (const fn of this.fns.get(type) ?? []) {
      fn(e);
    }
  }
  start() {
    for (const type of FakeRecognition.fire) {
      this.emit(type, type === "result" ? { results: [[{ transcript: "hola" }]] } : undefined);
    }
  }
  stop() {
    this.emit("end");
  }
}

function withWindow() {
  vi.stubGlobal("window", {
    webkitSpeechRecognition: FakeRecognition,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("listen", () => {
  it("resolves with what was heard", async () => {
    withWindow();
    FakeRecognition.fire = ["start", "result", "end"];
    await expect(listen().done).resolves.toBe("hola");
  });

  it("treats a microphone that never starts as blocked", async () => {
    vi.useFakeTimers();
    withWindow();
    FakeRecognition.fire = [];
    const heard = listen().done;
    const check = expect(heard).rejects.toBeInstanceOf(MicBlockedError);
    await vi.advanceTimersByTimeAsync(4500);
    await check;
  });
});
