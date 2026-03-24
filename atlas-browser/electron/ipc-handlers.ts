import { ipcMain, BrowserWindow } from "electron";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Tab {
  id: string;
  url: string;
  title: string;
  favicon: string;
  isActive: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface Bookmark {
  url: string;
  title: string;
  favicon: string;
  addedAt: number;
}

interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

// ---------------------------------------------------------------------------
// In-memory stores (swap with persistent storage as needed)
// ---------------------------------------------------------------------------

const tabs = new Map<string, Tab>();
const bookmarks = new Map<string, Bookmark>();
const history: HistoryEntry[] = [];
const settings = new Map<string, unknown>();

let activeTabId: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function generateId(): string {
  return crypto.randomUUID();
}

function broadcastTabUpdate(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("tab:updated", [...tabs.values()]);
}

function createTab(url: string = "about:blank"): Tab {
  const id = generateId();
  const tab: Tab = {
    id,
    url,
    title: "New Tab",
    favicon: "",
    isActive: true,
    canGoBack: false,
    canGoForward: false,
  };
  // Deactivate current active tab
  if (activeTabId && tabs.has(activeTabId)) {
    const prev = tabs.get(activeTabId)!;
    prev.isActive = false;
    tabs.set(activeTabId, prev);
  }
  activeTabId = id;
  tabs.set(id, tab);
  return tab;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerIpcHandlers(): void {
  // ---- Tab management ----

  ipcMain.on("tab:create", (event, url?: string) => {
    const tab = createTab(url);
    broadcastTabUpdate(sender(event));
  });

  ipcMain.on("tab:close", (event, tabId: string) => {
    tabs.delete(tabId);

    // If we closed the active tab, activate the last remaining one
    if (activeTabId === tabId) {
      const remaining = [...tabs.values()];
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        next.isActive = true;
        activeTabId = next.id;
        tabs.set(next.id, next);
      } else {
        activeTabId = null;
      }
    }

    broadcastTabUpdate(sender(event));
  });

  ipcMain.on("tab:switch", (event, tabId: string) => {
    if (!tabs.has(tabId)) return;

    // Deactivate current
    if (activeTabId && tabs.has(activeTabId)) {
      const prev = tabs.get(activeTabId)!;
      prev.isActive = false;
      tabs.set(activeTabId, prev);
    }

    const tab = tabs.get(tabId)!;
    tab.isActive = true;
    activeTabId = tabId;
    tabs.set(tabId, tab);

    broadcastTabUpdate(sender(event));
  });

  ipcMain.on("tab:reorder", (event, fromIndex: number, toIndex: number) => {
    const tabArray = [...tabs.values()];
    if (fromIndex < 0 || fromIndex >= tabArray.length) return;
    if (toIndex < 0 || toIndex >= tabArray.length) return;

    const [moved] = tabArray.splice(fromIndex, 1);
    tabArray.splice(toIndex, 0, moved);

    tabs.clear();
    for (const tab of tabArray) {
      tabs.set(tab.id, tab);
    }

    broadcastTabUpdate(sender(event));
  });

  ipcMain.handle("tab:get-info", (_event, tabId: string) => {
    return tabs.get(tabId) ?? null;
  });

  ipcMain.handle("tab:list", () => {
    return [...tabs.values()];
  });

  // ---- Navigation ----

  ipcMain.on("nav:navigate", (event, url: string) => {
    if (!activeTabId || !tabs.has(activeTabId)) return;

    const tab = tabs.get(activeTabId)!;
    tab.url = url;
    tabs.set(activeTabId, tab);

    // Record in history
    history.push({ url, title: tab.title, visitedAt: Date.now() });

    const win = sender(event);
    broadcastTabUpdate(win);
    win?.webContents.send("nav:state-changed", {
      url,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
    });
  });

  ipcMain.on("nav:back", (event) => {
    const win = sender(event);
    win?.webContents.send("nav:state-changed", { action: "back" });
  });

  ipcMain.on("nav:forward", (event) => {
    const win = sender(event);
    win?.webContents.send("nav:state-changed", { action: "forward" });
  });

  ipcMain.on("nav:reload", (event) => {
    const win = sender(event);
    win?.webContents.send("nav:state-changed", { action: "reload" });
  });

  // ---- Bookmarks ----

  ipcMain.on(
    "bookmark:add",
    (
      _event,
      bookmark: { url: string; title: string; favicon?: string },
    ) => {
      bookmarks.set(bookmark.url, {
        url: bookmark.url,
        title: bookmark.title,
        favicon: bookmark.favicon ?? "",
        addedAt: Date.now(),
      });
    },
  );

  ipcMain.on("bookmark:remove", (_event, url: string) => {
    bookmarks.delete(url);
  });

  ipcMain.handle("bookmark:list", () => {
    return [...bookmarks.values()];
  });

  // ---- History ----

  ipcMain.on(
    "history:add",
    (_event, entry: { url: string; title: string }) => {
      history.push({
        url: entry.url,
        title: entry.title,
        visitedAt: Date.now(),
      });
    },
  );

  ipcMain.handle("history:search", (_event, query: string) => {
    const lowerQuery = query.toLowerCase();
    return history.filter(
      (entry) =>
        entry.url.toLowerCase().includes(lowerQuery) ||
        entry.title.toLowerCase().includes(lowerQuery),
    );
  });

  ipcMain.on("history:clear", () => {
    history.length = 0;
  });

  // ---- Settings ----

  ipcMain.handle("settings:get", (_event, key: string) => {
    return settings.get(key) ?? null;
  });

  ipcMain.on("settings:set", (_event, key: string, value: unknown) => {
    settings.set(key, value);
  });

  // ---- AI ----

  ipcMain.on(
    "ai:send-message",
    (event, message: string, context?: Record<string, unknown>) => {
      const win = sender(event);
      if (!win || win.isDestroyed()) return;

      // Placeholder: in production, pipe to an actual AI backend.
      // For now, echo the message back as a simulated streamed response.
      const reply = `AI response to: "${message}"`;
      const chunks = reply.split(" ");
      let i = 0;

      const interval = setInterval(() => {
        if (i >= chunks.length || win.isDestroyed()) {
          clearInterval(interval);
          win.webContents.send("ai:stream-end");
          return;
        }
        win.webContents.send("ai:stream-chunk", chunks[i] + " ");
        i++;
      }, 50);
    },
  );

  ipcMain.handle(
    "ai:stream-response",
    async (
      _event,
      message: string,
      _context?: Record<string, unknown>,
    ): Promise<string> => {
      // Placeholder: return a complete response for invoke-style calls.
      return `AI summary for: "${message}"`;
    },
  );

  ipcMain.on("ai:summarize", (event, url: string) => {
    const win = sender(event);
    if (!win || win.isDestroyed()) return;

    // Placeholder: summarize the page at the given URL.
    const summary = `Summary of ${url}: This page contains interesting content.`;
    win.webContents.send("ai:stream-chunk", summary);
    win.webContents.send("ai:stream-end");
  });

  // ---- Shield (tracker/ad blocker) ----

  let shieldEnabled = true;
  let blockedCount = 0;

  ipcMain.handle("shield:get-blocked-count", () => {
    return blockedCount;
  });

  ipcMain.on("shield:toggle", (event, enabled: boolean) => {
    shieldEnabled = enabled;
    const win = sender(event);
    win?.webContents.send("shield:count-updated", {
      enabled: shieldEnabled,
      blockedCount,
    });
  });

  // ---- Window controls ----

  ipcMain.on("window:minimize", (event) => {
    sender(event)?.minimize();
  });

  ipcMain.on("window:maximize", (event) => {
    const win = sender(event);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on("window:close", (event) => {
    sender(event)?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    return sender(event)?.isMaximized() ?? false;
  });
}
