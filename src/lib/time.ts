import type { Timestamp } from "firebase/firestore";

export function hoursElapsed(checkInTime: Timestamp | null, now: Date): number {
  // checkInTime can be transiently null: a serverTimestamp() write hasn't
  // round-tripped to the server yet, so the local snapshot has no value for
  // it even with `serverTimestamps: "estimate"` on the very first tick.
  if (!checkInTime) return 0;
  return (now.getTime() - checkInTime.toMillis()) / (1000 * 60 * 60);
}
