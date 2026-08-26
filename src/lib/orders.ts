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

export async function addOrderItem(
  bookingId: string,
  itemId: string,
  quantity: number
) {
  const firestore = requireDb();
  const bookingRef = doc(firestore, "bookings", bookingId);
  const itemRef = doc(firestore, "inventory", itemId);
  let resultingItem: InventoryItem | null = null;

  await runTransaction(firestore, async (tx) => {
    const [bookingSnap, itemSnap] = await Promise.all([tx.get(bookingRef), tx.get(itemRef)]);
    if (!bookingSnap.exists()) throw new Error("Booking not found.");
    if (!itemSnap.exists()) throw new Error("Item not found.");

    const booking = bookingSnap.data() as Booking;
    const item = itemSnap.data() as InventoryItem;

    if (!item.unlimited && item.quantity < quantity) {
      throw new Error(`Only ${item.quantity} ${item.name} left in stock.`);
    }

    const items = [...(booking.items ?? [])];
    const existingIndex = items.findIndex((line) => line.itemId === itemId);
    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      const newQuantity = existing.quantity + quantity;
      items[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        subtotal: newQuantity * existing.unitPrice,
      };
    } else {
      items.push({
        itemId,
        name: item.name,
        unitPrice: item.sellingPrice,
        quantity,
        subtotal: quantity * item.sellingPrice,
      });
    }

    const { totalFbCharge, totalAmount } = recalcTotals(items, booking.totalRoomCharge);

    if (!item.unlimited) {
      tx.update(itemRef, { quantity: increment(-quantity), lastUpdated: serverTimestamp() });
    }
    tx.update(bookingRef, {
      items,
      totalFbCharge,
      totalAmount,
      updatedAt: serverTimestamp(),
    });

    resultingItem = { ...item, quantity: item.quantity - quantity };
  });

  if (resultingItem) await syncLowStockNotification(resultingItem);
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
