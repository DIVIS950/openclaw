import { create } from "zustand";

export interface StatusState {
  isVisible: boolean;
  loadingProgress: number;
  requestCount: number;
  blockedCount: number;
  hoverUrl: string;

  setVisible: (visible: boolean) => void;
  toggleVisible: () => void;
  setLoadingProgress: (progress: number) => void;
  incrementRequests: () => void;
  incrementBlocked: () => void;
  resetCounts: () => void;
  setHoverUrl: (url: string) => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  isVisible: true,
  loadingProgress: 0,
  requestCount: 0,
  blockedCount: 0,
  hoverUrl: "",

  setVisible: (visible) => set({ isVisible: visible }),
  toggleVisible: () => set((s) => ({ isVisible: !s.isVisible })),
  setLoadingProgress: (progress) => set({ loadingProgress: progress }),
  incrementRequests: () => set((s) => ({ requestCount: s.requestCount + 1 })),
  incrementBlocked: () => set((s) => ({ blockedCount: s.blockedCount + 1 })),
  resetCounts: () => set({ requestCount: 0, blockedCount: 0 }),
  setHoverUrl: (url) => set({ hoverUrl: url }),
}));
