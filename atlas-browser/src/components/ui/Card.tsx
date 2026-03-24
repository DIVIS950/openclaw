import { type ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  /** Apply glass morphism backdrop blur */
  glass?: boolean;
  /** Subtle lift effect on hover */
  hoverable?: boolean;
  className?: string;
}

export function Card({
  children,
  glass = false,
  hoverable = false,
  className = "",
}: CardProps) {
  return (
    <div
      className={[
        "rounded-[var(--atlas-radius-md)]",
        "border border-[var(--atlas-steel)]",
        "p-[var(--atlas-space-md)]",
        glass
          ? "bg-[var(--atlas-glass-bg)] backdrop-blur-[var(--atlas-glass-blur)] border-[var(--atlas-glass-border)]"
          : "bg-[var(--atlas-slate)]",
        hoverable
          ? "transition-[transform,box-shadow] duration-[var(--atlas-transition-normal)] hover:-translate-y-0.5 hover:shadow-[var(--atlas-shadow-lg)]"
          : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
