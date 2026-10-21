import type { OrderStatus } from "@/lib/orders";

const LABELS: Record<OrderStatus, { text: string; tone: string }> = {
  draft: { text: "Not called", tone: "neutral" },
  dialing: { text: "Dialing", tone: "live" },
  calling: { text: "On call", tone: "live" },
  processing: { text: "Wrapping up", tone: "live" },
  confirmed: { text: "Confirmed", tone: "ok" },
  not_confirmed: { text: "Not confirmed", tone: "bad" },
  failed: { text: "Call failed", tone: "warn" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const { text, tone } = LABELS[status];
  return <span className={`pill pill-${tone}`}>{text}</span>;
}
