"use client";

import { startTransition, useActionState, useState } from "react";
import { createDraftAction, type DraftFormState } from "@/app/actions/orders";

type Values = { restaurantName: string; restaurantPhone: string; items: string; budget: string };

type Props = {
  restaurants: Array<{ id: number; name: string; phone: string }>;
  maxBudget: number;
  initial: Values;
  replaces: string | null;
};

const initialState: DraftFormState = { error: null, fieldErrors: {} };

export function OrderForm({ restaurants, maxBudget, initial, replaces }: Props) {
  const [state, formAction, pending] = useActionState(createDraftAction, initialState);
  const [values, setValues] = useState<Values>(initial);
  const [saveRestaurant, setSaveRestaurant] = useState(true);
  const [submitted, setSubmitted] = useState<Values>(initial);

  const set = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: event.target.value }));

  // Submit via a transition instead of <form action> so React doesn't reset the fields
  // when the server sends back a validation error.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSubmitted(values);
    startTransition(() => formAction(formData));
  }

  // Show a field's error only until that field is edited.
  const errors = Object.fromEntries(
    Object.entries(state.fieldErrors).filter(([key]) => values[key as keyof Values] === submitted[key as keyof Values]),
  ) as DraftFormState["fieldErrors"];

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      {restaurants.length > 0 ? (
        <div className="chips" role="list" aria-label="Saved restaurants">
          {restaurants.map((r) => (
            <button
              key={r.id}
              type="button"
              role="listitem"
              className={values.restaurantPhone === r.phone ? "chip chip-active" : "chip"}
              onClick={() => setValues((v) => ({ ...v, restaurantName: r.name, restaurantPhone: r.phone }))}
            >
              {r.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="card stack">
        <label className="field">
          <span className="label">Restaurant</span>
          <input
            className="input"
            name="restaurantName"
            value={values.restaurantName}
            onChange={set("restaurantName")}
            placeholder="Pizzeria Da Mario"
            autoComplete="off"
            maxLength={80}
            aria-invalid={Boolean(errors.restaurantName)}
          />
          {errors.restaurantName ? <span className="field-error">{errors.restaurantName}</span> : null}
        </label>

        <label className="field">
          <span className="label">Restaurant phone</span>
          <input
            className="input"
            name="restaurantPhone"
            type="tel"
            inputMode="tel"
            value={values.restaurantPhone}
            onChange={set("restaurantPhone")}
            placeholder="+420 222 333 444"
            autoComplete="off"
            maxLength={25}
            aria-invalid={Boolean(errors.restaurantPhone)}
          />
          {errors.restaurantPhone ? <span className="field-error">{errors.restaurantPhone}</span> : null}
        </label>

        <label className="field">
          <span className="label">What do you want?</span>
          <textarea
            className="input textarea"
            name="items"
            value={values.items}
            onChange={set("items")}
            placeholder={"1× Pizza Margherita, large\n1× Tiramisu"}
            rows={4}
            maxLength={500}
            aria-invalid={Boolean(errors.items)}
          />
          {errors.items ? <span className="field-error">{errors.items}</span> : null}
        </label>

        <label className="field">
          <span className="label">
            Budget (max total) <span className="muted">· limit {maxBudget} CZK</span>
          </span>
          <div className="input-suffix">
            <input
              className="input"
              name="budget"
              type="number"
              inputMode="numeric"
              min={50}
              max={maxBudget}
              step={1}
              value={values.budget}
              onChange={set("budget")}
              aria-invalid={Boolean(errors.budget)}
            />
            <span>CZK</span>
          </div>
          {errors.budget ? <span className="field-error">{errors.budget}</span> : null}
        </label>

        <label className="check">
          <input
            type="checkbox"
            name="saveRestaurant"
            checked={saveRestaurant}
            onChange={(e) => setSaveRestaurant(e.target.checked)}
          />
          <span>Save this restaurant</span>
        </label>
        {replaces ? <input type="hidden" name="replaces" value={replaces} /> : null}
      </div>

      {state.error ? (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-big" disabled={pending}>
        {pending ? "Preparing summary…" : "Review order"}
      </button>
      <p className="muted small center">Nothing is called until you tap “Yes, call” on the next screen.</p>
    </form>
  );
}
