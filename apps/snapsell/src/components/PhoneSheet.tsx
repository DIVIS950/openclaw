import { Check, Copy, ExternalLink, Images, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PLATFORM_META, effectiveCopy, effectivePrice, type Listing, type Platform } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { photoFileNames, sellPageUrl } from "../lib/agentPrompt.ts";
import { copyText, formatPrice, photoUrl } from "../lib/api.ts";
import { savePhotos } from "../lib/saveFile.ts";
import { Button, Sheet, cx } from "./ui.tsx";

type Photo = { name: string; blob: Blob };

/** Loads a listing's (enhanced) photos as files, ready to save the moment the user taps. */
export function usePhotoFiles(listing: Listing, active: boolean) {
  const [files, setFiles] = useState<Photo[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const names = photoFileNames(listing);
    Promise.all(listing.photos.map((_, i) => fetch(photoUrl(listing, i)).then((r) => r.blob())))
      .then((blobs) => live && setFiles(blobs.map((blob, i) => ({ name: names[i], blob }))))
      .catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [listing, active]);
  return files;
}

/**
 * Posting from the phone, for sites with no way for apps to post: save the photos to Photos,
 * copy the text, open the site (its app opens if installed), then pick the photos and paste.
 */
export function PhoneSheet({ platform, listing, onClose }: { platform: Platform | null; listing: Listing; onClose: () => void }) {
  const { settings } = useApp();
  const files = usePhotoFiles(listing, !!platform);
  const [saved, setSaved] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setSaved("idle");
    setCopied(false);
    setText(null);
  }, [platform]);

  if (!platform) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const meta = PLATFORM_META[platform];
  const site = platform === "ebay" ? "eBay" : meta.name.split(" ")[0];
  const copy = effectiveCopy(listing, platform);
  const all = `${copy.title}\n\n${formatPrice(effectivePrice(listing), listing.analysis!.price.currency)}\n\n${copy.description}`;

  // No await before savePhotos: iPhone Safari only opens the share sheet straight after a tap.
  const save = () => {
    if (!files?.length) return;
    setSaved("busy");
    void savePhotos(files).then((ok) => setSaved(ok ? "done" : "failed"));
  };

  const doCopy = async () => {
    if (await copyText(all)) {
      setCopied(true);
      setText(null);
    } else setText(all); // clipboard blocked: show it to copy by hand
  };

  const step = (n: number, done: boolean, title: string, children: ReactNode) => (
    <div className={cx("rounded-[20px] border bg-card p-3.5", done ? "border-ok" : "border-line")}>
      <div className="flex items-center gap-3">
        <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white", done ? "bg-ok" : "bg-ink")}>
          {done ? <Check className="size-4" /> : n}
        </span>
        <span className="flex-1 font-bold">{title}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );

  return (
    <Sheet open onClose={onClose} title={`Post on ${site}`} subtitle="Three taps, then paste in the app">
      <div className="space-y-2.5">
        {step(
          1,
          saved === "done",
          "Save the photos",
          <>
            <Button variant="soft" className="w-full" onClick={save} disabled={!files?.length || saved === "busy"}>
              {!files || saved === "busy" ? <Loader2 className="size-4 animate-spin" /> : <Images className="size-4" />}
              {saved === "done" ? "Saved. Save again?" : `Save ${listing.photos.length} photo${listing.photos.length > 1 ? "s" : ""}`}
            </Button>
            <p className="mt-2 text-[12px] text-muted">
              {saved === "failed" ? "Not saved. Try again, or screenshot the photos." : "On iPhone pick “Save Images” so they go to Photos."}
            </p>
          </>,
        )}
        {step(
          2,
          copied,
          "Copy the text",
          <>
            <Button variant="soft" className="w-full" onClick={doCopy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy title, price and description"}
            </Button>
            {text && (
              <textarea
                readOnly
                value={text}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 h-40 w-full resize-none rounded-2xl border border-line bg-paper p-3 text-[13px]"
              />
            )}
          </>,
        )}
        {step(
          3,
          false,
          `Open ${site} and paste`,
          <>
            <a
              href={sellPageUrl(platform, settings)}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent font-bold text-white"
            >
              <ExternalLink className="size-4" />
              Open {site}
            </a>
            <p className="mt-2 text-[12px] text-muted">
              Add the photos from your Photos, paste the text, check the price and press Publish.
            </p>
          </>,
        )}
      </div>
    </Sheet>
  );
}
