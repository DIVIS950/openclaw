import { GoogleAuth } from "../lib/googleAuth.ts";
import { applyLocal, collectLocal, mergeSync } from "../lib/syncMerge.ts";
import { gmailClientId } from "./gmailLink.ts";

// Sync between the student's devices on the website, through their own Google
// Drive: one file in Drive's hidden app folder (only this app can see it, it
// doesn't show in their Drive). Every device signs in with the same Google
// account (the student's personal Gmail) and merges with that file. Uses the
// same Google client ID as Gmail (More › For parents), with the Drive API on.

const FILE_NAME = "student-hub-sync.json";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.appdata"];
const ON_KEY = "psh.sync.on";
const AT_KEY = "psh.sync.at";
const BASE_KEY = "psh.sync.base";
/** Fired on window after a sync wrote new data on this device. */
export const SYNC_CHANGED = "psh:synced";

interface SyncFile {
  v: 1;
  at: string;
  data: Record<string, unknown>;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** A Drive request; 401 means the hour-long sign-in ran out. */
async function drive(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new SyncSignInError();
  }
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    throw new Error(
      /not been used|disabled|accessNotConfigured/i.test(body)
        ? "Turn on the Google Drive API for this app's Google project (see For parents), then try again."
        : "Google said no to Drive. Sign in again and allow “See, create and delete its own configuration data in your Google Drive”.",
    );
  }
  if (!res.ok) {
    throw new Error(`Google Drive didn't answer (${res.status}). Try again in a minute.`);
  }
  return res;
}

export class SyncSignInError extends Error {
  constructor() {
    super("Sign in to Google again to sync.");
  }
}

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

async function findFile(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name = '${FILE_NAME}'`);
  const res = await drive(token, `${API}?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=1`);
  const body = (await res.json()) as { files?: { id: string }[] };
  return body.files?.[0]?.id ?? null;
}

async function readFile(token: string, id: string): Promise<Record<string, unknown>> {
  const res = await drive(token, `${API}/${id}?alt=media`);
  const file = (await res.json().catch(() => null)) as SyncFile | null;
  return file?.v === 1 && file.data && typeof file.data === "object" ? file.data : {};
}

async function writeFile(token: string, id: string | null, data: Record<string, unknown>) {
  const body: SyncFile = { v: 1, at: new Date().toISOString(), data };
  if (id) {
    await drive(token, `${UPLOAD}/${id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return;
  }
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] })], {
      type: "application/json",
    }),
  );
  form.append("file", new Blob([JSON.stringify(body)], { type: "application/json" }));
  await drive(token, `${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", body: form });
}

class DriveSync {
  private cached: { id: string; auth: GoogleAuth } | null = null;
  private running: Promise<number> | null = null;

  private get auth(): GoogleAuth | null {
    const id = gmailClientId.get();
    if (!id) {
      return null;
    }
    if (this.cached?.id !== id) {
      this.cached = { id, auth: new GoogleAuth(id, SCOPES, "psh.sync.token") };
    }
    return this.cached.auth;
  }

  /** A Google client ID is saved (For parents), so sync can be switched on. */
  get ready(): boolean {
    return this.auth !== null;
  }

  get on(): boolean {
    try {
      return localStorage.getItem(ON_KEY) === "1";
    } catch {
      return false;
    }
  }

  /** Signed in this session: syncing needs no tap. */
  get signedIn(): boolean {
    return this.auth?.isSignedIn ?? false;
  }

  get lastSync(): string {
    try {
      return localStorage.getItem(AT_KEY) ?? "";
    } catch {
      return "";
    }
  }

  /** Must run from a tap: Google's sign-in window opens. Then syncs. */
  async connect(): Promise<number> {
    const auth = this.auth;
    if (!auth) {
      throw new Error("Add the Google client ID first (More › For parents › Gmail).");
    }
    await auth.signIn();
    try {
      localStorage.setItem(ON_KEY, "1");
    } catch {
      // Not remembered: it asks again next time.
    }
    return this.sync();
  }

  /**
   * Merges this device with the copy in Drive. Returns how many values changed
   * here (0: nothing new). Throws SyncSignInError when a tap is needed first.
   */
  sync(): Promise<number> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<number> {
    const auth = this.auth;
    if (!auth?.isSignedIn) {
      throw new SyncSignInError();
    }
    const token = auth.getToken();
    const id = await findFile(token);
    const remote = id ? await readFile(token, id) : {};
    const result = mergeSync(readJson(BASE_KEY, {}), collectLocal(localStorage), remote);
    const changed = applyLocal(localStorage, result.toLocal);
    if (result.upload || !id) {
      await writeFile(token, id, result.merged);
    }
    try {
      localStorage.setItem(BASE_KEY, JSON.stringify(result.base));
      localStorage.setItem(AT_KEY, new Date().toISOString());
    } catch {
      // The next sync compares everything again; nothing is lost.
    }
    if (changed > 0) {
      window.dispatchEvent(new Event(SYNC_CHANGED));
    }
    return changed;
  }

  /** Switches sync off on this device (the copy in Drive stays for the others). */
  turnOff() {
    this.auth?.signOut();
    for (const key of [ON_KEY, AT_KEY, BASE_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Already gone.
      }
    }
  }
}

export const driveSync = new DriveSync();
