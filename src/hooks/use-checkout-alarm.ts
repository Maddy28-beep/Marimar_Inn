"use client";

import { useEffect, useRef } from "react";
import { subscribeToNotifications } from "@/lib/notifications";
import { playOverdueAlarm, playWarningChime } from "@/lib/alarm";

const REPEAT_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Watches unresolved checkout-reminder notifications and plays an audible
 * alarm on top of the existing visual bell — a soft chime the moment a room
 * first crosses the 30-minute warning, then an urgent alarm once it goes
 * overdue, repeating every few minutes until the booking is resolved
 * (checked out or voided).
 *
 * Sounds only play for transitions that happen while this is mounted — the
 * first snapshot (whatever reminders already exist on page load) just
 * establishes a baseline so opening the dashboard doesn't replay a chime for
 * every already-overdue room at once. Already-overdue rooms still get their
 * repeat timer started silently, so they start alarming after the first
 * interval.
 */
export function useCheckoutAlarm() {
  const isFirstSnapshotRef = useRef(true);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const wasOverdueRef = useRef<Map<string, boolean>>(new Map());
  const repeatTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    const unsubscribe = subscribeToNotifications((notifications) => {
      const reminders = notifications.filter(
        (n) => n.type === "checkout_reminder" && !n.resolved
      );
      const currentIds = new Set(reminders.map((n) => n.notificationId));
      const isFirst = isFirstSnapshotRef.current;
      isFirstSnapshotRef.current = false;

      for (const n of reminders) {
        const isOverdue = n.message.includes("please check out");
        const wasKnown = knownIdsRef.current.has(n.notificationId);
        const wasOverdue = wasOverdueRef.current.get(n.notificationId) ?? false;

        if (!isFirst) {
          if (!wasKnown) playWarningChime();
          if (isOverdue && !wasOverdue) playOverdueAlarm();
        }

        if (isOverdue && !repeatTimersRef.current.has(n.notificationId)) {
          const timer = setInterval(() => playOverdueAlarm(), REPEAT_INTERVAL_MS);
          repeatTimersRef.current.set(n.notificationId, timer);
        }

        knownIdsRef.current.add(n.notificationId);
        wasOverdueRef.current.set(n.notificationId, isOverdue);
      }

      for (const id of Array.from(knownIdsRef.current)) {
        if (!currentIds.has(id)) {
          knownIdsRef.current.delete(id);
          wasOverdueRef.current.delete(id);
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
