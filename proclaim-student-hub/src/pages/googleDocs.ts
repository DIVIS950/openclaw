import { GoogleData } from "../lib/googleData.ts";
import type { Draft, Homework } from "../lib/types.ts";
import { gmailLink } from "./gmailLink.ts";
import { PAGES } from "./runtime.ts";

// "Do it here" → Google Docs. On the website, once Google is connected (More ›
// Gmail, which now also asks for "files this app makes"), every save of an
// answer goes into its own Google Doc in a "Proclaim Student Hub" folder.
// Without Google (or on claude.ai) the answer is copied and a new blank Doc
// opens, so it's one paste away.

const KEY = "psh.docs";

interface DocRef {
  id: string;
  link: string | null;
}

function all(): Record<string, DocRef> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, DocRef>;
  } catch {
    return {};
  }
}

export const docLinks = {
  get: (hwId: string): DocRef | null => all()[hwId] ?? null,
  set(hwId: string, ref: DocRef) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...all(), [hwId]: ref }));
    } catch {
      // Not remembered: the next save makes a new Doc.
    }
  },
};

/** True when saves can go straight to Google Docs without a tap. */
export const docsReady = () => PAGES && gmailLink.connected;

/** Writes the answer into its Google Doc (made on the first save). Needs a valid token. */
export async function syncToDocs(hw: Homework, text: string): Promise<DocRef> {
  const auth = gmailLink.auth;
  if (!auth) {
    throw new Error("Google isn't set up on this phone (More › Gmail).");
  }
  const known = docLinks.get(hw.id);
  const saved = await new GoogleData(auth).saveDraft(hw, text, known?.id ?? null);
  const ref = { id: saved.fileId ?? known?.id ?? "", link: saved.link ?? known?.link ?? null };
  if (ref.id) {
    docLinks.set(hw.id, ref);
  }
  return ref;
}

/**
 * The "Google Doc" button (must run from a tap). Returns the Doc link, or null
 * when it fell back to copy + a blank Doc.
 */
export async function makeGoogleDoc(hw: Homework, text: string): Promise<string | null> {
  if (PAGES && gmailLink.auth) {
    if (!gmailLink.connected) {
      await gmailLink.connect();
    }
    const ref = await syncToDocs(hw, text);
    return ref.link;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked: the Doc still opens.
  }
  window.open("https://docs.new", "_blank", "noopener");
  return null;
}

/** Adds the Doc link to a draft that came from the phone's own storage. */
export function withDocLink(hw: Homework, draft: Draft): Draft {
  return draft.link ? draft : { ...draft, link: docLinks.get(hw.id)?.link ?? null };
}
