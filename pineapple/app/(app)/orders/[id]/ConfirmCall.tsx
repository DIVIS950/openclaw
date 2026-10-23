"use client";

import { useActionState } from "react";
import type { CallState } from "@/app/actions/orders";
import { SubmitButton } from "@/components/SubmitButton";
import { MAX_CALLS_PER_DAY } from "@/lib/limits";

type Props = {
  action: (prev: CallState, formData: FormData) => Promise<CallState>;
  callsLeft: number;
};

const initial: CallState = { error: null };

export function ConfirmCall({ action, callsLeft }: Props) {
  const [state, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} className="stack">
      {state.error ? (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn-call btn-big" pendingLabel="Starting the call…">
        Yes, call
      </SubmitButton>
      <p className="muted small center">
        {callsLeft} of {MAX_CALLS_PER_DAY} calls left today · one call at a time
      </p>
    </form>
  );
}
