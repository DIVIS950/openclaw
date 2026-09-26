import { z } from "zod";

export const PLATFORMS = ["ebay", "facebook", "vinted"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_META: Record<Platform, { name: string; color: string; sellUrl: string }> = {
  ebay: { name: "eBay", color: "#3665f3", sellUrl: "https://www.ebay.com/sl/sell" },
  facebook: {
    name: "Facebook Marketplace",
    color: "#0866ff",
    sellUrl: "https://www.facebook.com/marketplace/create/item",
  },
  vinted: { name: "Vinted", color: "#007f86", sellUrl: "https://www.vinted.com/items/new" },
};

export const CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABEL: Record<Condition, string> = {
  new: "New with tags",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "For parts / poor",
};

const platformCopy = z.object({
  title: z.string().describe("Title tuned for this platform's search and length limits"),
  description: z.string().describe("Full listing description tuned for this platform"),
});

// Structured output schema for the AI analysis. Kept free of min/max constraints so it
// maps cleanly onto structured-output JSON schema.
export const AnalysisSchema = z.object({
  item: z.object({
    name: z.string().describe("Specific product name, e.g. 'Nike Air Max 90 Infrared'"),
    brand: z.string().nullable(),
    model: z.string().nullable(),
    category: z.string().describe("Broad category, e.g. 'Sneakers', 'Smartphones', 'Furniture'"),
    color: z.string().nullable(),
    material: z.string().nullable(),
    size: z.string().nullable(),
    era: z.string().nullable().describe("Year, generation or era if identifiable"),
  }),
  confidence: z.number().describe("0-1 confidence in the identification"),
  identificationNotes: z.string().describe("Short note on how it was identified or what is uncertain"),
  condition: z.enum(CONDITIONS),
  conditionNotes: z.string().describe("Visible wear, defects or highlights, honestly stated"),
  price: z.object({
    currency: z.string().describe("ISO 4217 code"),
    low: z.number(),
    high: z.number(),
    suggested: z.number().describe("Recommended list price"),
    quickSale: z.number().describe("Price that should sell within a few days"),
    demand: z.enum(["low", "medium", "high"]),
    reasoning: z.string().describe("2-3 sentences on how the price was derived from the market"),
  }),
  comparables: z
    .array(
      z.object({
        title: z.string(),
        price: z.number(),
        currency: z.string(),
        source: z.string().describe("Site name, e.g. 'eBay sold', 'Vinted'"),
        url: z.string().nullable(),
        sold: z.boolean(),
      }),
    )
    .describe("Real listings found during market research, up to 6"),
  title: z.string().describe("Best general title, max 80 characters"),
  description: z.string().describe("General listing description"),
  platforms: z.object({ ebay: platformCopy, facebook: platformCopy, vinted: platformCopy }),
  tags: z.array(z.string()).describe("Search keywords / hashtags"),
  attributes: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe("Item specifics like Brand, Model, Size, Color, Storage"),
  crops: z
    .array(
      z.object({
        photo: z.number().describe("0-based photo index"),
        x: z.number().describe("Left edge of the item, 0-1 of image width"),
        y: z.number().describe("Top edge of the item, 0-1 of image height"),
        w: z.number().describe("Width of the item, 0-1"),
        h: z.number().describe("Height of the item, 0-1"),
      }),
    )
    .describe("Tight bounding box around the item for every photo"),
  photoTips: z.array(z.string()).describe("Up to 3 tips for better photos, empty if photos are great"),
  shipping: z.object({
    weightKg: z.number(),
    packageSize: z.enum(["small", "medium", "large"]),
  }),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export type PublishState = {
  /** queued = waiting for the Chrome extension to pick it up */
  status: "idle" | "queued" | "working" | "needs_review" | "live" | "error";
  message?: string;
  url?: string;
  updatedAt?: string;
};

export type Listing = {
  id: string;
  /** Email of the account that owns it */
  owner: string;
  createdAt: string;
  soldAt?: string;
  updatedAt: string;
  status: "analyzing" | "draft" | "live" | "sold" | "failed";
  note?: string;
  /** File names under data/uploads/<id>/ */
  photos: string[];
  /** Enhanced versions (same order as photos) once the studio has produced them */
  enhanced: string[];
  analysis?: Analysis;
  /** User edits layered on top of the AI analysis */
  edits: {
    title?: string;
    price?: number;
    condition?: Condition;
    platforms?: Partial<Record<Platform, { title?: string; description?: string }>>;
  };
  publish: Partial<Record<Platform, PublishState>>;
  error?: string;
};

export type Settings = {
  country: string;
  currency: string;
  language: string;
  vintedDomain: string;
  /** When false, automation fills forms and leaves the final Publish click to you. */
  autoPublish: boolean;
  onboarded: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  country: "United States",
  currency: "USD",
  language: "English",
  vintedDomain: "www.vinted.com",
  autoPublish: false,
  onboarded: false,
};

export type PlatformStatus = {
  platform: Platform;
  connected: boolean;
  /** api = official API (eBay), extension = posted by the SnapSell Chrome extension */
  mode: "api" | "extension";
  detail: string;
  /** What the user can do next: log in with eBay, finish eBay setup, or log in to the site in Chrome */
  action?: "ebay_login" | "ebay_setup" | "chrome_login" | "install_extension";
  /** Only when the server has no eBay developer keys at all */
  unavailable?: boolean;
};

export type Me = {
  email: string;
  name: string;
  picture?: string;
  /** false when Google login isn't configured (local-only mode) */
  authEnabled: boolean;
};

export type ExtensionStatus = {
  online: boolean;
  lastSeen?: string;
  sites: Partial<Record<"facebook" | "vinted", boolean>>;
};

/** A posting job handed to the Chrome extension. */
export type ExtJob = {
  listingId: string;
  platform: "facebook" | "vinted";
  title: string;
  description: string;
  price: number;
  currency: string;
  condition: Condition;
  category: string;
  brand: string | null;
  size: string | null;
  photos: string[];
  autoPublish: boolean;
  vintedDomain: string;
};

/** Events streamed to the client while a listing is being analyzed. */
export type AnalyzeEvent =
  | { type: "stage"; stage: "looking" | "lens" | "searching" | "pricing" | "writing" | "done" }
  | { type: "search"; query: string }
  | { type: "lens"; matches: number; bestGuess?: string }
  | { type: "price"; value: number; currency: string; source: string }
  | { type: "source"; title: string; url: string }
  | { type: "listing"; listing: Listing }
  | { type: "error"; message: string };

export const CONDITION_SHORT: Record<Condition, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export function effectiveCopy(listing: Listing, platform: Platform) {
  const base = listing.analysis?.platforms[platform];
  const edit = listing.edits.platforms?.[platform];
  return {
    title: edit?.title ?? base?.title ?? listing.edits.title ?? listing.analysis?.title ?? "",
    description: edit?.description ?? base?.description ?? listing.analysis?.description ?? "",
  };
}

export function effectivePrice(listing: Listing) {
  return listing.edits.price ?? listing.analysis?.price.suggested ?? 0;
}

export function effectiveCondition(listing: Listing): Condition {
  return listing.edits.condition ?? listing.analysis?.condition ?? "good";
}
