import type { Timestamp } from "firebase/firestore";

export function hoursElapsed(checkInTime: Timestamp | null, now: Date): number {
  // checkInTime can be transiently null: a serverTimestamp() write hasn't
  // round-tripped to the server yet, so the local snapshot has no value for
  // it even with `serverTimestamps: "estimate"` on the very first tick.
  if (!checkInTime) return 0;
  return (now.getTime() - checkInTime.toMillis()) / (1000 * 60 * 60);
}

export function formatHours(hours: number): string {
  const sign = hours < 0 ? "-" : "";
  // Round to whole minutes first, then split — rounding h and m separately
  // can independently round m up to 60 (e.g. 2.999h -> "2h 60m").
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${sign}${h}h ${m}m`;
}
