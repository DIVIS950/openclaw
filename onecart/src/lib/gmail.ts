/**
 * Reads recent shipping emails with the Gmail REST API. Needs an OAuth access
 * token with the gmail.readonly scope (see use-gmail-auth.ts).
 */
const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const QUERY = 'newer_than:60d (subject:shipped OR subject:"on its way" OR subject:"out for delivery" OR "tracking number")';

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
type Message = { id: string; payload: Part & { headers?: { name: string; value: string }[] } };

export function decodeBase64Url(data: string): string {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  let percent = '';
  for (let i = 0; i < binary.length; i++) percent += `%${binary.charCodeAt(i).toString(16).padStart(2, '0')}`;
  try {
    return decodeURIComponent(percent);
  } catch {
    return binary;
  }
}

function findBody(part: Part, mime: string): string | undefined {
  if (part.mimeType === mime && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime);
    if (found) return found;
  }
  return undefined;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ');
}

export function messageToText(message: Message): string {
  const headers = message.payload.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const plain = findBody(message.payload, 'text/plain');
  const html = plain ? undefined : findBody(message.payload, 'text/html');
  const body = plain ?? (html ? htmlToText(html) : '');
  return `From: ${header('from')}\nSubject: ${header('subject')}\n\n${body}`;
}

export async function fetchShippingEmails(accessToken: string, max = 25): Promise<{ id: string; text: string }[]> {
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  const listRes = await fetch(`${API}?maxResults=${max}&q=${encodeURIComponent(QUERY)}`, auth);
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };

  const messages = await Promise.all(
    (list.messages ?? []).map(async ({ id }) => {
      const res = await fetch(`${API}/${id}?format=full`, auth);
      if (!res.ok) return undefined;
      const message = (await res.json()) as Message;
      return { id, text: messageToText(message) };
    }),
  );
  return messages.filter((m): m is { id: string; text: string } => !!m);
}
