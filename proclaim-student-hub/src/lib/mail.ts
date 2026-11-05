// Building a reply email in the format Gmail's API expects (RFC 2822, base64url).

export function parseAddress(value: string): { name: string; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const email = match[2].trim();
    return { name: match[1].trim() || email, email };
  }
  const email = value.trim();
  return { name: email, email };
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export function base64Url(text: string): string {
  return base64Utf8(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Header values can't contain raw non-ASCII or line breaks.
function encodeHeader(value: string): string {
  const oneLine = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(oneLine) ? oneLine : `=?UTF-8?B?${base64Utf8(oneLine)}?=`;
}

function safeAddress(value: string): string {
  return value.replace(/[\r\n<>]/g, "");
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

export function encodeReply(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
}): string {
  const lines = [
    `From: ${safeAddress(input.from)}`,
    `To: ${safeAddress(input.to)}`,
    `Subject: ${encodeHeader(replySubject(input.subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (input.inReplyTo) {
    const id = input.inReplyTo.replace(/[\r\n]/g, "");
    lines.push(`In-Reply-To: ${id}`, `References: ${id}`);
  }
  return base64Url(`${lines.join("\r\n")}\r\n\r\n${base64Utf8(input.body)}`);
}
