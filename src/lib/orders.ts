import { doc, getDoc, increment, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking, InventoryItem, OrderItem } from "@/lib/types";
import { syncLowStockNotification } from "@/lib/notifications";
import { stockUnitsFor } from "@/lib/inventory";

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

  // getDoc + writeBatch (not runTransaction) — transactions require a live
  // round-trip and can't run offline; getDoc serves cached data offline
  // instead of failing, and writeBatch queues locally and flushes on
  // reconnect. Safe to drop the atomicity guarantee here since this app
  // runs on a single front-desk tablet — no concurrent writer to race.
  const [bookingSnap, itemSnap] = await Promise.all([getDoc(bookingRef), getDoc(itemRef)]);
  if (!bookingSnap.exists()) throw new Error("Booking not found.");

  const booking = bookingSnap.data() as Booking;
  const existing = (booking.items ?? []).find((line) => line.itemId === itemId);
  if (existing) {
    const items = (booking.items ?? []).filter((line) => line.itemId !== itemId);
    const { totalFbCharge, totalAmount } = recalcTotals(items, booking.totalRoomCharge);
    const inventoryItem = itemSnap.exists() ? (itemSnap.data() as InventoryItem) : null;
    const isUnlimited = inventoryItem?.unlimited ?? false;
    const restoreBy = inventoryItem ? stockUnitsFor(inventoryItem, existing.quantity) : existing.quantity;

    const batch = writeBatch(firestore);
    // An unlimited item was never decremented when ordered, so removing it
    // shouldn't restore anything either.
    if (!isUnlimited) {
      batch.update(itemRef, {
        quantity: increment(restoreBy),
        lastUpdated: serverTimestamp(),
      });
    }
    batch.update(bookingRef, {
      items,
      totalFbCharge,
      totalAmount,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    if (inventoryItem) {
      resultingItem = { ...inventoryItem, quantity: inventoryItem.quantity + restoreBy };
    }
  }

  if (resultingItem) await syncLowStockNotification(resultingItem);
}
