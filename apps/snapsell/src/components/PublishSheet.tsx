import { AlertCircle, Check, CheckCircle2, Clock, Eye, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  PLATFORMS,
  PLATFORM_META,
  effectiveCopy,
  effectivePrice,
  type Listing,
  type Platform,
  type PlatformStatus,
} from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { api, copyText, formatPrice } from "../lib/api.ts";
import { Button, PlatformLogo, Sheet, Toggle, cx } from "./ui.tsx";

export function sellUrl(p: Platform, vintedDomain: string) {
  return p === "vinted" ? `https://${vintedDomain}/items/new` : PLATFORM_META[p].sellUrl;
}

/** "Sell everywhere" sheet (design artboard 8). */
export function PublishSheet({ open, onClose, listing, onChange }: { open: boolean; onClose: () => void; listing: Listing; onChange: (l: Listing) => void }) {
  const { settings, setSettings, go } = useApp();
  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<Platform | null>(null);

  useEffect(() => {
    if (!open) return;
    api.platforms().then((s) => {
      setStatuses(s);
      setSelected(new Set(s.filter((x) => x.connected && !["live", "working", "queued"].includes(listing.publish[x.platform]?.status ?? "")).map((x) => x.platform)));
    });
    // Only reset the selection when the sheet opens, not on every progress poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currency = listing.analysis!.price.currency;
  const price = formatPrice(effectivePrice(listing), currency);
  const liveCount = PLATFORMS.filter((p) => listing.publish[p]?.status === "live").length;

  const publish = async () => {
    setSending(true);
    try {
      onChange(await api.publish(listing.id, [...selected]));
      setSelected(new Set());
    } finally {
      setSending(false);
    }
  };

  // Runs on the link's click: copies the text, and the link itself opens the site's sell page.
  const copyForSite = async (p: Platform) => {
    const c = effectiveCopy(listing, p);
    if (!(await copyText(`${c.title}\n\n${price}\n\n${c.description}`))) return;
    setCopied(p);
    setTimeout(() => setCopied(null), 2500);
  };

  const action = (st?: PlatformStatus) => {
    if (!st || st.connected || st.unavailable) return null;
    if (st.action === "ebay_login")
      return (
        <a href="/auth/ebay" className="flex h-[38px] items-center rounded-full bg-ink px-3.5 text-[13px] font-bold text-white">
          Log in
        </a>
      );
    const label = st.action === "chrome_login" ? "How?" : "Set up";
    return (
      <button
        onClick={() => {
          onClose();
          go("/connections");
        }}
        className="h-[38px] rounded-full bg-ink px-3.5 text-[13px] font-bold text-white"
      >
        {label}
      </button>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sell everywhere"
      subtitle={`${price} · ${listing.photos.length} photo${listing.photos.length > 1 ? "s" : ""} · ${listing.analysis!.item.name}`}
    >
      <div className="space-y-2.5">
        {PLATFORMS.map((p) => {
          const st = statuses.find((s) => s.platform === p);
          const state = listing.publish[p];
          const busy = state?.status === "working" || state?.status === "queued";
          return (
            <div key={p} className="rounded-[20px] border border-line bg-card p-3.5">
              <div className="flex items-center gap-3">
                <PlatformLogo platform={p} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{PLATFORM_META[p].name}</div>
                  <div className="truncate text-[13px] text-muted">{st?.detail ?? " "}</div>
                </div>
                {state?.status === "live" ? (
                  <CheckCircle2 className="size-[26px] fill-ok text-white" aria-label="Live" />
                ) : busy ? (
                  <Loader2 className="size-6 animate-spin" aria-label="Posting" />
                ) : st?.connected ? (
                  <Toggle
                    label={`Post to ${PLATFORM_META[p].name}`}
                    on={selected.has(p)}
                    onChange={(on) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (on) n.add(p);
                        else n.delete(p);
                        return n;
                      })
                    }
                  />
                ) : (
                  action(st)
                )}
              </div>

              {state && state.status !== "idle" && <StateRow state={state} />}

              {state?.status !== "live" && (
                <a
                  href={sellUrl(p, settings.vintedDomain)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => void copyForSite(p)}
                  className="mt-2 inline-flex h-8 items-center text-[13px] font-semibold text-muted underline underline-offset-4"
                >
                  {copied === p ? "Copied. Paste it into the form" : `Or copy the text and open ${p === "ebay" ? "eBay" : PLATFORM_META[p].name.split(" ")[0]}`}
                </a>
              )}
            </div>
          );
        })}
      </div>

      <label className="mt-2.5 flex items-center gap-3 rounded-2xl bg-soft px-3.5 py-3">
        <span className="flex-1">
          <span className="block text-[15px] font-bold">Let me check before it goes live</span>
          <span className="block text-[13px] text-muted">You press the final Publish on Facebook and Vinted</span>
        </span>
        <Toggle
          label="Let me check before it goes live"
          on={!settings.autoPublish}
          onChange={async (on) => setSettings(await api.saveSettings({ autoPublish: !on }))}
        />
      </label>

      <Button variant="accent" size="lg" className="mt-4 w-full" disabled={!selected.size} loading={sending} onClick={publish}>
        {selected.size
          ? `Post to ${selected.size}${liveCount ? " more" : ""} marketplace${selected.size > 1 ? "s" : ""}`
          : liveCount
            ? `Live on ${liveCount}`
            : "Choose where to sell"}
      </Button>
    </Sheet>
  );
}

function StateRow({ state }: { state: NonNullable<Listing["publish"][Platform]> }) {
  const tone = {
    idle: "",
    queued: "bg-soft",
    working: "bg-soft",
    needs_review: "bg-[#fdf0d5] text-[#7a4b00]",
    live: "bg-ok-soft text-[#174f34]",
    error: "bg-bad-soft text-bad",
  }[state.status];
  const Icon = { idle: Check, queued: Clock, working: Loader2, needs_review: Eye, live: Check, error: AlertCircle }[state.status];
  return (
    <div className={cx("mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold", tone)}>
      <div className="flex items-start gap-2">
        <Icon className={cx("mt-0.5 size-4 shrink-0", state.status === "working" && "animate-spin")} />
        <span className="flex-1">{state.message}</span>
        {state.url && (
          <a href={state.url} target="_blank" rel="noreferrer" className="shrink-0 font-bold underline">
            View listing
          </a>
        )}
      </div>
      {state.status === "working" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/3 indeterminate rounded-full bg-ink" />
        </div>
      )}
    </div>
  );
}
