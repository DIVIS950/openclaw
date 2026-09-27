import { getToken } from "next-auth/jwt";
import { gmailEnabled } from "@/auth";

// Carrier tracking-number patterns (best effort; confirmed later against the carrier API).
const PATTERNS: [string, RegExp][] = [
  ["UPS", /\b1Z[0-9A-Z]{16}\b/],
  ["FedEx", /\b\d{12}(?:\d{3})?\b/],
  ["USPS", /\b9[2-5]\d{20}\b/],
  ["DHL", /\bJJD\d{18}\b|\b\d{10}\b/],
  ["China Post / Cainiao", /\b[A-Z]{2}\d{9}[A-Z]{2}\b/],
];

type GmailList = { messages?: { id: string }[] };
type GmailMsg = { id: string; snippet: string; payload?: { headers?: { name: string; value: string }[] } };

/**
 * Scans the signed-in user's recent shipping emails for tracking numbers.
 * Read-only Gmail scope; runs server-side with the token from the session cookie.
 */
export async function GET(req: Request) {
  if (!gmailEnabled) return Response.json({ mode: "demo", parcels: [] });

  // The Google token is kept on the encrypted JWT, not on the public session object.
  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  const accessToken = token?.googleAccessToken as string | undefined;
  if (!accessToken) return Response.json({ error: "Sign in with Google first" }, { status: 401 });

  const q = encodeURIComponent("newer_than:30d (tracking OR shipped OR \"on its way\" OR zásilka)");
  const gh = { Authorization: `Bearer ${accessToken}` };
  const list = (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${q}`, { headers: gh }).then((r) => r.json())) as GmailList;

  const found: { carrier: string; trackingNumber: string; subject: string; from: string }[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, { headers: gh }).then((r) => r.json())) as GmailMsg;
    const header = (n: string) => msg.payload?.headers?.find((h) => h.name === n)?.value ?? "";
    const text = `${header("Subject")} ${msg.snippet}`;
    for (const [carrier, re] of PATTERNS) {
      const m = text.match(re);
      if (m && !found.some((f) => f.trackingNumber === m[0])) {
        found.push({ carrier, trackingNumber: m[0], subject: header("Subject"), from: header("From") });
        break;
      }
    }
  }
  return Response.json({ mode: "live", parcels: found });
}
