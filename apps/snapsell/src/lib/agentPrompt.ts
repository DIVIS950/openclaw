import { effectiveSize } from "../../shared/pricing.ts";
import {
  CONDITION_LABEL,
  PLATFORM_META,
  effectiveCondition,
  effectiveCopy,
  effectivePrice,
  type Listing,
  type Platform,
  type Settings,
} from "../../shared/types.ts";

/** File names the photos get when saved, so the agent (or you) can find them. */
export function photoFileNames(l: Listing) {
  return l.photos.map((_, i) => `snapsell-${l.id}-${i + 1}.jpg`);
}

export function sellPageUrl(p: Platform, s: Settings) {
  return p === "vinted" ? `https://${s.vintedDomain}/items/new` : PLATFORM_META[p].sellUrl;
}

/**
 * The instruction a browser agent (Claude in Chrome) needs to post one listing on one site,
 * in the user's own logged-in browser. It stops before the final publish click.
 */
export function agentInstruction(l: Listing, p: Platform, s: Settings) {
  const a = l.analysis!;
  const copy = effectiveCopy(l, p);
  const site = p === "ebay" ? "eBay" : PLATFORM_META[p].name;
  const files = photoFileNames(l);
  const details = [
    a.item.brand && `Brand: ${a.item.brand}`,
    a.item.model && `Model: ${a.item.model}`,
    effectiveSize(l) && `Size: ${effectiveSize(l)}`,
    a.item.color && `Color: ${a.item.color}`,
  ].filter(Boolean);

  return `Please create a listing for me on ${site}. I'm already logged in in this browser.

1. Open ${sellPageUrl(p, s)}
2. Photos: upload these ${files.length} photo(s) from my Downloads folder: ${files.join(", ")}. If you can't upload files, leave the photos for me and continue.
3. Fill in the form exactly with:
Title: ${copy.title}
Price: ${Math.round(effectivePrice(l))} ${s.currency}
Condition: ${CONDITION_LABEL[effectiveCondition(l)]} (pick the closest option on the site)
Category: ${a.item.category} (pick the closest matching category)
${details.length ? `${details.join("\n")}\n` : ""}Description:
${copy.description}

4. If the site asks for something not listed here (size, parcel size, shipping), choose the most sensible option and tell me what you picked.
5. Do NOT press the final Publish / Upload / Post button. Stop there and tell me it's ready so I can check it and publish it myself.`;
}
