import { findKey } from "./canva.ts";
import { useCapability } from "./claudeRuntime.ts";

// Presentations in the student's own Gamma, through their claude.ai Gamma
// connector (the page never sees their Gamma login). Gamma builds the deck as
// a background job, so we start it and check back until the link is ready.
// Without the connector (the website) the brief is copied and Gamma's own
// "Generate" page opens, so it's one paste away.

const GAMMA = "Gamma";
const MAX_WAIT_MS = 180_000;
export const GAMMA_NEW = "https://gamma.app/create/generate";

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** The first gamma.app deck link anywhere in a reply. */
export function findGammaLink(value: unknown): string | null {
  let hit: string | null = null;
  const walk = (v: unknown) => {
    if (hit) {
      return;
    }
    if (typeof v === "string") {
      if (/^https:\/\/gamma\.app\/(docs|public)\//.test(v)) {
        hit = v;
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (typeof v === "object" && v !== null) {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return hit;
}

/** The brief Gamma gets: topic, the task, and whatever the student wrote. */
export function deckBrief(topic: string, task: string, notes: string, slides: number): string {
  return [
    `A ${slides}-slide school presentation for a Year 9 student: ${topic}.`,
    task ? `The task: ${task}` : "",
    notes.trim() ? `Use the student's own notes and keep their ideas:\n${notes.trim()}` : "",
    "Clear headings, short bullet points, one picture per slide, a final summary slide.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Makes the deck and returns its link, or null when it fell back to copy + Gamma's page. */
export async function makeGammaDeck(brief: string, slides: number): Promise<string | null> {
  const mcp = await useCapability("mcp");
  if (!mcp) {
    try {
      await navigator.clipboard.writeText(brief);
    } catch {
      // Clipboard blocked: Gamma still opens.
    }
    window.open(GAMMA_NEW, "_blank", "noopener");
    return null;
  }
  let payload: unknown;
  try {
    ({ payload } = await mcp.callTool(GAMMA, "generate", {
      inputText: brief.slice(0, 8000),
      numCards: slides,
      textOptions: { audience: "students", language: "en-gb" },
    }));
  } catch (err) {
    throw new Error("Couldn't reach Gamma. Check the Gamma connector is connected on claude.ai.", {
      cause: err,
    });
  }
  let link = findGammaLink(payload);
  const id = text(findKey(payload, "generationId")) || text(findKey(payload, "id"));
  const started = Date.now();
  while (!link && id && Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 5000));
    ({ payload } = await mcp.callTool(GAMMA, "get_generation_status", { generationId: id }));
    link = findGammaLink(payload) || text(findKey(payload, "gammaUrl")) || null;
    const status = text(findKey(payload, "status")).toLowerCase();
    if (!link && (status === "failed" || status === "error")) {
      break;
    }
  }
  if (!link) {
    throw new Error("Gamma didn't finish the presentation. Try again in a minute.");
  }
  return link;
}
