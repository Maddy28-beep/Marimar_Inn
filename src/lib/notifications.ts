import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AppNotification, Booking, InventoryItem, Room } from "@/lib/types";
import { hoursElapsed } from "@/lib/bookings";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export function subscribeToNotifications(onChange: (notifications: AppNotification[]) => void) {
  const firestore = requireDb();
  const q = query(collection(firestore, "notifications"), where("resolved", "==", false));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(
      (d) => d.data({ serverTimestamps: "estimate" }) as AppNotification
    );
    // Sorted client-side to avoid requiring a composite Firestore index for
    // resolved(==false) + createdAt(desc) together.
    list.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
    onChange(list);
  });
}

export async function markAsRead(notificationId: string, uid: string) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "notifications", notificationId), {
    readBy: arrayUnion(uid),
  });
}

export async function markAllAsRead(notificationIds: string[], uid: string) {
  if (notificationIds.length === 0) return;
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  for (const id of notificationIds) {
    batch.update(doc(firestore, "notifications", id), { readBy: arrayUnion(uid) });
  }
  await batch.commit();
}

/**
 * Idempotent: creates a low-stock notification the first time an item drops
 * to/under its threshold, and resolves it once restocked. Deterministic doc
 * ID (`low-stock-${itemId}`) means concurrent callers from different staff
 * sessions never create duplicates — whoever writes first wins, everyone
 * else's get-then-skip is a no-op.
 */
export async function syncLowStockNotification(
  item: Pick<InventoryItem, "itemId" | "name" | "quantity" | "minStockLevel">
) {
  const firestore = requireDb();
  const ref = doc(firestore, "notifications", `low-stock-${item.itemId}`);
  const snap = await getDoc(ref);

  if (item.quantity <= item.minStockLevel) {
    if (snap.exists()) return;
    const notification: Omit<AppNotification, "createdAt"> & {
      createdAt: ReturnType<typeof serverTimestamp>;
    } = {
      notificationId: ref.id,
      type: "low_stock",
      message: `${item.name} is low on stock (${item.quantity} left).`,
      itemId: item.itemId,
      itemName: item.name,
      createdAt: serverTimestamp(),
      resolved: false,
      readBy: [],
    };
    await setDoc(ref, notification);
  } else if (snap.exists() && !(snap.data() as AppNotification).resolved) {
    await updateDoc(ref, { resolved: true });
  }
}

/**
 * Idempotent: creates a checkout-reminder notification once a booking drops
 * under 30 minutes remaining, escalates the message (and re-surfaces it as
 * unread for everyone) once it goes overdue. Deterministic doc ID
 * (`checkout-reminder-${bookingId}`) — same duplicate-safety reasoning as
 * syncLowStockNotification.
 */
export async function syncCheckoutReminder(booking: Booking, room: Room, now: Date) {
  // Open-time bookings have no fixed end time by definition — nothing to remind about.
  if (booking.openEnded) return;

  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  if (remaining > 0.5) return;

  const firestore = requireDb();
  const ref = doc(firestore, "notifications", `checkout-reminder-${booking.bookingId}`);
  const overdue = remaining <= 0;
  const message = overdue
    ? `Room ${room.roomNumber} — ${booking.guestName}'s stay has ended, please check out.`
    : `Room ${room.roomNumber} — ${booking.guestName} has less than 30 minutes left.`;

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const notification: Omit<AppNotification, "createdAt"> & {
      createdAt: ReturnType<typeof serverTimestamp>;
    } = {
      notificationId: ref.id,
      type: "checkout_reminder",
      message,
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      createdAt: serverTimestamp(),
      resolved: false,
      readBy: [],
    };
    await setDoc(ref, notification);
    return;
  }

  const existing = snap.data() as AppNotification;
  if (overdue && existing.message !== message) {
    await updateDoc(ref, { message, readBy: [] });
  }
}

export async function resolveCheckoutReminder(bookingId: string) {
  const firestore = requireDb();
  const ref = doc(firestore, "notifications", `checkout-reminder-${bookingId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if ((snap.data() as AppNotification).resolved) return;
  await updateDoc(ref, { resolved: true });
}
