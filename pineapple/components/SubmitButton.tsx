"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
};

/** A submit button that disables itself while its form's server action runs (no double taps). */
export function SubmitButton({ children, pendingLabel, className = "btn btn-primary", disabled }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
