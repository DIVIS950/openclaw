import { create } from "zustand";

export interface TabData {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isActive: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isSecure: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isBookmarked: boolean;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface BookmarkEntry {
  url: string;
  title: string;
  favicon?: string;
}

export interface TabState {
  tabs: TabData[];
  activeTabId: string | null;
  history: HistoryEntry[];
  bookmarks: BookmarkEntry[];

  // Tab actions
  addTab: (url?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<TabData>) => void;
  reorderTabs: (tabs: TabData[]) => void;

  // Navigation actions
  navigate: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  goHome: () => void;

  // Bookmark actions
  toggleBookmark: (url: string, title: string, favicon?: string) => void;
  isBookmarked: (url: string) => boolean;
}

let tabCounter = 0;
function createTabId(): string {
  tabCounter += 1;
  return `tab-${Date.now()}-${tabCounter}`;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],
  bookmarks: [],

  addTab: (url?: string) => {
    const id = createTabId();
    const newTab: TabData = {
      id,
      title: url ? "Loading..." : "New Tab",
      url: url ?? "",
      isActive: true,
      isPlaying: false,
      isLoading: !!url,
      isSecure: url?.startsWith("https://") ?? false,
      canGoBack: false,
      canGoForward: false,
      isBookmarked: false,
    };

    set((state) => ({
      tabs: [
        ...state.tabs.map((t) => ({ ...t, isActive: false })),
        newTab,
      ],
      activeTabId: id,
    }));
  },

  closeTab: (id: string) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      const remaining = state.tabs.filter((t) => t.id !== id);

      if (remaining.length === 0) {
        return { tabs: [], activeTabId: null };
      }

      const wasActive = state.activeTabId === id;
      if (!wasActive) {
        return { tabs: remaining };
      }

      // Activate the nearest tab
      const nextIdx = Math.min(idx, remaining.length - 1);
      const nextActive = remaining[nextIdx]!.id;
      return {
        tabs: remaining.map((t) => ({
          ...t,
          isActive: t.id === nextActive,
        })),
        activeTabId: nextActive,
      };
    });
  },

  setActiveTab: (id: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        isActive: t.id === id,
      })),
      activeTabId: id,
    }));
  },

  updateTab: (id: string, updates: Partial<TabData>) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    }));
  },

  reorderTabs: (tabs: TabData[]) => {
    set({ tabs });
  },

  navigate: (url: string) => {
    const { activeTabId } = get();
    if (!activeTabId) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              url,
              isLoading: true,
              isSecure: url.startsWith("https://"),
              title: "Loading...",
            }
          : t,
      ),
      history: [
        { url, title: "", visitedAt: Date.now() },
        ...state.history.slice(0, 99),
      ],
    }));
  },

  goBack: () => {
    const { activeTabId } = get();
    if (activeTabId) {
      window.electronAPI?.goBack?.(activeTabId);
    }
  },

  goForward: () => {
    const { activeTabId } = get();
    if (activeTabId) {
      window.electronAPI?.goForward?.(activeTabId);
    }
  },

  reload: () => {
    const { activeTabId } = get();
    if (activeTabId) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId ? { ...t, isLoading: true } : t,
        ),
      }));
      window.electronAPI?.reload?.(activeTabId);
    }
  },

  goHome: () => {
    const { activeTabId, navigate } = get();
    if (activeTabId) {
      navigate("");
    }
  },

  toggleBookmark: (url: string, title: string, favicon?: string) => {
    set((state) => {
      const exists = state.bookmarks.some((b) => b.url === url);
      const bookmarks = exists
        ? state.bookmarks.filter((b) => b.url !== url)
        : [...state.bookmarks, { url, title, favicon }];

      const isBookmarked = !exists;
      return {
        bookmarks,
        tabs: state.tabs.map((t) =>
          t.url === url ? { ...t, isBookmarked } : t,
        ),
      };
    });
  },

  isBookmarked: (url: string) => {
    return get().bookmarks.some((b) => b.url === url);
  },
}));
