import { ChevronLeft, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Platform } from "../../shared/types.ts";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ai" | "primary" | "ghost" | "danger";
  loading?: boolean;
  size?: "md" | "lg";
};

export function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled || loading}
      className={cx(
        "relative inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-colors disabled:opacity-50",
        size === "lg" ? "h-14 px-6 text-[17px]" : "h-11 px-4 text-[15px]",
        variant === "ai" && "ai-gradient glow text-white",
        variant === "primary" && "bg-white text-ink-950 hover:bg-ink-200",
        variant === "ghost" && "bg-white/5 text-white hover:bg-white/10",
        variant === "danger" && "bg-red-500/10 text-red-400 hover:bg-red-500/20",
        className,
      )}
      {...(rest as object)}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </motion.button>
  );
}

export function TopBar({ title, onBack, right }: { title?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-ink-950/80 px-3 backdrop-blur-xl pt-[env(safe-area-inset-top)] box-content">
      {onBack ? (
        <button onClick={onBack} className="grid size-10 place-items-center rounded-full hover:bg-white/5" aria-label="Back">
          <ChevronLeft className="size-6" />
        </button>
      ) : (
        <div className="w-1" />
      )}
      <div className="flex-1 truncate text-[17px] font-semibold">{title}</div>
      {right}
    </header>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-ink-900 safe-bottom"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => info.offset.y > 120 && onClose()}
          >
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-white/20" />
            {title && <div className="px-5 pt-4 text-xl font-bold">{title}</div>}
            <div className="p-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white/5 p-1 no-scrollbar">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "relative shrink-0 flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors",
            value === o.id ? "text-ink-950" : "text-ink-400 hover:text-white",
          )}
        >
          {value === o.id && (
            <motion.div layoutId={`seg-${options.map((x) => x.id).join()}`} className="absolute inset-0 rounded-xl bg-white" />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PlatformLogo({ platform, size = 36 }: { platform: Platform; size?: number }) {
  const s = { width: size, height: size, borderRadius: size * 0.3 };
  if (platform === "ebay")
    return (
      <div style={s} className="grid shrink-0 place-items-center bg-white font-extrabold tracking-tighter" aria-label="eBay">
        <span style={{ fontSize: size * 0.36 }}>
          <span className="text-[#e53238]">e</span>
          <span className="text-[#0064d2]">b</span>
          <span className="text-[#f5af02]">a</span>
          <span className="text-[#86b817]">y</span>
        </span>
      </div>
    );
  if (platform === "facebook")
    return (
      <div style={s} className="grid shrink-0 place-items-center bg-[#0866ff]" aria-label="Facebook Marketplace">
        <svg viewBox="0 0 24 24" style={{ width: size * 0.55 }} fill="white">
          <path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9H16l.6-4h-3.1V8.9c0-.6.3-.9.5-.9Z" />
        </svg>
      </div>
    );
  return (
    <div style={s} className="grid shrink-0 place-items-center bg-[#09b1ba] font-extrabold text-white" aria-label="Vinted">
      <span style={{ fontSize: size * 0.5 }}>V</span>
    </div>
  );
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1 text-[13px] font-semibold uppercase tracking-wider text-ink-400">
      <span>{children}</span>
      {right}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "ai-gradient" : "bg-white/15")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cx("absolute top-1 size-5 rounded-full bg-white shadow", on ? "right-1" : "left-1")}
      />
    </button>
  );
}
