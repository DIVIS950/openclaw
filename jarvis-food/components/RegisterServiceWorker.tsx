"use client";

import { useEffect } from "react";

/** Registers the tiny offline-fallback service worker (it never caches private data). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Not critical: the app works without it.
      });
    }
  }, []);
  return null;
}
