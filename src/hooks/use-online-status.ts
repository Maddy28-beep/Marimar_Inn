"use client";

import { useEffect, useState } from "react";

/**
 * Simple navigator.onLine + window online/offline events — matches how the
 * owner described the problem ("no internet connection"), rather than
 * trying to separately infer Firestore-specific connectivity. Defaults to
 * true during SSR/before mount so nothing flashes an "Offline" state on
 * first paint.
 */
export function useOnlineStatus(): boolean {
  // Lazy initializer reads the real value on first client render — avoids
  // both an SSR crash (no `navigator`) and a setState-in-effect lint
  // violation from seeding it inside the effect below, which only needs to
  // subscribe to subsequent online/offline events.
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Appended to a success toast's message when the action just completed
 * while offline — the write is queued locally and will reach Firestore
 * once reconnected, but staff should see that confirmed rather than
 * wondering whether it actually went through.
 */
export function syncNote(isOnline: boolean): string {
  return isOnline ? "" : " — will sync once back online";
}
