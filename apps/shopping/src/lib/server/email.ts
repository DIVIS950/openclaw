import "server-only";
import { carrierTrackingUrl, STATUS_LABEL, type Order } from "../order-types";

/**
 * Customer emails through Resend (https://resend.com), a plain HTTPS call so
 * no SDK is needed. Without RESEND_API_KEY nothing is sent and nothing fails.
 */
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.ORBIT_EMAIL_FROM);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const eur = (n: number) => `${n.toFixed(2)} EUR`;

function content(order: Order, baseUrl: string): { subject: string; lines: string[] } | null {
  const item = `${order.item.brand} ${order.item.title}`.trim();
  const link = `${baseUrl}/order/${order.id}`;
  switch (order.status) {
    case "held":
      return {
        subject: `Order received: ${item}`,
        lines: [`Thanks! We reserved ${eur(order.authorized)} on your card for ${item} from ${order.item.store}.`, "You'll only be charged once we've placed the order at the shop.", `Follow it here: ${link}`],
      };
    case "ordered":
      return {
        subject: `We've ordered your ${item}`,
        lines: [
          `Good news: we placed your order at ${order.item.store}${order.shopOrderNumber ? ` (shop order ${order.shopOrderNumber})` : ""}.`,
          `Your card was charged ${eur(order.charged ?? order.authorized)}${order.charged !== undefined && order.charged < order.authorized ? `, ${eur(order.authorized - order.charged)} less than reserved` : ""}.`,
          `Follow it here: ${link}`,
        ],
      };
    case "shipped": {
      const track = order.carrier && order.trackingNumber ? carrierTrackingUrl(order.carrier, order.trackingNumber) : undefined;
      return {
        subject: `Your ${item} is on the way`,
        lines: [`${order.carrier ?? order.delivery.carrier} has your parcel${order.trackingNumber ? `, tracking number ${order.trackingNumber}` : ""}.`, ...(track ? [`Carrier tracking: ${track}`] : []), `Watch it travel: ${link}`],
      };
    }
    case "delivered":
      return { subject: `Delivered: ${item}`, lines: [`Your ${item} was delivered. Enjoy!`, `Order details: ${link}`] };
    case "cancelled":
      return {
        subject: `Order cancelled: ${item}`,
        lines: [`We couldn't complete your order for ${item}${order.events.at(-1)?.note ? ` (${order.events.at(-1)!.note})` : ""}.`, "The reserved amount was released; nothing was charged. Banks usually show it within a few days.", `Details: ${link}`],
      };
    default:
      return null;
  }
}

/** Emails the customer about the order's current status. Never throws. */
export async function notifyCustomer(order: Order): Promise<void> {
  if (!emailConfigured()) return;
  const baseUrl = process.env.ORBIT_BASE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  const c = content(order, baseUrl);
  if (!c) return;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#14131c">
<h2 style="margin:0 0 8px">${esc(STATUS_LABEL[order.status])}</h2>
${c.lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).join("")}
<p style="margin-top:24px;font-size:12px;color:#5d5b6e">Orbit · order ${esc(order.id)}</p></div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.ORBIT_EMAIL_FROM, to: [order.customer.email], subject: c.subject, html, text: c.lines.join("\n\n") }),
    });
    if (!res.ok) console.error("[orbit] email failed", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[orbit] email failed", err);
  }
}
