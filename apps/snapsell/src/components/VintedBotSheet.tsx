import { Bot, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import bookmarklet from "virtual:vinted-bookmarklet";
import { copyText } from "../lib/api.ts";
import { celebrate } from "../lib/celebrate.ts";
import { BOT_SCRIPT_URL, vintedBotLink } from "../lib/vintedBot.ts";
import { Sheet, cx } from "./ui.tsx";

// Userscripts app: the bot starts by itself on Vinted.
const SETUP_APP = [
  <>
    Install the free{" "}
    <a className="font-bold underline" href="https://apps.apple.com/app/id1463298887" target="_blank" rel="noreferrer">
      Userscripts
    </a>{" "}
    app, open it once and tap <b>Set Userscripts Directory</b>.
  </>,
  <>
    <b>Settings → Apps → Safari → Extensions → Userscripts</b>: turn it on for all websites.
  </>,
  <>
    Open{" "}
    <a className="font-bold underline" href={BOT_SCRIPT_URL} target="_blank" rel="noreferrer">
      the SnapSell bot
    </a>{" "}
    in Safari, tap <b>aA → Userscripts → Install</b>.
  </>,
];

/** One tap: opens Vinted with the listing packed into the link; the Safari bot fills it in and uploads. */
export function VintedBotSheet({ open, listing, onClose }: { open: boolean; listing: Listing; onClose: () => void }) {
  const { settings } = useApp();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<"bookmark" | "app" | null>(null);
  const [copied, setCopied] = useState(false);

  // Built when the sheet opens, so the tap itself opens Vinted straight away (iPhone blocks late pop-ups).
  useEffect(() => {
    if (!open) return;
    setLink(null);
    setError(null);
    let live = true;
    vintedBotLink(listing, settings)
      .then((l) => live && setLink(l))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [open, listing, settings]);

  return (
    <Sheet open={open} onClose={onClose} title="Post on Vinted" subtitle="The SnapSell bot fills it in and uploads it for you">
      <a
        href={link ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!link}
        onClick={() => celebrate(60)}
        className={cx(
          "flex h-14 w-full items-center justify-center gap-2 rounded-[18px] text-[17px] font-bold",
          link ? "shine bg-accent text-ink shadow-[0_14px_30px_-12px_rgba(194,65,12,0.65)]" : "pointer-events-none bg-soft text-muted",
        )}
      >
        {link ? <Bot className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
        {link ? "Post on Vinted now" : "Getting photos ready…"}
      </a>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <p className="mt-2 text-[13px] text-muted">
        Vinted opens in Safari and a bar at the top shows what the bot is doing (with the bookmark: tap it first). If Vinted needs something extra, like a size, the bot stops and
        tells you.
      </p>

      <p className="mt-4 text-[13px] font-semibold text-muted">First time on this iPhone? Pick one (once):</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(
          [
            ["bookmark", "Bookmark", "Nothing to install"],
            ["app", "Userscripts app", "Starts by itself"],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            onClick={() => setSetup((v) => (v === id ? null : id))}
            aria-expanded={setup === id}
            className={cx("rounded-2xl bg-card px-3 py-2.5 text-left", setup === id ? "border-2 border-ink" : "border-[1.5px] border-line")}
          >
            <span className="flex items-center justify-between text-[15px] font-semibold">
              {label}
              <ChevronDown className={cx("size-4 text-muted transition-transform", setup === id && "rotate-180")} />
            </span>
            <span className="block text-[12px] text-muted">{hint}</span>
          </button>
        ))}
      </div>

      {setup === "bookmark" && (
        <ol className="mt-2 space-y-2">
          <Step n={1}>
            <button
              onClick={async () => setCopied(await copyText(bookmarklet))}
              className="rounded-full bg-accent px-3.5 py-1.5 text-[14px] font-bold text-ink"
            >
              {copied ? "Copied" : "Copy the bot"}
            </button>
          </Step>
          <Step n={2}>
            In Safari tap <b>Share → Add Bookmark</b>, name it <b>SnapSell</b>, <b>Save</b>.
          </Step>
          <Step n={3}>
            Tap the <b>book icon → Edit</b>, tap <b>SnapSell</b>, delete its address, <b>paste</b>, then <b>Done</b>.
          </Step>
          <Step n={4}>
            From now on: tap <b>Post on Vinted now</b>, and on Vinted tap the <b>book icon → SnapSell</b>.
          </Step>
        </ol>
      )}
      {setup === "app" && (
        <ol className="mt-2 space-y-2">
          {SETUP_APP.map((t, i) => (
            <Step key={i} n={i + 1}>
              {t}
            </Step>
          ))}
        </ol>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <ExternalLink className="size-3.5" />
        Log in to Vinted in Safari once. The bot only works on Vinted, in your Safari.
      </p>
    </Sheet>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-[14px]">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">{n}</span>
      <span>{children}</span>
    </li>
  );
}
