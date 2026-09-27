import { Fragment } from "react";

/**
 * Tiny, safe markdown renderer for assistant replies: paragraphs, "-" bullets,
 * **bold**, _italic_ and http(s) links. Builds React nodes — never raw HTML.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length} className="my-1.5 space-y-1 pl-4">
          {bullets.map((b, i) => (
            <li key={i} className="list-disc marker:text-accent">
              {inline(b)}
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) {
      bullets.push(m[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length} className="my-1.5">{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|_(.+?)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(<Fragment key={out.length}>{s.slice(last, m.index)}</Fragment>);
    if (m[1]) out.push(<strong key={out.length} className="font-semibold">{m[1]}</strong>);
    else if (m[2]) out.push(<em key={out.length} className="text-muted">{m[2]}</em>);
    else out.push(<a key={out.length} href={m[4]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-ink underline underline-offset-2">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(<Fragment key={out.length}>{s.slice(last)}</Fragment>);
  return out;
}
