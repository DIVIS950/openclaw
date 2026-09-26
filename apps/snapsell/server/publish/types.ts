import type { Listing, Platform, PlatformStatus, PublishState, Settings } from "../../shared/types.ts";
import type { User } from "../store.ts";

export type PublishContext = {
  user: User;
  listing: Listing;
  settings: Settings;
  /** Photo file names (enhanced where available) under the listing's upload folder */
  photoNames: string[];
  /** Progress updates shown live in the app. */
  progress: (message: string) => void;
};

export type Publisher = {
  platform: Platform;
  status(user: User): Promise<PlatformStatus>;
  publish(ctx: PublishContext): Promise<PublishState>;
};
