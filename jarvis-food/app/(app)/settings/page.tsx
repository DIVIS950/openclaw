import { logoutAction, logoutEverywhereAction } from "@/app/actions/auth";
import {
  createAgentAction,
  deleteRestaurantAction,
  selectPhoneNumberAction,
  updateAgentAction,
} from "@/app/actions/settings";
import { ActionButton } from "@/components/ActionButton";
import { SubmitButton } from "@/components/SubmitButton";
import { requireSession } from "@/lib/auth";
import { listPhoneNumbers, type PhoneNumber } from "@/lib/elevenlabs";
import { MAX_BUDGET_SETTING_CEILING_CZK, MAX_CALLS_PER_DAY } from "@/lib/limits";
import { callsToday, listRestaurants } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { ProfileForm } from "./ProfileForm";

async function loadPhoneNumbers(): Promise<{ numbers: PhoneNumber[]; error: string | null }> {
  if (!process.env.ELEVENLABS_API_KEY) return { numbers: [], error: null };
  try {
    return { numbers: await listPhoneNumbers(), error: null };
  } catch (error) {
    return { numbers: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? "check-row check-ok" : "check-row check-missing"}>
      <span aria-hidden="true">{ok ? "✓" : "○"}</span>
      <span>{children}</span>
    </li>
  );
}

export default async function SettingsPage() {
  await requireSession();
  const [settings, restaurants, used, phones] = await Promise.all([
    getSettings(),
    listRestaurants(),
    callsToday(),
    loadPhoneNumbers(),
  ]);
  const hasApiKey = Boolean(process.env.ELEVENLABS_API_KEY);

  return (
    <>
      <header className="header">
        <p className="eyebrow">Settings</p>
        <h1 className="title">Settings</h1>
      </header>

      <section className="section">
        <h2 className="section-title">Your details</h2>
        <ProfileForm
          initial={{
            customerName: settings.customerName,
            customerPhone: settings.customerPhone ? formatPhone(settings.customerPhone) : "",
            deliveryAddress: settings.deliveryAddress,
            paymentMethod: settings.paymentMethod,
            maxBudgetCzk: String(settings.maxBudgetCzk),
          }}
          ceiling={MAX_BUDGET_SETTING_CEILING_CZK}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Saved restaurants</h2>
        {restaurants.length === 0 ? (
          <p className="muted small">Restaurants you order from are saved here.</p>
        ) : (
          <ul className="card list-plain">
            {restaurants.map((r) => (
              <li key={r.id} className="row-between">
                <span>
                  <strong>{r.name}</strong>
                  <br />
                  <span className="muted small">{formatPhone(r.phone)}</span>
                </span>
                <form action={deleteRestaurantAction.bind(null, r.id)}>
                  <SubmitButton className="btn btn-ghost btn-small" pendingLabel="…">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" id="voice-agent">
        <h2 className="section-title">Voice agent</h2>
        <ul className="card checks">
          <Check ok={hasApiKey}>
            ElevenLabs API key {hasApiKey ? "is set" : "missing: add ELEVENLABS_API_KEY in Vercel, then redeploy"}
          </Check>
          <Check ok={Boolean(settings.agentId)}>
            {settings.agentId ? (
              <>
                Agent <code>{settings.agentId}</code>
                {settings.agentIdFromEnv ? " (from ELEVENLABS_AGENT_ID)" : ""}
              </>
            ) : (
              "No agent yet"
            )}
          </Check>
          <Check ok={Boolean(settings.phoneNumberId)}>
            {settings.phoneNumberId ? (
              <>
                Caller number{" "}
                {phones.numbers.find((n) => n.phone_number_id === settings.phoneNumberId)?.phone_number ?? (
                  <code>{settings.phoneNumberId}</code>
                )}
                {settings.phoneNumberIdFromEnv ? " (from ELEVENLABS_PHONE_NUMBER_ID)" : ""}
              </>
            ) : (
              "No caller number selected"
            )}
          </Check>
        </ul>

        {hasApiKey ? (
          <div className="stack">
            {settings.agentId ? (
              <ActionButton action={updateAgentAction} label="Update agent to the latest prompt" pendingLabel="Updating…" />
            ) : (
              <ActionButton action={createAgentAction} label="Create the voice agent" pendingLabel="Creating…" className="btn btn-primary" />
            )}

            {!settings.phoneNumberIdFromEnv ? (
              <div className="card stack">
                <p className="label">Caller number (your Twilio number in ElevenLabs)</p>
                {phones.error ? <p className="msg msg-error">{phones.error}</p> : null}
                {phones.numbers.length === 0 && !phones.error ? (
                  <p className="muted small">
                    No numbers found. Import your Twilio number in ElevenLabs → Agents → Phone numbers, then reload this page.
                  </p>
                ) : null}
                {phones.numbers.map((n) => (
                  <div key={n.phone_number_id} className="row-between">
                    <span>
                      <strong>{n.phone_number}</strong>
                      <br />
                      <span className="muted small">
                        {n.label} · {n.provider}
                      </span>
                    </span>
                    {n.phone_number_id === settings.phoneNumberId ? (
                      <span className="pill pill-ok">In use</span>
                    ) : (
                      <ActionButton
                        action={selectPhoneNumberAction.bind(null, n.phone_number_id)}
                        label="Use"
                        pendingLabel="…"
                        className="btn btn-secondary btn-small"
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2 className="section-title">Safety limits</h2>
        <ul className="card rules">
          <li>Nothing is called without your “Yes, call” on the summary screen.</li>
          <li>
            One call at a time, max {MAX_CALLS_PER_DAY} calls per day ({used} used today).
          </li>
          <li>Only Czech restaurant numbers (+420). Premium-rate numbers are blocked.</li>
          <li>Hard budget limit: {settings.maxBudgetCzk} CZK per order.</li>
          <li>Payment always on delivery. No card details are ever stored or spoken.</li>
        </ul>
      </section>

      <section className="section">
        <h2 className="section-title">Security</h2>
        <div className="row">
          <form action={logoutAction} className="grow">
            <SubmitButton className="btn btn-secondary" pendingLabel="…">
              Sign out
            </SubmitButton>
          </form>
          <form action={logoutEverywhereAction} className="grow">
            <SubmitButton className="btn btn-ghost" pendingLabel="…">
              Sign out everywhere
            </SubmitButton>
          </form>
        </div>
      </section>
    </>
  );
}
