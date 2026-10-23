"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

const initial: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initial);
  return (
    <form action={formAction} className="card stack">
      <label className="field">
        <span className="label">Password</span>
        <input
          className="input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          autoFocus
          maxLength={200}
        />
      </label>
      {state.error ? (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Checking…">Unlock</SubmitButton>
    </form>
  );
}
