import type { Analysis } from "../../shared/types.ts";

export type Preset = "auto" | "vivid" | "studio";

export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Balanced light & color" },
  { id: "vivid", label: "Vivid", hint: "Punchy, eye-catching" },
  { id: "studio", label: "Studio", hint: "AI cut-out on white" },
];

const OUT = 1600;

async function bitmap(src: Blob | string) {
  const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const toBlob = (c: HTMLCanvasElement, type = "image/jpeg", q = 0.9) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));

/** Downscale camera photos before upload (keeps requests small and fast). */
export async function prepareForUpload(file: Blob, max = 1600) {
  const bmp = await bitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = canvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return toBlob(c, "image/jpeg", 0.88);
}

/**
 * Auto-levels + saturation + mild sharpen, done with plain pixel math so it works the same
 * on every browser (Safari has no canvas filter support).
 */
function tone(ctx: CanvasRenderingContext2D, w: number, h: number, vivid: boolean) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  const total = hist.reduce((a, b) => a + b, 0);
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) if ((acc += hist[i]) > total * 0.005) { lo = i; break; }
  for (let acc = 0, i = 255; i >= 0; i--) if ((acc += hist[i]) > total * 0.005) { hi = i; break; }
  // Stretch dark/flat shots, but cap the gain at ~2x so noise doesn't explode.
  lo = Math.min(lo, 60);
  hi = Math.max(hi, lo + 128);
  const range = Math.max(1, hi - lo);
  const sat = vivid ? 1.3 : 1.12;
  const contrast = vivid ? 1.08 : 1.03;
  const lift = vivid ? 4 : 6; // tiny brightness lift, most phone shots are underexposed indoors
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = ((i - lo) / range) * 255;
    lut[i] = (v - 128) * contrast + 128 + lift;
  }
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]];
    const g = lut[d[i + 1]];
    const b = lut[d[i + 2]];
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    d[i] = l + (r - l) * sat;
    d[i + 1] = l + (g - l) * sat;
    d[i + 2] = l + (b - l) * sat;
  }
  ctx.putImageData(sharpen(img, w, h, vivid ? 0.5 : 0.35), 0, 0);
}

function sharpen(img: ImageData, w: number, h: number, amount: number) {
  const src = img.data;
  const out = new ImageData(new Uint8ClampedArray(src), w, h);
  const o = out.data;
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (src[i - 4 + c] + src[i + 4 + c] + src[i - row + c] + src[i + row + c]) / 4;
        o[i + c] = src[i + c] + (src[i + c] - blur) * amount;
      }
    }
  }
  return out;
}

type Crop = Analysis["crops"][number];

/** Crop rect around the item with breathing room, clamped to the image. */
function cropRect(bw: number, bh: number, crop?: Crop) {
  if (!crop || crop.w <= 0 || crop.h <= 0) return { x: 0, y: 0, w: bw, h: bh };
  const pad = 0.12;
  const cx = (crop.x + crop.w / 2) * bw;
  const cy = (crop.y + crop.h / 2) * bh;
  let size = Math.max(crop.w * bw, crop.h * bh) * (1 + pad * 2);
  size = Math.min(size, Math.max(bw, bh));
  const w = Math.min(size, bw);
  const h = Math.min(size, bh);
  const x = Math.min(Math.max(0, cx - w / 2), bw - w);
  const y = Math.min(Math.max(0, cy - h / 2), bh - h);
  return { x, y, w, h };
}

let bgRemoval: Promise<typeof import("@imgly/background-removal")> | null = null;

/** Produces a square, marketplace-ready photo. */
export async function enhancePhoto(src: string, preset: Preset, crop?: Crop): Promise<Blob> {
  const bmp = await bitmap(src);
  const r = cropRect(bmp.width, bmp.height, crop);
  const c = canvas(OUT, OUT);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const scale = Math.min(OUT / r.w, OUT / r.h);
  const dw = r.w * scale;
  const dh = r.h * scale;
  const dx = (OUT - dw) / 2;
  const dy = (OUT - dh) / 2;

  if (preset === "studio") {
    bgRemoval ??= import("@imgly/background-removal");
    const { removeBackground } = await bgRemoval;
    const piece = canvas(Math.round(r.w), Math.round(r.h));
    piece.getContext("2d")!.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, piece.width, piece.height);
    const cut = await bitmap(await removeBackground(await toBlob(piece, "image/png")));
    // Soft studio backdrop + contact shadow.
    const grad = ctx.createRadialGradient(OUT / 2, OUT * 0.45, OUT * 0.1, OUT / 2, OUT / 2, OUT * 0.75);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#eeeef2");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, OUT, OUT);
    const s = 0.86;
    const w = dw * s;
    const h = dh * s;
    const x = (OUT - w) / 2;
    const y = (OUT - h) / 2;
    ctx.save();
    ctx.filter = "blur(24px)";
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(OUT / 2, y + h * 0.98, w * 0.38, h * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const layer = canvas(OUT, OUT);
    const lctx = layer.getContext("2d", { willReadFrequently: true })!;
    lctx.drawImage(cut, x, y, w, h);
    tone(lctx, OUT, OUT, false);
    ctx.drawImage(layer, 0, 0);
    return toBlob(c);
  }

  // Blurred, darkened copy of the photo fills the square so nothing looks letterboxed.
  if (dw < OUT || dh < OUT) {
    ctx.save();
    ctx.filter = "blur(40px) brightness(0.9)";
    ctx.drawImage(bmp, r.x, r.y, r.w, r.h, -80, -80, OUT + 160, OUT + 160);
    ctx.restore();
  }
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
  tone(ctx, OUT, OUT, preset === "vivid");
  return toBlob(c);
}
