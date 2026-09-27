import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "../lib/api.ts";
import { idb } from "../local/idb.ts";

/**
 * Web version opened with the private code: share the same link, so family gets SnapSell with the
 * AI key built in. Their listings stay on their own phone.
 */
export function ShareCard() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    idb.get<string>("shareCode").then((c) => setCode(c ?? null)).catch(() => {});
  }, []);
  if (!code) return null;
  const link = `${location.origin}${location.pathname}#k=${encodeURIComponent(code)}`;

  const share = async () => {
    const text = "SnapSell: take a photo, it prices it and writes the listing for Vinted, Facebook and eBay.";
    try {
      if (navigator.share) return void (await navigator.share({ title: "SnapSell", text, url: link }));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    setCopied(await copyText(link));
  };

  return (
    <section className="rounded-3xl bg-ink p-4 text-paper">
      <div className="font-display text-[17px] font-extrabold">Share SnapSell</div>
      <p className="mt-0.5 text-[13px] text-[#b9b2a2]">
        Send the private link to family. The AI comes with it, nobody has to type a key. Each phone keeps its own listings.
      </p>
      <button onClick={share} className="shine mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-bold text-ink">
        {copied ? <Check className="size-5" /> : <Share2 className="size-5" />}
        {copied ? "Link copied" : "Share the link"}
      </button>
      <p className="mt-2 break-all text-[12px] text-[#b9b2a2]">{link}</p>
    </section>
  );
}
