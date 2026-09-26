import type { ImageInput } from "../../shared/api.ts";

// Phone photos are huge. Shrink them before sending: the AI reads text fine at
// this size, and uploads stay fast on mobile data.
const MAX_SIDE = 1568;

export async function photoToImageInput(file: File): Promise<ImageInput> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Couldn't read that photo.");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export function imageSrc(image: ImageInput): string {
  return `data:${image.mediaType};base64,${image.data}`;
}
