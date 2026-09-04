"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js so the app shell (and everything the current
 * session has loaded) survives a reload with no network — the tablet's
 * WebView can lose its rendering process to Android's own memory
 * management at any time and reload the page as part of recovering, and a
 * plain browser tab can get refreshed the same way. Renders nothing;
 * mounted once from the root layout.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort — the app still works online without it, just loses
      // the offline-reload safety net.
    });
  }, []);

  return null;
}
