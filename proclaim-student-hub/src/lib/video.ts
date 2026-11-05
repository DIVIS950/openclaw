import type { ImageInput } from "../../shared/api.ts";

// Turns a screen recording (the student scrolling through Classroom) into a
// handful of distinct stills the AI can read. Frames that barely changed from
// the last kept one are skipped, so pausing on a screen doesn't cost extra.

const MAX_SIDE = 1568;
const SAMPLE_EVERY_S = 1;
const MAX_FRAMES = 16;
/** Average per-channel change (0-255) below which two frames count as the same screen. */
const SAME_SCREEN = 3;

/** Mean absolute difference between two same-size grayscale thumbnails. */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) {
    return 255;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

/** Indexes of the frames worth keeping: the first, then each that differs enough from the last kept. */
export function distinctFrames(thumbs: Uint8ClampedArray[], threshold = SAME_SCREEN): number[] {
  const kept: number[] = [];
  for (let i = 0; i < thumbs.length; i++) {
    const last = kept[kept.length - 1];
    if (last === undefined || frameDifference(thumbs[last], thumbs[i]) >= threshold) {
      kept.push(i);
    }
  }
  return kept;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      // "seeked" can fire before the new frame is ready to draw; wait for it
      // (with a short fallback for browsers without frame callbacks).
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      v.requestVideoFrameCallback?.(finish);
      setTimeout(finish, 250);
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      reject(new Error("Couldn't read that video. Try a screenshot instead."));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = time;
  });
}

// Big enough that rows of text moving on a white page still register, and in
// colour so two screens of equal brightness don't look the same.
const THUMB_W = 48;
const THUMB_H = 96;

function thumbnail(source: HTMLCanvasElement): Uint8ClampedArray {
  const small = document.createElement("canvas");
  small.width = THUMB_W;
  small.height = THUMB_H;
  const ctx = small.getContext("2d");
  if (!ctx) {
    return new Uint8ClampedArray();
  }
  ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
  const rgba = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
  const rgb = new Uint8ClampedArray(THUMB_W * THUMB_H * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i];
    rgb[j++] = rgba[i + 1];
    rgb[j++] = rgba[i + 2];
  }
  return rgb;
}

export async function videoToFrames(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageInput[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("This video type can't be read here. Try a screenshot instead.")),
        { once: true },
      );
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const step = Math.max(SAMPLE_EVERY_S, duration / 60);
    const times: number[] = [];
    for (let t = 0.2; t < duration; t += step) {
      times.push(t);
    }
    if (times.length === 0) {
      times.push(0);
    }

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Couldn't read that video.");
    }

    const frames: string[] = [];
    const thumbs: Uint8ClampedArray[] = [];
    for (let i = 0; i < times.length; i++) {
      await seek(video, times[i]);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbs.push(thumbnail(canvas));
      frames.push(canvas.toDataURL("image/jpeg", 0.8));
      onProgress?.(i + 1, times.length);
    }
    return distinctFrames(thumbs)
      .slice(0, MAX_FRAMES)
      .map((i) => ({
        mediaType: "image/jpeg" as const,
        data: frames[i].slice(frames[i].indexOf(",") + 1),
      }));
  } finally {
    URL.revokeObjectURL(url);
  }
}
