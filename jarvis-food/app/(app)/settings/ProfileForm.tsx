"use client";

import { startTransition, useActionState, useState } from "react";
import { saveProfileAction, type ActionMessage } from "@/app/actions/settings";

type Values = {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  paymentMethod: "cash" | "card";
  maxBudgetCzk: string;
};

export function ProfileForm({ initial, ceiling }: { initial: Values; ceiling: number }) {
  const [state, formAction, pending] = useActionState<ActionMessage, FormData>(saveProfileAction, null);
  const [values, setValues] = useState(initial);

  const set =
    (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: event.target.value }));

  // Transition submit keeps the typed values if the server rejects them (no automatic form reset).
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="card stack" noValidate>
      <label className="field">
        <span className="label">Your name (for the order)</span>
        <input className="input" name="customerName" value={values.customerName} onChange={set("customerName")} autoComplete="name" maxLength={80} />
      </label>
      <label className="field">
        <span className="label">Your phone (for the courier)</span>
        <input
          className="input"
          name="customerPhone"
          type="tel"
          inputMode="tel"
          value={values.customerPhone}
          onChange={set("customerPhone")}
          autoComplete="tel"
          placeholder="+420 777 123 456"
          maxLength={25}
        />
      </label>
      <label className="field">
        <span className="label">Delivery address</span>
        <textarea
          className="input textarea"
          name="deliveryAddress"
          value={values.deliveryAddress}
          onChange={set("deliveryAddress")}
          rows={3}
          maxLength={300}
          placeholder={"Street 12, Praha 2\n3rd floor, name on the bell"}
          autoComplete="street-address"
        />
      </label>
      <label className="field">
        <span className="label">Payment on delivery</span>
        <select className="input" name="paymentMethod" value={values.paymentMethod} onChange={set("paymentMethod")}>
          <option value="cash">Cash</option>
          <option value="card">Card to the courier (at the door)</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Hard max budget per order</span>
        <div className="input-suffix">
          <input
            className="input"
            name="maxBudgetCzk"
            type="number"
            inputMode="numeric"
            min={50}
            max={ceiling}
            step={1}
            value={values.maxBudgetCzk}
            onChange={set("maxBudgetCzk")}
          />
          <span>CZK</span>
        </div>
        <span className="muted small">Default 600 CZK. No order can go above this.</span>
      </label>
      {state ? (
        <p className={state.ok ? "msg msg-ok" : "msg msg-error"} role="status">
          {state.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
