import { effectiveCondition, effectiveCopy, effectivePrice, type Listing, type Settings } from "../../shared/types.ts";
import { photoUrl } from "./api.ts";

/** Where the Safari bot is installed from (served next to the web app). */
export const BOT_SCRIPT_URL = "https://divis950.github.io/openclaw/snapsell-vinted.user.js";

/** Photos go inside the link, so they're shrunk to a size Vinted still likes (1280px). */
async function photoForLink(src: string) {
  const bmp = await createImageBitmap(await (await fetch(src)).blob(), { imageOrientation: "from-image" });
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8).split(",")[1].replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Vinted's sell page with the whole listing packed after the # (which never leaves the phone).
 * The SnapSell bot in Safari reads it there, fills in the form and uploads.
 */
export async function vintedBotLink(l: Listing, s: Settings) {
  const a = l.analysis!;
  const copy = effectiveCopy(l, "vinted");
  const job = {
    title: copy.title,
    description: copy.description,
    price: Math.round(effectivePrice(l)),
    condition: effectiveCondition(l),
    category: a.item.category,
    brand: a.item.brand,
    size: a.item.size,
    autoPublish: true,
    photos: await Promise.all(l.photos.slice(0, 8).map((_, i) => photoForLink(photoUrl(l, i)))),
  };
  return `https://${s.vintedDomain}/items/new#snapsell=${encodeURIComponent(JSON.stringify(job))}`;
}
