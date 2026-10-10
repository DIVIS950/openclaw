// Little rewards for practice: short synthesised sounds (no audio files, so
// they work offline) with a mute switch, remembered on this device.

const SOUND_KEY = "psh.lab.sound";
let ctx: AudioContext | null = null;

export const sound = {
  on(): boolean {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  },
  set(on: boolean) {
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      // Not remembered.
    }
  },
};

type Fx = "right" | "wrong" | "combo" | "win" | "flip";

/** Notes (Hz) and length for each effect: a rising pair for right, a low buzz for wrong. */
const TUNES: Record<Fx, { notes: number[]; ms: number; type: OscillatorType }> = {
  right: { notes: [660, 880], ms: 90, type: "sine" },
  wrong: { notes: [220, 180], ms: 140, type: "triangle" },
  combo: { notes: [660, 880, 1100], ms: 80, type: "sine" },
  win: { notes: [523, 659, 784, 1047], ms: 110, type: "sine" },
  flip: { notes: [420], ms: 40, type: "sine" },
};

export function play(fx: Fx) {
  if (!sound.on() || typeof window === "undefined") {
    return;
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return;
    }
    ctx ??= new Ctor();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const { notes, ms, type } = TUNES[fx];
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const start = t0 + (i * ms) / 1000;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + ms / 1000 + 0.02);
    });
  } catch {
    // Sound is a bonus; never let it break practice.
  }
}

/** A tiny buzz on phones that support it. */
export function buzz(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // No haptics here.
  }
}
