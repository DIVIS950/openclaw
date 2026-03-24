import { contextBridge, ipcRenderer } from "electron";

// Type-safe channel lists to prevent arbitrary IPC calls
const VALID_SEND_CHANNELS = [
  "tab:create",
  "tab:close",
  "tab:switch",
  "tab:reorder",
  "nav:navigate",
  "nav:back",
  "nav:forward",
  "nav:reload",
  "bookmark:add",
  "bookmark:remove",
  "history:add",
  "history:clear",
  "settings:set",
  "ai:send-message",
  "ai:summarize",
  "shield:toggle",
  "window:minimize",
  "window:maximize",
  "window:close",
] as const;

const VALID_INVOKE_CHANNELS = [
  "tab:get-info",
  "tab:list",
  "bookmark:list",
  "history:search",
  "settings:get",
  "ai:stream-response",
  "shield:get-blocked-count",
  "window:is-maximized",
] as const;

const VALID_RECEIVE_CHANNELS = [
  "shortcut:new-tab",
  "shortcut:close-tab",
  "shortcut:reload",
  "shortcut:focus-address-bar",
  "shortcut:next-tab",
  "shortcut:prev-tab",
  "shortcut:toggle-ai",
  "tab:updated",
  "nav:state-changed",
  "ai:stream-chunk",
  "ai:stream-end",
  "shield:count-updated",
] as const;

type SendChannel = (typeof VALID_SEND_CHANNELS)[number];
type InvokeChannel = (typeof VALID_INVOKE_CHANNELS)[number];
type ReceiveChannel = (typeof VALID_RECEIVE_CHANNELS)[number];

function isValidSend(channel: string): channel is SendChannel {
  return (VALID_SEND_CHANNELS as readonly string[]).includes(channel);
}

function isValidInvoke(channel: string): channel is InvokeChannel {
  return (VALID_INVOKE_CHANNELS as readonly string[]).includes(channel);
}

function isValidReceive(channel: string): channel is ReceiveChannel {
  return (VALID_RECEIVE_CHANNELS as readonly string[]).includes(channel);
}

const atlasApi = {
  // --- Navigation ---
  navigate(url: string): void {
    ipcRenderer.send("nav:navigate", url);
  },
  goBack(): void {
    ipcRenderer.send("nav:back");
  },
  goForward(): void {
    ipcRenderer.send("nav:forward");
  },
  reload(): void {
    ipcRenderer.send("nav:reload");
  },

  // --- Tab management ---
  newTab(url?: string): void {
    ipcRenderer.send("tab:create", url);
  },
  closeTab(tabId: string): void {
    ipcRenderer.send("tab:close", tabId);
  },
  switchTab(tabId: string): void {
    ipcRenderer.send("tab:switch", tabId);
  },
  reorderTabs(fromIndex: number, toIndex: number): void {
    ipcRenderer.send("tab:reorder", fromIndex, toIndex);
  },
  async getTabInfo(tabId: string): Promise<unknown> {
    return ipcRenderer.invoke("tab:get-info", tabId);
  },
  async listTabs(): Promise<unknown> {
    return ipcRenderer.invoke("tab:list");
  },

  // --- AI ---
  sendMessage(message: string, context?: Record<string, unknown>): void {
    ipcRenderer.send("ai:send-message", message, context);
  },
  async streamResponse(
    message: string,
    context?: Record<string, unknown>,
  ): Promise<string> {
    return ipcRenderer.invoke("ai:stream-response", message, context);
  },
  summarize(url: string): void {
    ipcRenderer.send("ai:summarize", url);
  },

  // --- Shield (ad/tracker blocker) ---
  async getBlockedCount(): Promise<number> {
    return ipcRenderer.invoke("shield:get-blocked-count");
  },
  toggleShield(enabled: boolean): void {
    ipcRenderer.send("shield:toggle", enabled);
  },

  // --- Bookmarks ---
  addBookmark(bookmark: {
    url: string;
    title: string;
    favicon?: string;
  }): void {
    ipcRenderer.send("bookmark:add", bookmark);
  },
  removeBookmark(url: string): void {
    ipcRenderer.send("bookmark:remove", url);
  },
  async listBookmarks(): Promise<unknown> {
    return ipcRenderer.invoke("bookmark:list");
  },

  // --- History ---
  addHistory(entry: { url: string; title: string }): void {
    ipcRenderer.send("history:add", entry);
  },
  async searchHistory(query: string): Promise<unknown> {
    return ipcRenderer.invoke("history:search", query);
  },
  clearHistory(): void {
    ipcRenderer.send("history:clear");
  },

  // --- Settings ---
  async getSettings(key: string): Promise<unknown> {
    return ipcRenderer.invoke("settings:get", key);
  },
  setSettings(key: string, value: unknown): void {
    ipcRenderer.send("settings:set", key, value);
  },

  // --- Window controls (frameless) ---
  minimize(): void {
    ipcRenderer.send("window:minimize");
  },
  maximize(): void {
    ipcRenderer.send("window:maximize");
  },
  close(): void {
    ipcRenderer.send("window:close");
  },
  async isMaximized(): Promise<boolean> {
    return ipcRenderer.invoke("window:is-maximized");
  },

  // --- Generic safe IPC listener ---
  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    if (!isValidReceive(channel)) {
      console.warn(`[preload] Blocked subscription to channel: ${channel}`);
      return () => {};
    }
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

contextBridge.exposeInMainWorld("atlas", atlasApi);

export type AtlasApi = typeof atlasApi;
