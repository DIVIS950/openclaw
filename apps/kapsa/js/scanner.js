// Camera and photo barcode reading. Uses the browser's BarcodeDetector where it
// exists (Android Chrome) and the bundled ZXing WebAssembly reader everywhere else (iPhone).

import { detectorFormats } from "./barcode.js";

/** @type {Promise<{ detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string, format: string }>> }> | null} */
let detectorPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.addEventListener("load", () => resolve(undefined));
    s.addEventListener("error", () => reject(new Error(`Could not load ${src}`)));
    document.head.append(s);
  });
}

async function createDetector() {
  const wanted = detectorFormats();
  const Native = globalThis.BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = wanted.filter((f) => supported.includes(f));
      // Only trust the native reader when it can read the common loyalty formats.
      if (formats.includes("ean_13") && formats.includes("code_128") && formats.includes("qr_code")) {
        return new Native({ formats });
      }
    } catch {
      // Fall through to the bundled reader.
    }
  }
  const base = new URL("../vendor/", import.meta.url);
  await loadScript(new URL("barcode-detector.js", base).href);
  const api = globalThis.BarcodeDetectionAPI;
  api.setZXingModuleOverrides({
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? new URL("zxing_reader.wasm", base).href : prefix + path),
  });
  const supported = await api.BarcodeDetector.getSupportedFormats();
  return new api.BarcodeDetector({ formats: wanted.filter((f) => supported.includes(f)) });
}

export function getDetector() {
  detectorPromise ??= createDetector().catch((err) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

/** Warm up the reader in the background so the first scan is instant. */
export function preloadDetector() {
  getDetector().catch(() => {});
}

/**
 * Read a barcode from a photo. Tries the full image, then a smaller copy and
 * rotated copies, because phone photos are large and often sideways.
 * @param {Blob} file
 * @returns {Promise<{ rawValue: string, format: string } | null>}
 */
export async function scanImageFile(file) {
  const detector = await getDetector();
  const bitmap = await createImageBitmap(file);
  try {
    const attempts = [
      { scale: 1, rotate: 0 },
      { scale: 0.5, rotate: 0 },
      { scale: 0.6, rotate: 90 },
      { scale: 0.35, rotate: 0 },
    ];
    for (const { scale, rotate } of attempts) {
      const maxSide = 2000;
      const s = Math.min(scale, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * s));
      const h = Math.max(1, Math.round(bitmap.height * s));
      const canvas = document.createElement("canvas");
      canvas.width = rotate ? h : w;
      canvas.height = rotate ? w : h;
      const ctx = canvas.getContext("2d");
      if (rotate) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotate * Math.PI) / 180);
        ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
      } else {
        ctx.drawImage(bitmap, 0, 0, w, h);
      }
      const found = await detector.detect(canvas);
      if (found.length) {
        return found[0];
      }
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Live camera scanner bound to a <video> element.
 * Calls `onCode` once with the first code it reads, then stops looking.
 */
export class CameraScanner {
  /**
   * @param {HTMLVideoElement} video
   * @param {(code: { rawValue: string, format: string }) => void} onCode
   */
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    /** @type {MediaStream | null} */
    this.stream = null;
    this.running = false;
    this.canvas = document.createElement("canvas");
    this.torchOn = false;
  }

  /** @returns {Promise<"ok" | "denied" | "unavailable">} */
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return "unavailable";
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (err) {
      const name = err && typeof err === "object" && "name" in err ? err.name : "";
      return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    try {
      await this.video.play();
    } catch {
      // Autoplay of a muted stream is allowed; ignore odd browsers.
    }
    this.running = true;
    this.loop();
    return "ok";
  }

  /** True when the camera can switch on its light (Android Chrome). */
  hasTorch() {
    const track = this.stream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.();
    return Boolean(caps && "torch" in caps && caps.torch);
  }

  async toggleTorch() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) {
      return false;
    }
    this.torchOn = !this.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: this.torchOn }] });
    } catch {
      this.torchOn = false;
    }
    return this.torchOn;
  }

  async loop() {
    let detector;
    try {
      detector = await getDetector();
    } catch {
      return;
    }
    let last = 0;
    const tick = async (now) => {
      if (!this.running) {
        return;
      }
      // ~8 reads per second is plenty and keeps phones cool.
      if (now - last > 120 && this.video.readyState >= 2) {
        last = now;
        try {
          const code = await this.detectFrame(detector);
          if (code && this.running) {
            this.running = false;
            this.onCode(code);
            return;
          }
        } catch {
          // A failed frame is normal while the camera focuses.
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async detectFrame(detector) {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) {
      return null;
    }
    // Read the middle of the frame (where the viewfinder is), at most 1280 px wide.
    const cropW = vw * 0.9;
    const cropH = vh * 0.7;
    const scale = Math.min(1, 1280 / cropW);
    this.canvas.width = Math.round(cropW * scale);
    this.canvas.height = Math.round(cropH * scale);
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(this.video, (vw - cropW) / 2, (vh - cropH) / 2, cropW, cropH, 0, 0, this.canvas.width, this.canvas.height);
    const found = await detector.detect(this.canvas);
    return found.find((f) => f.rawValue) ?? null;
  }

  stop() {
    this.running = false;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
  }
}
