import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "size" | "children"> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

const variantStyles: Record<Variant, string> = {
  primary: [
    "bg-[var(--atlas-racing-green)] text-[var(--atlas-text-primary)]",
    "hover:shadow-[var(--atlas-glow-green)]",
    "active:brightness-110",
  ].join(" "),
  secondary: [
    "bg-transparent border border-[var(--atlas-steel)] text-[var(--atlas-text-primary)]",
    "hover:border-[var(--atlas-racing-green)] hover:shadow-[var(--atlas-glow-green)]",
  ].join(" "),
  danger: [
    "bg-[var(--atlas-red)] text-[var(--atlas-text-primary)]",
    "hover:shadow-[var(--atlas-glow-red)]",
    "active:brightness-110",
  ].join(" "),
  ghost: [
    "bg-transparent text-[var(--atlas-text-secondary)]",
    "hover:bg-[var(--atlas-slate)]/40 hover:text-[var(--atlas-text-primary)]",
  ].join(" "),
};

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[var(--atlas-text-sm)] rounded-[var(--atlas-radius-sm)]",
  md: "px-4 py-2 text-[var(--atlas-text-sm)] rounded-[var(--atlas-radius-md)]",
  lg: "px-6 py-3 text-[var(--atlas-text-base)] rounded-[var(--atlas-radius-lg)]",
};

export function Button({
  variant = "primary",
  size = "md",
  children,
  disabled = false,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center font-medium",
        "transition-[box-shadow,background,border-color,color]",
        "duration-[var(--atlas-transition-normal)]",
        "select-none cursor-pointer",
        "disabled:opacity-40 disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
