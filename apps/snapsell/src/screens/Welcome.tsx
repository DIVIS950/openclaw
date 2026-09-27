import { Check } from "lucide-react";
import { motion } from "motion/react";
import { hashParams } from "../App.tsx";
import { Logo, PriceTag } from "../components/ui.tsx";
import { ItemArt } from "../components/ItemArt.tsx";
import type { Health } from "../lib/api.ts";

const MESSAGES: Record<string, string> = {
  denied: "That Google account isn't allowed on this SnapSell. Sign in with the owner's account.",
  failed: "Google sign-in didn't finish. Please try again.",
};

/** First screen: sign in with Google (design artboard 1). */
export function Welcome({ health }: { health: Health | null }) {
  const error = MESSAGES[hashParams().get("login") ?? ""];
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-lg flex-col overflow-hidden px-6 pb-8 pt-[max(56px,env(safe-area-inset-top))]">
      <Logo size={40} />

      <div className="relative mt-6 h-[330px]" aria-hidden="true">
        <motion.div
          initial={{ opacity: 0, y: 20, rotate: -7 }}
          animate={{ opacity: 1, y: 0, rotate: -7 }}
          transition={{ delay: 0.1 }}
          className="absolute left-1.5 top-9 w-[170px] rounded-[22px] bg-card p-2.5 shadow-[0_18px_40px_-18px_rgba(23,21,15,0.35)]"
        >
          <div className="grid h-[150px] place-items-center rounded-[14px] bg-[#cfe0d8]">
            <ItemArt kind="sneaker" size={130} />
          </div>
          <div className="mt-2 text-[13px] font-semibold">Nike Air Max 90</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20, rotate: 5 }}
          animate={{ opacity: 1, y: 0, rotate: 5 }}
          transition={{ delay: 0.2 }}
          className="absolute right-1 top-0 w-[180px] rounded-[22px] bg-card p-2.5 shadow-[0_18px_40px_-18px_rgba(23,21,15,0.35)]"
        >
          <div className="grid h-[164px] place-items-center rounded-[14px] bg-[#d9cfbd]">
            <ItemArt kind="headphones" size={136} />
          </div>
          <div className="mt-2 text-[13px] font-semibold">Sony WH-1000XM4</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.6, rotate: -4 }}
          animate={{ opacity: 1, scale: 1, rotate: -4 }}
          transition={{ delay: 0.45, type: "spring" }}
          className="absolute right-8 top-[196px] shadow-[0_10px_24px_-10px_rgba(194,65,12,0.7)]"
        >
          <PriceTag>3 790 Kč</PriceTag>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="absolute left-8 top-[262px] flex h-10 items-center gap-2 rounded-full bg-ink px-3.5 text-[13px] font-semibold text-paper"
        >
          <Check className="size-4 text-[#7bd88f]" strokeWidth={3} /> Sold in 2 days
        </motion.div>
      </div>

      <h1 className="mt-2 font-display text-[44px] font-extrabold leading-[1.02] tracking-[-0.035em]">
        Snap it.
        <br />
        Price it.
        <br />
        <span className="text-accent-ink">Sell it everywhere.</span>
      </h1>
      <p className="mt-3.5 text-base leading-relaxed text-muted">
        Take a photo. AI finds out what it is, what it sells for, and posts it to eBay, Facebook Marketplace and Vinted.
      </p>

      <div className="flex-1" />
      {error && <p className="mb-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
      <div className="mt-6 flex flex-col gap-2.5">
        {health?.googleLogin !== false ? (
          <a
            href="/auth/google"
            className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-ink text-[17px] font-semibold text-white hover:bg-ink-2"
          >
            <GoogleG /> Continue with Google
          </a>
        ) : (
          <a href="/" className="flex h-14 items-center justify-center rounded-2xl bg-ink text-[17px] font-semibold text-white">
            Get started
          </a>
        )}
        <p className="mt-1 text-center text-xs text-muted">Your photos and listings stay private to your account.</p>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
