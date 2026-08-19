"use client";

import { useEffect, useRef } from "react";
import { subscribeToNotifications } from "@/lib/notifications";
import { playCriticalChime, playOverdueAlarm, playWarningChime } from "@/lib/alarm";

const REPEAT_INTERVAL_MS = 3 * 60 * 1000;

// Firestore's realtime listener can emit twice in quick succession right
// after mount — an initial snapshot served from local cache (which may be
// stale or missing docs the server already has), then the real server
// snapshot moments later. Gating sound-on-mount off a single "first
// snapshot" flag let that second, still-effectively-initial emission slip
// through as a "new" transition and ring for a reminder that had already
// existed before the page ever loaded. Using a time window instead of a
// one-shot flag absorbs any number of quick initial emissions.
const WARMUP_MS = 4000;

/**
 * Watches unresolved checkout-reminder notifications and plays an audible
 * alarm on top of the existing visual bell — a soft chime the moment a room
 * first crosses the 30-minute warning, a sharper chime at 15 minutes, then
 * an urgent alarm once it goes overdue, repeating every few minutes until
 * the booking is resolved (checked out or voided).
 *
 * Sounds only play for transitions that happen after the warmup window —
 * whatever reminders already exist when the page loads just establish a
 * baseline so opening the dashboard doesn't replay chimes for every
 * already-warned/overdue room at once. Already-overdue rooms still get
 * their repeat timer started silently, so they start alarming after the
 * first interval.
 */
export function useCheckoutAlarm() {
  const mountedAtRef = useRef(0);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const wasCriticalRef = useRef<Map<string, boolean>>(new Map());
  const wasOverdueRef = useRef<Map<string, boolean>>(new Map());
  const wasPastCutoffRef = useRef<Map<string, boolean>>(new Map());
  const repeatTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    mountedAtRef.current = Date.now();
    const unsubscribe = subscribeToNotifications((notifications) => {
      const reminders = notifications.filter(
        (n) => n.type === "checkout_reminder" && !n.resolved
      );
      const currentIds = new Set(reminders.map((n) => n.notificationId));
      const pastWarmup = Date.now() - mountedAtRef.current > WARMUP_MS;

      for (const n of reminders) {
        const isPastCutoff = n.message.includes("more than 10 minutes overdue");
        const isOverdue =
          isPastCutoff || n.message.includes("please check out");
        const isCritical = !isOverdue && n.message.includes("15 minutes");
        const wasKnown = knownIdsRef.current.has(n.notificationId);
        const wasCritical = wasCriticalRef.current.get(n.notificationId) ?? false;
        const wasOverdue = wasOverdueRef.current.get(n.notificationId) ?? false;
        const wasPastCutoff = wasPastCutoffRef.current.get(n.notificationId) ?? false;

        if (pastWarmup) {
          if (!wasKnown) playWarningChime();
          if (isCritical && !wasCritical) playCriticalChime();
          if (isOverdue && !wasOverdue) playOverdueAlarm();
          if (isPastCutoff && !wasPastCutoff) playOverdueAlarm();
        }

        if (isOverdue && !repeatTimersRef.current.has(n.notificationId)) {
          const timer = setInterval(() => playOverdueAlarm(), REPEAT_INTERVAL_MS);
          repeatTimersRef.current.set(n.notificationId, timer);
        }

        knownIdsRef.current.add(n.notificationId);
        wasCriticalRef.current.set(n.notificationId, isCritical);
        wasOverdueRef.current.set(n.notificationId, isOverdue);
        wasPastCutoffRef.current.set(n.notificationId, isPastCutoff);
      }

      for (const id of Array.from(knownIdsRef.current)) {
        if (!currentIds.has(id)) {
          knownIdsRef.current.delete(id);
          wasCriticalRef.current.delete(id);
          wasOverdueRef.current.delete(id);
          wasPastCutoffRef.current.delete(id);
          const timer = repeatTimersRef.current.get(id);
          if (timer) {
            clearInterval(timer);
            repeatTimersRef.current.delete(id);
          }
        }
      }
    });

    const timers = repeatTimersRef.current;
    return () => {
      unsubscribe();
      timers.forEach((timer) => clearInterval(timer));
      timers.clear();
    };
  }, []);
}
