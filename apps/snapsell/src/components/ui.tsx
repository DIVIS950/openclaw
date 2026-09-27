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
      whileTap={{ scale: 0.98, opacity: 0.8 }}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-45",
        size === "lg" && "h-[52px] rounded-[14px] px-6 text-[17px]",
        size === "md" && "h-11 rounded-xl px-5 text-[16px]",
        size === "sm" && "h-8 rounded-full px-3.5 text-[14px]",
        variant === "ink" && "bg-accent text-white hover:brightness-110",
        variant === "accent" && "bg-accent text-white hover:brightness-110",
        variant === "outline" && "bg-card text-accent ring-1 ring-line hover:bg-soft",
        variant === "soft" && "bg-accent-soft text-accent hover:brightness-95",
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
      <div className="grid place-items-center bg-gradient-to-b from-[#3a9bff] to-[#0062e0]" style={{ width: size, height: size, borderRadius: size * 0.23 }}>
        <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
      </div>
      {withName && <span className="font-display text-[21px] font-bold">SnapSell</span>}
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="glass sticky top-0 z-30 box-content grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b border-line/80 px-2 pt-[env(safe-area-inset-top)] lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none">
      <div className="flex min-w-0 items-center">
        {onBack && (
          <button onClick={onBack} className="flex h-11 items-center pr-2 text-[17px] text-accent" aria-label="Back">
            <ChevronLeft className="-mr-0.5 size-7" strokeWidth={2.2} />
            Back
          </button>
        )}
      </div>
      <div className="min-w-0 max-w-[55vw] truncate text-center text-[17px] font-semibold">{title}</div>
      <div className="flex min-w-0 items-center justify-end">{right}</div>
    </header>
  );
}

export function Sheet({ open, onClose, children, title, subtitle }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; subtitle?: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-[22px] bg-paper safe-bottom shadow-2xl lg:bottom-auto lg:top-1/2 lg:max-h-[86dvh] lg:-translate-y-1/2 lg:rounded-[22px]"
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
          >
            <div className="mx-auto mt-2 h-[5px] w-9 rounded-full bg-[#c7c7cc] lg:hidden" />
            <div className="px-5 pt-4">
              {title && <h2 className="font-display text-[22px] font-bold">{title}</h2>}
              {subtitle && <div className="mt-0.5 text-[15px] text-muted">{subtitle}</div>}
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
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-[9px] bg-[#767680]/12 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "relative h-8 flex-1 whitespace-nowrap rounded-[7px] px-2 text-[13px] font-semibold transition-colors",
            value === o.id ? "text-ink" : "text-ink/80",
          )}
        >
          {value === o.id && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]" />}
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
      className={cx("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", on ? "bg-[#34c759]" : "bg-[#e9e9eb]")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cx("absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)]", on ? "right-[2px]" : "left-[2px]")}
      />
    </button>
  );
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <span className="text-[13px] font-normal uppercase tracking-[0.02em] text-muted">{children}</span>
      {right}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-[14px] bg-card p-4", className)}>{children}</section>;
}

export function Pill({ children, tone = "soft", className }: { children: ReactNode; tone?: "soft" | "ok" | "ink" | "paper" | "accent"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold",
        tone === "soft" && "bg-soft",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "ink" && "bg-ink text-white",
        tone === "paper" && "bg-paper",
        tone === "accent" && "bg-accent-soft text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The price, large and calm, on a soft blue capsule. */
export function PriceTag({ children, size = "md" }: { children: ReactNode; size?: "md" | "lg" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[12px] bg-accent-soft font-display font-bold tabular-nums text-accent",
        size === "lg" ? "h-[52px] px-4 text-[32px]" : "h-10 px-3.5 text-xl",
      )}
    >
      {children}
    </span>
  );
}

export function PlatformLogo({ platform, size = 40 }: { platform: Platform; size?: number }) {
  const s = { width: size, height: size, borderRadius: size * 0.3 };
  if (platform === "ebay")
    return (
      <div style={s} className="grid shrink-0 place-items-center bg-white font-bold tracking-tighter ring-1 ring-line" aria-label="eBay">
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
      <div style={{ ...s, fontSize: size * 0.5 }} className="grid shrink-0 place-items-center bg-[#0866ff] font-bold text-white" aria-label="Facebook Marketplace">
        f
      </div>
    );
  return (
    <div style={{ ...s, fontSize: size * 0.45 }} className="grid shrink-0 place-items-center bg-[#007f86] font-bold text-white" aria-label="Vinted">
      V
    </div>
  );
}

export function Avatar({ name, picture, size = 44 }: { name: string; picture?: string; size?: number }) {
  return picture ? (
    <img src={picture} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#838388] font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
