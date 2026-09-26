import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Eye, Loader2, Plug } from "lucide-react";
import { motion } from "motion/react";
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
import { api, formatPrice } from "../lib/api.ts";
import { Button, PlatformLogo, Sheet, Toggle, cx } from "./ui.tsx";

export function sellUrl(p: Platform, vintedDomain: string) {
  return p === "vinted" ? `https://${vintedDomain}/items/new` : PLATFORM_META[p].sellUrl;
}

export function PublishSheet({
  open,
  onClose,
  listing,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  listing: Listing;
  onChange: (l: Listing) => void;
}) {
  const { settings, go } = useApp();
  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<Platform | null>(null);

  useEffect(() => {
    if (!open) return;
    api.platforms().then((s) => {
      setStatuses(s);
      setSelected(new Set(s.filter((x) => x.connected && listing.publish[x.platform]?.status !== "live").map((x) => x.platform)));
    });
    // Only reset the selection when the sheet opens, not on every progress poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const status = (p: Platform) => statuses.find((s) => s.platform === p);
  const currency = listing.analysis!.price.currency;

  const publish = async () => {
    setSending(true);
    try {
      onChange(await api.publish(listing.id, [...selected]));
      setSelected(new Set());
    } finally {
      setSending(false);
    }
  };

  const copyAndOpen = async (p: Platform) => {
    const c = effectiveCopy(listing, p);
    await navigator.clipboard.writeText(`${c.title}\n\n${formatPrice(effectivePrice(listing), currency)}\n\n${c.description}`);
    setCopied(p);
    setTimeout(() => setCopied(null), 2000);
    window.open(sellUrl(p, settings!.vintedDomain), "_blank");
  };

  return (
    <Sheet open={open} onClose={onClose} title="Sell everywhere">
      <p className="-mt-2 mb-4 text-sm text-ink-400">
        {formatPrice(effectivePrice(listing), currency)} · {listing.photos.length} photos
        {settings!.autoPublish ? " · auto-publish on" : " · you confirm the final click"}
      </p>
      <div className="space-y-2">
        {PLATFORMS.map((p) => {
          const st = status(p);
          const state = listing.publish[p];
          const connected = !!st?.connected;
          return (
            <motion.div key={p} layout className="rounded-3xl border border-white/5 bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                <PlatformLogo platform={p} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{PLATFORM_META[p].name}</div>
                  <div className="truncate text-xs text-ink-400">{st?.detail ?? "…"}</div>
                </div>
                {state?.status === "live" ? (
                  <CheckCircle2 className="size-6 text-emerald-400" />
                ) : connected ? (
                  <Toggle
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
                  <button
                    onClick={() => {
                      onClose();
                      go("/settings");
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"
                  >
                    <Plug className="size-3.5" /> Connect
                  </button>
                )}
              </div>

              {state && state.status !== "idle" && (
                <div
                  className={cx(
                    "mt-3 flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm",
                    state.status === "working" && "bg-white/5 text-ink-200",
                    state.status === "live" && "bg-emerald-500/10 text-emerald-300",
                    state.status === "needs_review" && "bg-amber-400/10 text-amber-200",
                    state.status === "error" && "bg-red-500/10 text-red-300",
                  )}
                >
                  {state.status === "working" && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />}
                  {state.status === "live" && <Check className="mt-0.5 size-4 shrink-0" />}
                  {state.status === "needs_review" && <Eye className="mt-0.5 size-4 shrink-0" />}
                  {state.status === "error" && <AlertCircle className="mt-0.5 size-4 shrink-0" />}
                  <span className="flex-1">{state.message}</span>
                  {state.url && (
                    <a href={state.url} target="_blank" rel="noreferrer" className="shrink-0 font-semibold underline">
                      View
                    </a>
                  )}
                </div>
              )}

              <button
                onClick={() => copyAndOpen(p)}
                className="mt-2 inline-flex items-center gap-1.5 px-1 text-xs font-medium text-ink-400 hover:text-white"
              >
                {copied === p ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied === p ? "Copied, paste it in the form" : "Or copy text & open the site"}
                <ExternalLink className="size-3" />
              </button>
            </motion.div>
          );
        })}
      </div>

      <Button variant="ai" size="lg" className="mt-5 w-full" disabled={!selected.size} loading={sending} onClick={publish}>
        {selected.size ? `Post to ${selected.size} marketplace${selected.size > 1 ? "s" : ""}` : "Select a marketplace"}
      </Button>
      <p className="mt-3 text-center text-[11px] leading-snug text-ink-500">
        Facebook and Vinted are filled in by a browser on your computer, using your own account. These sites don't offer a
        public API, so they may limit automated posting.
      </p>
    </Sheet>
  );
}
