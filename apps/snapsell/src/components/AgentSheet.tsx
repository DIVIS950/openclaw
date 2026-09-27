import { Bot, Check, Copy, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { PLATFORM_META, type Listing, type Platform } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { agentInstruction, photoFileNames } from "../lib/agentPrompt.ts";
import { copyText, photoUrl } from "../lib/api.ts";
import { saveFile } from "../lib/saveFile.ts";
import { Button, Sheet } from "./ui.tsx";

/** Beta builds only (VITE_AGENT_BETA=1): hand a listing to a browser agent instead of posting it ourselves. */
export const AGENT_BETA = import.meta.env.VITE_AGENT_BETA === "1";

export function BetaPill() {
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">Beta</span>;
}

/** Instructions for Claude in Chrome to fill a marketplace's sell form in the user's own browser. */
export function AgentSheet({ platform, listing, onClose }: { platform: Platform | null; listing: Listing; onClose: () => void }) {
  const { settings } = useApp();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [showText, setShowText] = useState(false);
  const site = platform === "ebay" ? "eBay" : platform ? PLATFORM_META[platform].name : "";
  const text = platform ? agentInstruction(listing, platform, settings) : "";

  const copy = async () => {
    if (!(await copyText(text))) {
      setShowText(true);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Saved one by one: the Claude page asks the viewer to confirm each file.
  const savePhotos = async () => {
    setSaving("busy");
    const names = photoFileNames(listing);
    let ok = true;
    for (let i = 0; i < names.length; i++) {
      try {
        const blob = await fetch(photoUrl(listing, i)).then((r) => r.blob());
        ok = (await saveFile(names[i], blob)) && ok;
      } catch {
        ok = false;
      }
    }
    setSaving(ok ? "done" : "failed");
  };

  const steps = [
    "Open Chrome on your computer, with the Claude in Chrome extension and logged in to the site.",
    `Save the photos, then copy the instruction below.`,
    `Open the Claude side panel in Chrome, paste it and send. Claude fills the ${site} form; you check it and press Publish.`,
  ];

  return (
    <Sheet
      open={!!platform}
      onClose={onClose}
      title={`Post to ${site} with Claude`}
      subtitle={
        <span className="inline-flex items-center gap-2">
          Claude in Chrome does the typing <BetaPill />
        </span>
      }
    >
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-2xl bg-soft px-3.5 py-3 text-[14px]">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="soft" onClick={savePhotos} disabled={saving === "busy"}>
          {saving === "busy" ? <Loader2 className="size-4 animate-spin" /> : saving === "done" ? <Check className="size-4" /> : <Download className="size-4" />}
          {saving === "done" ? "Photos saved" : saving === "failed" ? "Try again" : `Save ${listing.photos.length} photo${listing.photos.length > 1 ? "s" : ""}`}
        </Button>
        <Button variant="accent" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy instruction"}
        </Button>
      </div>
      {saving === "failed" && <p className="mt-2 text-[13px] text-bad">Some photos weren't saved. You can add them yourself on the site.</p>}

      <button onClick={() => setShowText((v) => !v)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted underline underline-offset-4">
        <Bot className="size-4" />
        {showText ? "Hide the instruction" : "Show the instruction"}
      </button>
      {showText && (
        <textarea
          readOnly
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-2 h-56 w-full resize-none rounded-2xl border border-line bg-card p-3 font-mono text-[12px] leading-relaxed"
        />
      )}

      <p className="mt-3 text-[12px] text-muted">
        Test feature. Claude stops before the final Publish, so nothing goes live without you. Some sites may not let it upload photos; then add
        them yourself.
      </p>
    </Sheet>
  );
}
