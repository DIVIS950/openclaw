import { motion } from "framer-motion";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative w-[44px] h-[24px] rounded-full",
          "transition-colors duration-[var(--atlas-transition-normal)]",
          checked
            ? "bg-[var(--atlas-racing-green)]"
            : "bg-[var(--atlas-steel)]",
        ].join(" ")}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={[
            "absolute top-[3px] block w-[18px] h-[18px] rounded-full",
            "shadow-[var(--atlas-shadow-sm)]",
            checked ? "bg-[var(--atlas-lime)]" : "bg-[var(--atlas-text-secondary)]",
          ].join(" ")}
          style={{ left: checked ? 23 : 3 }}
        />
      </button>
      {label && (
        <span className="text-[var(--atlas-text-sm)] text-[var(--atlas-text-secondary)]">
          {label}
        </span>
      )}
    </label>
  );
}
