import { Ruler } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { addSentence } from "../../shared/assistant.ts";
import { SIZE_CHOICES, effectiveSize, sizeKind } from "../../shared/pricing.ts";
import { PLATFORMS, effectiveCopy, type Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { cx } from "./ui.tsx";

const SIZE_WORD: Record<string, string> = { Czech: "Velikost", Slovak: "Veľkosť", German: "Größe", Polish: "Rozmiar" };

/**
 * Clothes and shoes: asks the size only when the AI couldn't read it from a label in the photos.
 * The size is saved and added to every site's description (Vinted asks for it too).
 */
export function SizeCard({ listing, onEdit }: { listing: Listing; onEdit: (fn: (e: Listing["edits"]) => Listing["edits"]) => void }) {
  const { settings } = useApp();
  const [other, setOther] = useState("");
  const [skipped, setSkipped] = useState(false);
  const kind = sizeKind(listing.analysis);
  if (!kind || effectiveSize(listing) || skipped) return null;

  const save = (size: string) => {
    const value = size.trim();
    if (!value) return;
    const line = `${SIZE_WORD[settings.language] ?? "Size"}: ${value}`;
    onEdit((e) => {
      const platforms = { ...e.platforms };
      for (const p of PLATFORMS) {
        const cur = effectiveCopy(listing, p);
        platforms[p] = { ...platforms[p], title: cur.title, description: addSentence(cur.description, line) };
      }
      return { ...e, size: value, platforms };
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-3xl border-2 border-accent bg-card p-4"
    >
      <div className="flex items-center gap-2 font-display text-[17px] font-extrabold">
        <Ruler className="size-5 text-accent-ink" />
        {kind === "shoes" ? "What shoe size?" : "What size is it?"}
      </div>
      <p className="mt-0.5 text-[13px] text-muted">The AI couldn't read it from the photos. Buyers filter by size.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SIZE_CHOICES[kind].map((s) => (
          <button key={s} onClick={() => save(s)} className="h-9 rounded-full border-[1.5px] border-line-strong px-3 text-sm font-semibold hover:bg-soft">
            {s}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save(other)}
          placeholder={kind === "shoes" ? "Other, e.g. UK 8, 42.5" : "Other, e.g. 38, W32 L32"}
          aria-label="Other size"
          className="h-10 min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none"
        />
        <button onClick={() => save(other)} disabled={!other.trim()} className={cx("h-10 rounded-xl bg-accent px-4 text-sm font-bold text-ink disabled:opacity-40")}>
          Save
        </button>
      </div>
      <button onClick={() => setSkipped(true)} className="mt-2 text-[13px] font-semibold text-muted underline underline-offset-4">
        No size / skip
      </button>
    </motion.section>
  );
}
