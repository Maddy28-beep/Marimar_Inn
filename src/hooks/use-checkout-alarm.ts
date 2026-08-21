"use client";

import { useEffect, useRef } from "react";
import { hoursElapsed } from "@/lib/bookings";
import {
  checkoutReminderBookingId,
  CHECKOUT_CRITICAL_HOURS,
  CHECKOUT_WARNING_HOURS,
  subscribeToNotifications,
} from "@/lib/notifications";
import { playCriticalChime, playOverdueAlarm, playWarningChime } from "@/lib/alarm";
import { useFrontDesk } from "@/context/front-desk-context";
import type { AppNotification, Booking } from "@/lib/types";

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

function liveCheckoutState(booking: Booking | undefined) {
  if (!booking || booking.openEnded) return null;
  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, new Date());
  if (remaining > CHECKOUT_WARNING_HOURS) return null;
  const isOverdue = remaining <= 0;
  return {
    isOverdue,
    isCritical: !isOverdue && remaining <= CHECKOUT_CRITICAL_HOURS,
  };
}

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
 *
 * A leftover reminder for a room that is already checked out / available
 * does not ring. The bell used to follow the notification doc even after
 * the stay was gone.
 */
export function useCheckoutAlarm() {
  const { bookingsByRoom } = useFrontDesk();
  const mountedAtRef = useRef(0);
  const bookingsByIdRef = useRef<Map<string, Booking>>(new Map());
  const notificationsRef = useRef<AppNotification[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const wasCriticalRef = useRef<Map<string, boolean>>(new Map());
  const wasOverdueRef = useRef<Map<string, boolean>>(new Map());
  const repeatTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  function evaluate() {
    const reminders = notificationsRef.current.filter(
      (n) => n.type === "checkout_reminder" && !n.resolved
    );
    const currentIds = new Set<string>();
    const pastWarmup = Date.now() - mountedAtRef.current > WARMUP_MS;

    for (const n of reminders) {
      const bookingId = checkoutReminderBookingId(n);
      const booking = bookingId ? bookingsByIdRef.current.get(bookingId) : undefined;
      const state = liveCheckoutState(booking);
      if (!state) continue;

      currentIds.add(n.notificationId);
      const wasKnown = knownIdsRef.current.has(n.notificationId);
      const wasCritical = wasCriticalRef.current.get(n.notificationId) ?? false;
      const wasOverdue = wasOverdueRef.current.get(n.notificationId) ?? false;

      if (pastWarmup) {
        if (!wasKnown) playWarningChime();
        if (state.isCritical && !wasCritical) playCriticalChime();
        if (state.isOverdue && !wasOverdue) playOverdueAlarm();
      }

      if (state.isOverdue && !repeatTimersRef.current.has(n.notificationId)) {
        const timer = setInterval(() => playOverdueAlarm(), REPEAT_INTERVAL_MS);
        repeatTimersRef.current.set(n.notificationId, timer);
      }
      if (!state.isOverdue) {
        const timer = repeatTimersRef.current.get(n.notificationId);
        if (timer) {
          clearInterval(timer);
          repeatTimersRef.current.delete(n.notificationId);
        }
      }

      knownIdsRef.current.add(n.notificationId);
      wasCriticalRef.current.set(n.notificationId, state.isCritical);
      wasOverdueRef.current.set(n.notificationId, state.isOverdue);
    }

    for (const id of Array.from(knownIdsRef.current)) {
      if (!currentIds.has(id)) {
        knownIdsRef.current.delete(id);
        wasCriticalRef.current.delete(id);
        wasOverdueRef.current.delete(id);
        const timer = repeatTimersRef.current.get(id);
        if (timer) {
          clearInterval(timer);
          repeatTimersRef.current.delete(id);
        }
      }
    }
  }

  useEffect(() => {
    mountedAtRef.current = Date.now();

    const unsubscribe = subscribeToNotifications((notifications) => {
      notificationsRef.current = notifications;
      evaluate();
    });

    const timers = repeatTimersRef.current;
    return () => {
      unsubscribe();
      timers.forEach((timer) => clearInterval(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const byId = new Map<string, Booking>();
    bookingsByRoom.forEach((booking) => byId.set(booking.bookingId, booking));
    bookingsByIdRef.current = byId;
    evaluate();
  }, [bookingsByRoom]);
}
