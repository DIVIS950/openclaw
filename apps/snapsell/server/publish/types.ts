import type { Listing, Platform, PlatformStatus, PublishState, Settings } from "../../shared/types.ts";

export type PublishContext = {
  listing: Listing;
  settings: Settings;
  photoPaths: string[];
  /** Progress updates shown live in the app. */
  progress: (message: string) => void;
};

export type Publisher = {
  platform: Platform;
  status(settings: Settings): Promise<PlatformStatus>;
  connect?(settings: Settings): Promise<boolean>;
  disconnect?(): Promise<void>;
  publish(ctx: PublishContext): Promise<PublishState>;
};
