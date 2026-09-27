"use client";

import { useSyncExternalStore } from "react";
import type { Parcel } from "./parcels";

export type Address = { name: string; line1: string; city: string; zip: string; country: string; phone: string };
/** Only non-sensitive card metadata is kept on device; the full number never is. */
export type SavedCard = { brand: string; last4: string; exp: string; holder: string };

export type AppState = {
  address: Address;
  card: SavedCard | null;
  orders: Parcel[];
  gmailConnected: boolean;
  demoUser: { name: string; email: string } | null;
  recent: string[];
  saved: string[];
};

const KEY = "orbit.v1";

const DEFAULT: AppState = {
  address: { name: "", line1: "", city: "Prague", zip: "", country: "Czechia", phone: "" },
  card: null,
  orders: [],
  gmailConnected: false,
  demoUser: null,
  recent: [],
  saved: [],
};

let state: AppState = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = { ...DEFAULT, ...(JSON.parse(raw) as Partial<AppState>) };
  } catch {
    // Storage blocked (private mode etc.) — run in-memory.
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function setAppState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  load();
  const patch = typeof update === "function" ? update(state) : update;
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => DEFAULT,
  );
}
