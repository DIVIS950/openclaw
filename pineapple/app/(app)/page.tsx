import Link from "next/link";
import { PineappleMark } from "@/components/PineappleMark";
import { requireSession } from "@/lib/auth";
import { MAX_CALLS_PER_DAY } from "@/lib/limits";
import { callsToday, getOrder, listActiveOrders, listRestaurants } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { getSettings, profileComplete } from "@/lib/settings";
import { OrderForm } from "./OrderForm";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const params = await searchParams;
  const editId = typeof params.edit === "string" ? params.edit : null;

  const [settings, restaurants, used, active, editing] = await Promise.all([
    getSettings(),
    listRestaurants(),
    callsToday(),
    listActiveOrders(),
    editId ? getOrder(editId) : Promise.resolve(null),
  ]);
  const draft = editing?.status === "draft" ? editing : null;
  const readyToCall = Boolean(
    process.env.ELEVENLABS_API_KEY && process.env.ANTHROPIC_API_KEY && settings.agentId && settings.phoneNumberId && settings.bridgeTokenSet,
  );

  return (
    <>
      <header className="header">
        <p className="brand">
          <PineappleMark size={26} /> Pineapple
        </p>
        <h1 className="title">{draft ? "Edit order" : "What are we eating?"}</h1>
        <p className="subtitle">
          <span className={used >= MAX_CALLS_PER_DAY ? "count count-full" : "count"}>
            {used}/{MAX_CALLS_PER_DAY} calls today
          </span>
        </p>
      </header>

      {active.length > 0 ? (
        <Link href={`/orders/${active[0].id}`} className="banner banner-live">
          <span className="live-dot" aria-hidden="true" /> Pineapple is on a call with {active[0].restaurantName}. Tap to watch.
        </Link>
      ) : null}

      {!profileComplete(settings) ? (
        <Link href="/settings" className="banner banner-warn">
          First add your name, phone and delivery address in Settings →
        </Link>
      ) : null}

      {!readyToCall ? (
        <Link href="/settings#voice-agent" className="banner banner-warn">
          The voice agent is not set up yet. Finish it in Settings → Voice agent.
        </Link>
      ) : null}

      <OrderForm
        restaurants={restaurants.map((r) => ({ id: r.id, name: r.name, phone: formatPhone(r.phone) }))}
        maxBudget={settings.maxBudgetCzk}
        initial={
          draft
            ? {
                restaurantName: draft.restaurantName,
                restaurantPhone: formatPhone(draft.restaurantPhone),
                items: draft.items,
                budget: String(Math.min(draft.budgetCzk, settings.maxBudgetCzk)),
              }
            : { restaurantName: "", restaurantPhone: "", items: "", budget: String(settings.maxBudgetCzk) }
        }
        replaces={draft?.id ?? null}
      />

      {settings.deliveryAddress ? (
        <p className="muted small center">
          Delivers to: {settings.deliveryAddress} · <Link href="/settings">change</Link>
        </p>
      ) : null}
    </>
  );
}
