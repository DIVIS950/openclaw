import { GoogleAuth } from "../lib/googleAuth.ts";
import { GoogleData } from "../lib/googleData.ts";
import type { DataSource, Email, Homework } from "../lib/types.ts";
import { syncToDocs, withDocLink } from "./googleDocs.ts";

// Gmail on the website: Google sign-in straight from the phone, read-only,
// so Classroom emails become homework here too (and answers can be saved as
// Google Docs). It needs a Google "OAuth
// client ID" (made once by a parent at console.cloud.google.com) pasted into
// More › Gmail on this website. The ID isn't secret; the sign-in happens on Google's page.

const CLIENT_KEY = "psh.google.client";
const GRANT_KEY = "psh.gmail.granted";
// drive.file: only the Google Docs this app makes (answers from "Do it here").
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

export const gmailClientId = {
  get(): string {
    try {
      return localStorage.getItem(CLIENT_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(id: string) {
    try {
      if (id.trim()) {
        localStorage.setItem(CLIENT_KEY, id.trim());
      } else {
        localStorage.removeItem(CLIENT_KEY);
        localStorage.removeItem(GRANT_KEY);
      }
    } catch {
      // Not remembered.
    }
  },
};

/** Looks like "123456-abc.apps.googleusercontent.com". */
export const isClientId = (id: string) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(id.trim());

class GmailLink {
  private cached: GoogleAuth | null = null;

  get auth(): GoogleAuth | null {
    const id = gmailClientId.get();
    if (!id) {
      this.cached = null;
      return null;
    }
    this.cached ??= new GoogleAuth(id, SCOPES);
    return this.cached;
  }

  /** The student connected Gmail at some point (the token itself lasts an hour). */
  get granted(): boolean {
    try {
      return localStorage.getItem(GRANT_KEY) === "1";
    } catch {
      return false;
    }
  }

  get connected(): boolean {
    return this.auth?.isSignedIn ?? false;
  }

  /** Must run from a tap: Google opens its sign-in window. */
  async connect(): Promise<void> {
    const auth = this.auth;
    if (!auth) {
      throw new Error("Paste the Google client ID first (More › Gmail on this website).");
    }
    await auth.signIn();
    try {
      localStorage.setItem(GRANT_KEY, "1");
    } catch {
      // Fine.
    }
  }

  disconnect() {
    this.auth?.signOut();
    try {
      localStorage.removeItem(GRANT_KEY);
    } catch {
      // Fine.
    }
  }

  private data(): GoogleData {
    const auth = this.auth;
    if (!auth) {
      throw new Error("Gmail isn't set up on this phone.");
    }
    return new GoogleData(auth);
  }

  search(query: string): Promise<Email[]> {
    return this.data().searchEmails(query);
  }

  inbox(): Promise<Email[]> {
    return this.data().searchEmails("in:inbox category:primary newer_than:7d");
  }
}

export const gmailLink = new GmailLink();

/** The website's data source, with Gmail on top once it's connected. */
export function withGmail(data: DataSource): DataSource {
  if (!gmailLink.granted || !gmailLink.auth) {
    return data;
  }
  // Same object underneath (drafts, homework), Gmail methods on top. Answers
  // also go into Google Docs while the sign-in is fresh (pages/googleDocs.ts).
  return Object.assign(Object.create(data) as DataSource, {
    searchEmails: (query: string) => gmailLink.search(query),
    inbox: () => gmailLink.inbox(),
    loadDraft: async (hw: Homework) => withDocLink(hw, await data.loadDraft(hw)),
    saveDraft: async (hw: Homework, text: string, fileId: string | null) => {
      const draft = await data.saveDraft(hw, text, fileId);
      if (!gmailLink.connected || !text.trim()) {
        return withDocLink(hw, draft);
      }
      const doc = await syncToDocs(hw, text).catch(() => null);
      return { ...draft, link: doc?.link ?? withDocLink(hw, draft).link };
    },
  });
}
