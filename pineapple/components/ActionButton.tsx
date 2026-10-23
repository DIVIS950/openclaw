"use client";

import { useActionState } from "react";
import type { ActionMessage } from "@/app/actions/settings";
import { SubmitButton } from "./SubmitButton";

type Props = {
  action: (prev: ActionMessage, formData: FormData) => Promise<ActionMessage>;
  label: string;
  pendingLabel?: string;
  className?: string;
};

/** One-button form for a server action that reports back a short success/error message. */
export function ActionButton({ action, label, pendingLabel, className = "btn btn-secondary" }: Props) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="action-form">
      <SubmitButton className={className} pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      {state ? (
        <p className={state.ok ? "msg msg-ok" : "msg msg-error"} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
