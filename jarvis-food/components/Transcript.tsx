import type { TranscriptLine } from "@/lib/call-results";
import { formatDuration } from "@/lib/format";

export function Transcript({ lines }: { lines: TranscriptLine[] }) {
  if (lines.length === 0) return <p className="muted small">No conversation yet.</p>;
  return (
    <ol className="transcript">
      {lines.map((line, index) => (
        <li key={index} className={line.role === "agent" ? "bubble bubble-agent" : "bubble bubble-user"}>
          <span className="bubble-who">
            {line.role === "agent" ? "Jarvis" : "Restaurant"} · {formatDuration(line.timeSecs)}
          </span>
          <span className="bubble-text">{line.message}</span>
        </li>
      ))}
    </ol>
  );
}
