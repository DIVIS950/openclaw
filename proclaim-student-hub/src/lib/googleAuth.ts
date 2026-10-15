// "Sign in with Google" using Google Identity Services. The student signs in on
// Google's own page; the app only ever gets a short-lived access token, never
// the password.

export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks",
];

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const STORAGE_KEY = "psh.token";

interface StoredToken {
  token: string;
  expiresAt: number;
}

function readStored(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredToken) : null;
    return parsed && parsed.expiresAt > Date.now() + 60_000 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredToken | null) {
  try {
    if (value) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private browsing can block storage; the token then lives in memory only.
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";

async function waitForGis(): Promise<GoogleIdentity> {
  // The website build doesn't ship Google's script; load it the first time it's needed.
  if (!window.google?.accounts?.oauth2 && !document.querySelector(`script[src="${GIS_SRC}"]`)) {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    document.head.appendChild(script);
  }
  for (let i = 0; i < 100; i++) {
    if (window.google?.accounts?.oauth2) {
      return window.google;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Couldn't load Google sign-in. Check your internet connection.");
}

export class SignInNeededError extends Error {
  constructor() {
    super("Your Google sign-in has expired. Tap Reconnect.");
  }
}

export class GoogleAuth {
  private current: StoredToken | null = readStored();
  private client: TokenClient | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly scopes: string[] = SCOPES,
  ) {}

  get isSignedIn(): boolean {
    return this.current !== null && this.current.expiresAt > Date.now();
  }

  /** Returns a valid token, or throws SignInNeededError so the UI can ask to reconnect. */
  getToken(): string {
    if (!this.current || this.current.expiresAt <= Date.now() + 30_000) {
      throw new SignInNeededError();
    }
    return this.current.token;
  }

  /** Must be called from a tap/click so the browser allows Google's pop-up. */
  async signIn(): Promise<string> {
    const gis = await waitForGis();
    this.client ??= gis.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: this.scopes.join(" "),
      callback: (response) => {
        const pending = this.pending;
        this.pending = null;
        if (!response.access_token) {
          pending?.reject(new Error(response.error_description || "Sign-in was cancelled."));
          return;
        }
        this.current = {
          token: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        };
        writeStored(this.current);
        pending?.resolve(response.access_token);
      },
      error_callback: (error) => {
        const pending = this.pending;
        this.pending = null;
        pending?.reject(
          new Error(
            error.type === "popup_closed"
              ? "Sign-in window was closed."
              : "Couldn't open Google sign-in. Allow pop-ups and try again.",
          ),
        );
      },
    });
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.client?.requestAccessToken({ prompt: this.current ? "" : "consent" });
    });
  }

  signOut() {
    if (this.current) {
      window.google?.accounts.oauth2.revoke(this.current.token);
    }
    this.current = null;
    writeStored(null);
  }
}
