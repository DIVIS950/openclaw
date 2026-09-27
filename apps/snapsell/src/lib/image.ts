import type { PhotoPlan } from "../../shared/photoPlan.ts";
import type { Analysis } from "../../shared/types.ts";

export type Preset = "magic" | "auto" | "vivid" | "studio";

export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: "magic", label: "AI Magic", hint: "AI decides" },
  { id: "auto", label: "Auto", hint: "Fix light" },
  { id: "vivid", label: "Vivid", hint: "Rich color" },
  { id: "studio", label: "White", hint: "Clean backdrop" },
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

const toBlob = (c: HTMLCanvasElement, type = "image/jpeg", q = 0.92) =>
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
function tone(ctx: CanvasRenderingContext2D, w: number, h: number, vivid: boolean, plan?: PhotoPlan) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  whiteBalance(d);
  const hist = new Uint32Array(256);
  // Transparent pixels (around a cut-out) would read as black and skew the stats, so skip them.
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  const total = hist.reduce((a, b) => a + b, 0);
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) if ((acc += hist[i]) > total * 0.005) { lo = i; break; }
  for (let acc = 0, i = 255; i >= 0; i--) if ((acc += hist[i]) > total * 0.005) { hi = i; break; }
  // Stretch dark/flat shots, but cap the gain at ~2x so noise doesn't explode.
  lo = Math.min(lo, 30);
  hi = Math.max(hi, lo + 128);
  const range = Math.max(1, hi - lo);
  // The AI's plan nudges the automatic result; each value is kept moderate so the item stays true.
  const sat = (vivid ? 1.22 : 1.06) * (1 + (plan?.saturation ?? 0) * 0.25);
  const contrast = (vivid ? 1.08 : 1.03) * (1 + (plan?.contrast ?? 0) * 0.2);
  const lift = (vivid ? 4 : 6) + (plan?.exposure ?? 0) * 22; // most phone shots are underexposed indoors
  const shadows = plan?.shadows ?? 0;
  const highlights = plan?.highlights ?? 0;
  // Dark indoor shots: open up the shadows with a gamma curve (brightens mids, keeps white white).
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += hist[i] * ((i - lo) / range) * 255;
  const mean = sum / total;
  const gamma = mean < 110 ? Math.max(0.72, mean / 125) : 1;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i - lo) / range));
    let v = Math.pow(t, gamma);
    v += shadows * 0.18 * Math.pow(1 - v, 3) * v * 4; // lift dark tones, leave the rest
    v -= highlights * 0.12 * Math.pow(v, 4); // pull back near-white detail
    lut[i] = (v * 255 - 128) * contrast + 128 + lift;
  }
  // The curve moves brightness only; each pixel keeps its colour offsets, so a navy mug stays navy
  // instead of the stretch exaggerating whichever channel was darkest.
  const warm = (plan?.warmth ?? 0) * 10; // shifts red up / blue down (or back)
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const L = lut[l | 0];
    d[i] = L + (d[i] - l) * sat + warm;
    d[i + 1] = L + (d[i + 1] - l) * sat;
    d[i + 2] = L + (d[i + 2] - l) * sat - warm;
  }
  clarity(img, w, h, vivid ? 0.3 : 0.22);
  ctx.putImageData(sharpen(img, w, h, vivid ? 0.5 : 0.4), 0, 0);
}

/**
 * Removes colour casts (yellow bulbs, blue shade) with a damped grey-world estimate over the
 * mid-tones, so the item's real colour isn't pushed too far.
 */
function whiteBalance(d: Uint8ClampedArray) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 32) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (d[i + 3] < 128 || l < 40 || l > 235) continue;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  if (n < 100) return;
  const avg = (r + g + b) / 3;
  const gain = (c: number) => Math.min(1.1, Math.max(0.92, 1 + (avg / c - 1) * 0.35));
  const [gr, gg, gb] = [gain(r), gain(g), gain(b)];
  if (Math.abs(gr - 1) + Math.abs(gg - 1) + Math.abs(gb - 1) < 0.03) return;
  for (let i = 0; i < d.length; i += 4) {
    d[i] *= gr;
    d[i + 1] *= gg;
    d[i + 2] *= gb;
  }
}

/** Blur by down- and up-scaling: works everywhere (iPhone Safari ignores `ctx.filter`). */
function softBlur(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, factor = 24) {
  const small = canvas(Math.max(1, Math.round(sw / factor)), Math.max(1, Math.round(sh / factor)));
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, sx, sy, sw, sh, 0, 0, small.width, small.height);
  return small;
}

/**
 * Free cut-out for items shot on a plain surface: flood-fills the background from the photo's
 * edges (colours close to the border colour), then softens the mask edge. Returns null when the
 * background is too busy to separate, so the caller can fall back.
 */
function plainCutout(src: HTMLCanvasElement) {
  const W = 320;
  const scale = W / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const small = canvas(w, h);
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;

  // Background colour = median of the border pixels.
  // Border pixels in walking order (top, right, bottom, left), so neighbours in the list are neighbours in the photo.
  const border: number[][] = [];
  const at = (x: number, y: number) => border.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
  for (let x = 0; x < w; x++) at(x, 0);
  for (let y = 1; y < h; y++) at(w - 1, y);
  for (let x = w - 2; x >= 0; x--) at(x, h - 1);
  for (let y = h - 2; y > 0; y--) at(0, y);
  const med = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1]);
  const dist = (i: number) => Math.hypot(d[i] - med[0], d[i + 1] - med[1], d[i + 2] - med[2]);
  const nearBorder = border.filter((p) => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]) < 38).length / border.length;
  if (nearBorder < 0.8) return null; // edges aren't one plain colour
  // Texture check (wood grain, fabric, carpet): neighbouring border pixels must be nearly the same.
  let jumps = 0;
  for (let k = 1; k < border.length; k++) if (Math.hypot(border[k][0] - border[k - 1][0], border[k][1] - border[k - 1][1], border[k][2] - border[k - 1][2]) > 14) jumps++;
  if (jumps / border.length > 0.12) return null;

  // Flood fill from every border pixel; neighbours may drift a little from each other (soft shadows, gradients).
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (bg[p]) continue;
    const i = p * 4;
    if (dist(i) > 60) continue;
    bg[p] = 1;
    const x = p % w;
    const y = (p / w) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || bg[q]) continue;
      const j = q * 4;
      if (Math.hypot(d[j] - d[i], d[j + 1] - d[i + 1], d[j + 2] - d[i + 2]) < 22) stack.push(q);
    }
  }
  const share = bg.reduce((a, b) => a + b, 0) / (w * h);
  if (share < 0.2 || share > 0.93) return null; // found almost nothing, or swallowed the item
  // Item too close in colour to the background (dark item on a dark table): the fill leaks into it
  // and leaves a broken cut-out, so don't use it.
  let fg = 0;
  let lookalike = 0;
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) continue;
    fg++;
    if (dist(p * 4) < 60) lookalike++;
  }
  if (lookalike / Math.max(1, fg) > 0.25) return null;

  // Mask canvas (item = opaque), scaled up with smoothing and a light blur for soft edges.
  const mask = canvas(w, h);
  const mctx = mask.getContext("2d")!;
  const md = mctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) md.data[p * 4 + 3] = bg[p] ? 0 : 255;
  mctx.putImageData(md, 0, 0);
  const out = canvas(src.width, src.height);
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(mask, 0, 0, out.width, out.height);
  octx.globalCompositeOperation = "source-in";
  octx.drawImage(src, 0, 0);
  return out;
}

/**
 * Local contrast ("clarity"): brightness is compared with a very blurred copy and the difference
 * boosted, which gives texture and depth without making the whole photo harsher.
 */
function clarity(img: ImageData, w: number, h: number, amount: number) {
  const src = canvas(w, h);
  src.getContext("2d")!.putImageData(img, 0, 0);
  const small = softBlur(src, 0, 0, w, h, 32);
  const big = canvas(w, h);
  const bctx = big.getContext("2d", { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(small, 0, 0, w, h);
  const b = bctx.getImageData(0, 0, w, h).data;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const bl = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
    // Strongest in the mid-tones, gentle near black and white so nothing clips.
    const k = amount * (1 - Math.abs(l - 128) / 128) * (l - bl) * 0.9;
    d[i] += k;
    d[i + 1] += k;
    d[i + 2] += k;
  }
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

/** Rotates a photo to straighten it; the corners the rotation reveals are cropped off. */
function straighten(bmp: ImageBitmap, deg: number): CanvasImageSource & { width: number; height: number } {
  if (Math.abs(deg) < 0.4) return bmp;
  const a = (deg * Math.PI) / 180;
  const c = canvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d")!;
  // Zoom just enough that the rotated photo still covers the whole frame.
  const zoom = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)) * Math.max(bmp.width / bmp.height, bmp.height / bmp.width);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(a);
  ctx.scale(zoom, zoom);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return c;
}

/**
 * Produces a square, marketplace-ready photo. With preset "magic" the AI's plan decides the
 * straightening, crop, light, colour and whether to use the white backdrop.
 */
export async function enhancePhoto(
  src: string,
  preset: Preset,
  crop?: Crop,
  plan?: PhotoPlan,
  /** Already-loaded (and straightened) photo, when called again for the white backdrop. */
  loaded?: CanvasImageSource & { width: number; height: number },
): Promise<Blob> {
  const magic = preset === "magic" && plan;
  const bmp = loaded ?? (magic ? straighten(await bitmap(src), plan.rotate) : await bitmap(src));
  if (magic) {
    crop = { ...plan.crop, photo: 0 } as Crop;
    if (plan.background === "white") {
      // The AI wants a white backdrop; if the cut-out can't separate the item here, keep the background.
      try {
        return await enhancePhoto(src, "studio", crop, { ...plan, rotate: 0 }, bmp);
      } catch {
        // fall through to the edited photo with its own background
      }
    }
    preset = "auto";
  }
  const r = cropRect(bmp.width, bmp.height, crop);
  const c = canvas(OUT, OUT);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const scale = Math.min(OUT / r.w, OUT / r.h);
  const dw = r.w * scale;
  const dh = r.h * scale;
  const dx = (OUT - dw) / 2;
  const dy = (OUT - dh) / 2;

  if (preset === "studio") {
    const piece = canvas(Math.round(r.w), Math.round(r.h));
    piece.getContext("2d")!.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, piece.width, piece.height);
    let cut: CanvasImageSource;
    try {
      bgRemoval ??= import("@imgly/background-removal");
      const { removeBackground } = await bgRemoval;
      cut = await bitmap(await removeBackground(await toBlob(piece, "image/png")));
    } catch (e) {
      // The AI model can't load here (e.g. the Claude page): use the free plain-background cut-out.
      const plain = plainCutout(piece);
      if (!plain) throw new Error("The background is too busy for the white cut-out here. Try Auto, or take the photo on a plain surface.", { cause: e });
      cut = plain;
    }
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
    // Studio shadow in two layers: a wide soft one (ambient light) and a tight dark one where the item
    // touches the floor. Radial gradients, so it looks the same on Safari (no canvas blur there).
    const shadow = (spread: number, squash: number, alpha: number) => {
      ctx.save();
      ctx.translate(OUT / 2, y + h * 0.985);
      ctx.scale(1, squash);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * spread);
      g.addColorStop(0, `rgba(0,0,0,${alpha})`);
      g.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.35})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-w, -w, w * 2, w * 2);
      ctx.restore();
    };
    shadow(0.62, 0.16, 0.12);
    shadow(0.36, 0.07, 0.3);
    const layer = canvas(OUT, OUT);
    const lctx = layer.getContext("2d", { willReadFrequently: true })!;
    lctx.drawImage(cut, x, y, w, h);
    tone(lctx, OUT, OUT, false, plan);
    ctx.drawImage(layer, 0, 0);
    return toBlob(c);
  }

  // Blurred, darkened copy of the photo fills the square so nothing looks letterboxed.
  if (dw < OUT || dh < OUT) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(softBlur(bmp, r.x, r.y, r.w, r.h), -80, -80, OUT + 160, OUT + 160);
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(0, 0, OUT, OUT);
  }
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
  tone(ctx, OUT, OUT, preset === "vivid", magic ? plan : undefined);
  return toBlob(c);
}
