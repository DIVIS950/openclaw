import { ChevronLeft, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Platform } from "../../shared/types.ts";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ink" | "accent" | "outline" | "soft" | "danger";
  loading?: boolean;
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "ink", loading, size = "md", className, children, disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-45",
        size === "lg" && "h-[60px] rounded-[18px] px-6 text-[17px]",
        size === "md" && "h-12 rounded-2xl px-5 text-[15px]",
        size === "sm" && "h-9 rounded-full px-3.5 text-[13px]",
        variant === "ink" && "bg-ink text-white hover:bg-ink-2",
        variant === "accent" && "bg-accent text-ink shadow-[0_14px_30px_-12px_rgba(194,65,12,0.65)] hover:brightness-105",
        variant === "outline" && "border-[1.5px] border-line-strong bg-transparent text-ink hover:bg-soft",
        variant === "soft" && "bg-soft text-ink hover:bg-line",
        variant === "danger" && "bg-bad-soft text-bad hover:brightness-95",
        className,
      )}
      {...(rest as object)}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </motion.button>
  );
}

export function Logo({ size = 36, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid place-items-center bg-ink" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
        <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" stroke="#FF5B24" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
      </div>
      {withName && <span className="font-display text-[21px] font-extrabold">SnapSell</span>}
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 box-content flex h-14 items-center gap-1 bg-paper/85 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:static lg:bg-transparent lg:backdrop-blur-none">
      {onBack ? (
        <button onClick={onBack} className="grid size-11 place-items-center rounded-full hover:bg-soft" aria-label="Back">
          <ChevronLeft className="size-6" />
        </button>
      ) : (
        <div className="w-2" />
      )}
      <div className="min-w-0 flex-1 truncate">{title}</div>
      {right}
    </header>
  );
}

export function Sheet({ open, onClose, children, title, subtitle }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; subtitle?: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-[#17150f]/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-[28px] bg-paper safe-bottom lg:bottom-auto lg:top-1/2 lg:max-h-[86dvh] lg:-translate-y-1/2 lg:rounded-[28px]"
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            <div className="mx-auto mt-3 h-[5px] w-10 rounded-full bg-line-strong lg:hidden" />
            <div className="px-5 pt-4">
              {title && <h2 className="font-display text-[26px] font-extrabold">{title}</h2>}
              {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
            </div>
            <div className="p-5 pt-4">{children}</div>
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
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-[14px] bg-soft p-1">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "relative h-[38px] flex-1 whitespace-nowrap rounded-[11px] px-2 text-sm font-semibold transition-colors",
            value === o.id ? "text-white" : "text-muted hover:text-ink",
          )}
        >
          {value === o.id && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-[11px] bg-ink" />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx("relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors", on ? "bg-ink" : "bg-line-strong")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cx("absolute top-[3px] size-6 rounded-full bg-white shadow", on ? "right-[3px]" : "left-[3px]")}
      />
    </button>
  );
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{children}</span>
      {right}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-3xl border border-line bg-card p-4", className)}>{children}</section>;
}

export function Pill({ children, tone = "soft", className }: { children: ReactNode; tone?: "soft" | "ok" | "ink" | "paper" | "accent"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold",
        tone === "soft" && "bg-soft",
        tone === "ok" && "bg-ok-soft font-bold text-ok",
        tone === "ink" && "bg-ink text-white",
        tone === "paper" && "bg-paper",
        tone === "accent" && "bg-accent text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Price shown as an orange price tag, the SnapSell signature element. */
export function PriceTag({ children, size = "md" }: { children: ReactNode; size?: "md" | "lg" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[14px] bg-accent font-display font-extrabold text-ink",
        size === "lg" ? "h-[54px] gap-2.5 pl-3 pr-4 text-[32px]" : "h-11 gap-2 pl-3 pr-4 text-xl",
      )}
    >
      <span className="size-2.5 rounded-full bg-white" aria-hidden="true" />
      {children}
    </span>
  );
}

export function PlatformLogo({ platform, size = 40 }: { platform: Platform; size?: number }) {
  const s = { width: size, height: size, borderRadius: size * 0.3 };
  if (platform === "ebay")
    return (
      <div style={s} className="grid shrink-0 place-items-center border border-line bg-white font-extrabold tracking-tighter" aria-label="eBay">
        <span style={{ fontSize: size * 0.34 }}>
          <span className="text-[#e53238]">e</span>
          <span className="text-[#0064d2]">b</span>
          <span className="text-[#c98d00]">a</span>
          <span className="text-[#5e8e0f]">y</span>
        </span>
      </div>
    );
  if (platform === "facebook")
    return (
      <div style={{ ...s, fontSize: size * 0.5 }} className="grid shrink-0 place-items-center bg-[#0866ff] font-extrabold text-white" aria-label="Facebook Marketplace">
        f
      </div>
    );
  return (
    <div style={{ ...s, fontSize: size * 0.45 }} className="grid shrink-0 place-items-center bg-[#007f86] font-extrabold text-white" aria-label="Vinted">
      V
    </div>
  );
}

export function Avatar({ name, picture, size = 44 }: { name: string; picture?: string; size?: number }) {
  return picture ? (
    <img src={picture} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full bg-[#e4c9a8] font-bold" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
