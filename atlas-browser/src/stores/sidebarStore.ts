import { create } from "zustand";

export type SidebarTab = "bookmarks" | "history" | "downloads" | "notes";

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  favicon?: string;
  children?: BookmarkNode[];
  isFolder: boolean;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  visitedAt: number;
}

interface SidebarState {
  isOpen: boolean;
  activeTab: SidebarTab;
  bookmarks: BookmarkNode[];
  history: HistoryEntry[];
  expandedFolders: Set<string>;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleFolder: (id: string) => void;
  addBookmark: (parentId: string | null, node: BookmarkNode) => void;
  removeBookmark: (id: string) => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
}

function insertBookmark(
  nodes: BookmarkNode[],
  parentId: string | null,
  node: BookmarkNode,
): BookmarkNode[] {
  if (parentId === null) return [...nodes, node];
  return nodes.map((n) => {
    if (n.id === parentId && n.isFolder) {
      return { ...n, children: [...(n.children ?? []), node] };
    }
    if (n.children) {
      return { ...n, children: insertBookmark(n.children, parentId, node) };
    }
    return n;
  });
}

function filterBookmark(
  nodes: BookmarkNode[],
  id: string,
): BookmarkNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) =>
      n.children ? { ...n, children: filterBookmark(n.children, id) } : n,
    );
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  activeTab: "bookmarks",
  bookmarks: [
    {
      id: "folder-1",
      title: "Favorites",
      isFolder: true,
      children: [
        {
          id: "bm-1",
          title: "Atlas AI",
          url: "https://atlas.ai",
          isFolder: false,
        },
      ],
    },
  ],
  history: [],
  expandedFolders: new Set(["folder-1"]),

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveTab: (activeTab) => set({ activeTab }),

  toggleFolder: (id) =>
    set((s) => {
      const next = new Set(s.expandedFolders);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedFolders: next };
    }),

  addBookmark: (parentId, node) =>
    set((s) => ({
      bookmarks: insertBookmark(s.bookmarks, parentId, node),
    })),

  removeBookmark: (id) =>
    set((s) => ({ bookmarks: filterBookmark(s.bookmarks, id) })),

  addHistoryEntry: (entry) =>
    set((s) => ({ history: [entry, ...s.history] })),

  clearHistory: () => set({ history: [] }),
}));
