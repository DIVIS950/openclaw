import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connections } from "../src/components/Connections.tsx";

// More › Look › Style, and the Gmail + sync line on Today.

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("styles", () => {
  let root: { dataset: Record<string, string | undefined> };
  beforeEach(() => {
    vi.resetModules();
    root = { dataset: {} };
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("document", { documentElement: root, querySelectorAll: () => [] });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts as Classic with no attribute, and remembers a new pick", async () => {
    const theme = await import("../src/lib/theme.ts");
    expect(theme.stylePref()).toBe("classic");
    theme.applyStyle();
    expect(root.dataset.style).toBeUndefined();
    theme.setStylePref("calm");
    expect(root.dataset.style).toBe("calm");
    expect(theme.stylePref()).toBe("calm");
    theme.setStylePref("classic");
    expect(root.dataset.style).toBeUndefined();
  });

  it("Dark is always dark, even when Look is set to Light", async () => {
    const theme = await import("../src/lib/theme.ts");
    theme.setThemePref("light");
    expect(root.dataset.theme).toBe("light");
    theme.setStylePref("dark");
    expect(root.dataset.theme).toBe("dark");
    theme.setStylePref("playful");
    expect(root.dataset.theme).toBe("light");
  });

  it("ignores an unknown saved style", async () => {
    localStorage.setItem("psh.style", "neon");
    const theme = await import("../src/lib/theme.ts");
    expect(theme.stylePref()).toBe("classic");
    // A value that came through sync is JSON text.
    localStorage.setItem("psh.style", JSON.stringify("calm"));
    expect(theme.stylePref()).toBe("calm");
  });
});

describe("Gmail and sync line", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  it("says Gmail is on and when the last sync was", () => {
    const ok = { at: "2026-10-20T09:58:00Z", checked: 9, added: 0, error: "" };
    expect(connections(ok, "2026-10-20T09:55:00Z", now)).toEqual({
      gmail: true,
      synced: "2026-10-20T09:55:00Z",
      label: "Gmail on · synced 5 min ago",
    });
    expect(connections(ok, "", now).label).toBe("Gmail on");
  });

  it("asks to connect when Gmail hasn't answered yet or failed", () => {
    expect(connections(null, "", now).label).toBe("Connect Gmail");
    const failed = {
      at: "2026-10-20T09:58:00Z",
      checked: 0,
      added: 0,
      error: "Gmail isn't allowed",
    };
    const c = connections(failed, "2026-10-20T09:59:40Z", now);
    expect(c.gmail).toBe(false);
    expect(c.label).toBe("Connect Gmail · synced just now");
  });
});

describe("Classroom check without Gmail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't count as Gmail on when this page can't reach Gmail", async () => {
    const { syncClassroomEmails, syncStatus } = await import("../src/lib/classroomSync.ts");
    const data = {
      demo: false,
      gmailReachable: false,
      searchEmails: async () => [],
    } as unknown as Parameters<typeof syncClassroomEmails>[0];
    expect(await syncClassroomEmails(data, [])).toEqual([]);
    const status = syncStatus.get();
    expect(status?.error).toMatch(/Gmail can't be reached/);
    expect(connections(status, "").label).toBe("Connect Gmail");
  });

  it("the website with Google sign-in connected can reach Gmail", async () => {
    localStorage.setItem("psh.google.client", "123456-abc.apps.googleusercontent.com");
    localStorage.setItem("psh.gmail.granted", "1");
    const { ClaudeData } = await import("../src/lib/claudeData.ts");
    const { withGmail } = await import("../src/pages/gmailLink.ts");
    const plain = new ClaudeData(null, null, null, null);
    expect(plain.gmailReachable).toBe(false);
    expect(withGmail(plain).gmailReachable).toBe(true);
  });
});
