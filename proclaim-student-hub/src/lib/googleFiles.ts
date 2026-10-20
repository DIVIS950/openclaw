import { useCapability } from "./claudeRuntime.ts";

// Class material from Google Docs and Google Slides, read through the
// student's claude.ai connectors (read-only; the page never sees their Google
// login). Only the words come in: they go into the Revision Lab's notes box
// and become a pack like typed notes do.

const DOCS = "Google Docs";
const SLIDES = "Google Slides";
/** The notes box takes this much; longer files are cut. */
export const MAX_TEXT = 20_000;
// Slides: only the text of shapes and tables, not the whole presentation.
const SLIDE_FIELDS = [
  "title",
  "slides.pageElements.shape.text",
  "slides.pageElements.table.tableRows.tableCells.text",
];

export interface GoogleFile {
  kind: "doc" | "slides";
  id: string;
}

/** The file in a docs.google.com link, or null for anything else (Forms, Sheets, other sites). */
export function googleFile(link: string): GoogleFile | null {
  const m = link
    .trim()
    .match(/^https:\/\/docs\.google\.com\/(document|presentation)\/(?:u\/\d+\/)?d\/([\w-]{20,})/);
  return m ? { kind: m[1] === "document" ? "doc" : "slides", id: m[2] } : null;
}

/**
 * The words of a read_doc or read_presentation reply, in order. Both keep
 * text in textRun.content pieces; this walks the reply for them, so it works
 * whatever the reply wraps them in.
 */
export function fileText(payload: unknown): { title: string; text: string } {
  const parts: string[] = [];
  let title = "";
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (!v || typeof v !== "object") {
      return;
    }
    const o = v as Record<string, unknown>;
    if (!title && typeof o.title === "string" && ("tabs" in o || "slides" in o || "body" in o)) {
      title = o.title;
    }
    const run = o.textRun as { content?: unknown } | undefined;
    if (run && typeof run.content === "string") {
      parts.push(run.content);
    }
    for (const [k, child] of Object.entries(o)) {
      // Styles, lists and layouts hold no words; skipping them keeps the walk short.
      if (k !== "textRun" && k !== "namedStyles" && k !== "lists" && k !== "documentStyle") {
        walk(child);
      }
    }
  };
  walk(payload);
  const text = parts
    .join("")
    // Slides break lines inside a box with a vertical tab.
    .replaceAll("\v", "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title.trim(), text: text.slice(0, MAX_TEXT) };
}

/** Whether Google files can be read here (the Claude app, not the website). */
export async function googleFilesAvailable(): Promise<boolean> {
  return (await useCapability("mcp")) !== null;
}

/** Reads a Google Doc or Slides link. Throws a message the student can act on. */
export async function readGoogleFile(link: string): Promise<{ title: string; text: string }> {
  const file = googleFile(link);
  if (!file) {
    throw new Error("Paste a link to a Google Doc or Google Slides (docs.google.com/…).");
  }
  const mcp = await useCapability("mcp");
  if (!mcp) {
    throw new Error("Open Student Hub in the Claude app to bring in Google Docs and Slides.");
  }
  const app = file.kind === "doc" ? DOCS : SLIDES;
  let payload: unknown;
  try {
    ({ payload } =
      file.kind === "doc"
        ? await mcp.callTool(DOCS, "read_doc", { documentId: file.id })
        : await mcp.callTool(SLIDES, "read_presentation", {
            presentationId: file.id,
            fields: SLIDE_FIELDS,
          }));
  } catch (err) {
    throw new Error(
      `Couldn't open that file. Check the ${app} connector is on in claude.ai and that ` +
        "the file is shared with your Google account.",
      { cause: err },
    );
  }
  const read = fileText(payload);
  if (!read.text) {
    throw new Error(
      `That ${file.kind === "doc" ? "document" : "presentation"} has no text to learn from.`,
    );
  }
  return read;
}
