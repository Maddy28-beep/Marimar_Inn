import { doc, increment, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking, InventoryItem, OrderItem } from "@/lib/types";
import { syncLowStockNotification } from "@/lib/notifications";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

function recalcTotals(items: OrderItem[], totalRoomCharge: number) {
  const totalFbCharge = items.reduce((sum, item) => sum + item.subtotal, 0);
  return { totalFbCharge, totalAmount: totalRoomCharge + totalFbCharge };
}

export async function removeOrderItem(bookingId: string, itemId: string) {
  const firestore = requireDb();
  const bookingRef = doc(firestore, "bookings", bookingId);
  const itemRef = doc(firestore, "inventory", itemId);
  let resultingItem: InventoryItem | null = null;

  await runTransaction(firestore, async (tx) => {
    const [bookingSnap, itemSnap] = await Promise.all([tx.get(bookingRef), tx.get(itemRef)]);
    if (!bookingSnap.exists()) throw new Error("Booking not found.");

    const booking = bookingSnap.data() as Booking;
    const existing = (booking.items ?? []).find((line) => line.itemId === itemId);
    if (!existing) return;

    const items = (booking.items ?? []).filter((line) => line.itemId !== itemId);
    const { totalFbCharge, totalAmount } = recalcTotals(items, booking.totalRoomCharge);
    const isUnlimited = itemSnap.exists() && (itemSnap.data() as InventoryItem).unlimited;

    // An unlimited item was never decremented when ordered, so removing it
    // shouldn't restore anything either.
    if (!isUnlimited) {
      tx.update(itemRef, {
        quantity: increment(existing.quantity),
        lastUpdated: serverTimestamp(),
      });
    }
    tx.update(bookingRef, {
      items,
      totalFbCharge,
      totalAmount,
      updatedAt: serverTimestamp(),
    });

    if (itemSnap.exists()) {
      const item = itemSnap.data() as InventoryItem;
      resultingItem = { ...item, quantity: item.quantity + existing.quantity };
    }
  });

  if (resultingItem) await syncLowStockNotification(resultingItem);
}
