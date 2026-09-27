import { Bot, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { BOT_SCRIPT_URL, vintedBotLink } from "../lib/vintedBot.ts";
import { Sheet, cx } from "./ui.tsx";

const SETUP = [
  <>
    Install the free{" "}
    <a className="font-bold underline" href="https://apps.apple.com/app/id1463298887" target="_blank" rel="noreferrer">
      Userscripts
    </a>{" "}
    app. Open it once and tap <b>Set Userscripts Directory</b>, then pick any folder.
  </>,
  <>
    iPhone <b>Settings → Apps → Safari → Extensions → Userscripts</b>: turn it on and allow it on all websites.
  </>,
  <>
    In Safari open{" "}
    <a className="font-bold underline" href={BOT_SCRIPT_URL} target="_blank" rel="noreferrer">
      the SnapSell bot
    </a>
    , tap the <b>aA</b> or puzzle button in the address bar, then <b>Userscripts → Install</b>.
  </>,
  <>
    Log in to <b>Vinted in Safari</b> once (Continue with Google works).
  </>,
];

/** One tap: opens Vinted with the listing packed into the link; the Safari bot fills it in and uploads. */
export function VintedBotSheet({ open, listing, onClose }: { open: boolean; listing: Listing; onClose: () => void }) {
  const { settings } = useApp();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);

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
        className={cx(
          "flex h-14 w-full items-center justify-center gap-2 rounded-full text-[17px] font-bold",
          link ? "bg-accent text-ink" : "pointer-events-none bg-soft text-muted",
        )}
      >
        {link ? <Bot className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
        {link ? "Post on Vinted now" : "Getting photos ready…"}
      </a>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <p className="mt-2 text-[13px] text-muted">
        Vinted opens in Safari and a black bar at the top shows what the bot is doing. If Vinted needs something extra, like a size, the bot stops and
        tells you.
      </p>

      <button
        onClick={() => setSetup((v) => !v)}
        className="mt-4 flex w-full items-center gap-2 rounded-2xl bg-soft px-3.5 py-3 text-left text-[15px] font-bold"
        aria-expanded={setup}
      >
        <span className="flex-1">First time on this iPhone? Set up the bot (3 min)</span>
        <ChevronDown className={cx("size-5 transition-transform", setup && "rotate-180")} />
      </button>
      {setup && (
        <ol className="mt-2 space-y-2">
          {SETUP.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-[14px]">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 px-1 text-[12px] text-muted">
            <ExternalLink className="size-3.5" />
            The bot only runs on Vinted in your Safari. Nothing goes anywhere else.
          </li>
        </ol>
      )}
    </Sheet>
  );
}
