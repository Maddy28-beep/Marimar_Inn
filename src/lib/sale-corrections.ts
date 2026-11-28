import { doc, getDocFromServer, getDocs, getDocsFromServer, increment, query, runTransaction, serverTimestamp, Timestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { bCollection, getActiveBranchId } from "@/lib/branches";
import { isAmenityItem } from "@/lib/booking-extras";
import { stockUnitsFor } from "@/lib/inventory";
import { canCorrectSale, planSaleCorrection, type SaleCorrectionInput } from "@/lib/sale-correction-plan";
import type { Booking, InventoryItem, SaleCorrection, Transaction, UserRole } from "@/lib/types";

function requireSession() {
  if (!db || !auth?.currentUser) throw new Error("Sign in before correcting a sale.");
  return { firestore: db, uid: auth.currentUser.uid };
}

/** Server reads only: a historical correction must not use stale offline data. */
export async function loadSaleCorrection(bookingId: string, branchId = getActiveBranchId()) {
  const { firestore } = requireSession();
  const [booking, payments] = await Promise.all([
    getDocFromServer(doc(bCollection(firestore, "bookings", branchId), bookingId)),
    getDocsFromServer(query(bCollection(firestore, "transactions", branchId), where("bookingId", "==", bookingId))),
  ]);
  if (!booking.exists()) throw new Error("Booking not found in this branch.");
  return { booking: booking.data() as Booking, transactions: payments.docs.map(d => d.data() as Transaction) };
}

/** Booking, original-shift payment reversals, stock and audit commit together. */
export async function correctHistoricalSale(bookingId: string, input: SaleCorrectionInput, branchId = getActiveBranchId()) {
  const { firestore, uid } = requireSession();
  // Capture every reference in the originating branch before any async work.
  const bookingRef = doc(bCollection(firestore, "bookings", branchId), bookingId);
  const correctionRef = doc(bCollection(firestore, "saleCorrections", branchId));
  await runTransaction(firestore, async transaction => {
    const [userSnap, bookingSnap] = await Promise.all([
      transaction.get(doc(firestore, "users", uid)), transaction.get(bookingRef),
    ]);
    const user = userSnap.data();
    if (!user || user.active === false || !canCorrectSale(user.role)) throw new Error("Only Owner/Admin/Superadmin can correct historical sales.");
    if (!bookingSnap.exists()) throw new Error("Booking not found.");
    const booking = bookingSnap.data() as Booking;
    // Re-read the query on retries; individual event reads join the transaction.
    const paymentQuery = await getDocsFromServer(query(bCollection(firestore, "transactions", branchId), where("bookingId", "==", bookingId)));
    const paymentSnaps = await Promise.all(paymentQuery.docs.map(payment => transaction.get(payment.ref)));
    const payments = paymentSnaps.filter(payment => payment.exists()).map(payment => payment.data() as Transaction);
    const plan = planSaleCorrection(booking, payments, input);
    const lines = ((input.action === "duplicate" && input.restoreStock !== false) || (input.action === "products" && input.restoreStock === true))
      ? (booking.items ?? []).filter((line, index) => !isAmenityItem(line) && (input.action === "duplicate" || input.productIndexes?.includes(index))) : [];
    const stockRefs = [...new Set(lines.map(line => line.itemId))].map(id => doc(bCollection(firestore, "inventory", branchId), id));
    const stocks = await Promise.all(stockRefs.map(ref => transaction.get(ref)));
    const stockNotifications = await Promise.all(stocks.map(stock => transaction.get(doc(bCollection(firestore, "notifications", branchId), `low-stock-${stock.id}`))));
    const now = serverTimestamp();
    const actorName = user.displayName || user.email || "Owner";
    const restockedItems: SaleCorrection["restockedItems"] = [];
    for (const [index, stock] of stocks.entries()) {
      if (!stock.exists()) continue;
      const item = stock.data() as InventoryItem;
      if (item.unlimited) continue;
      const quantity = lines.filter(line => line.itemId === stock.id).reduce((sum, line) => sum + stockUnitsFor(item, line.quantity), 0);
      if (quantity > 0) {
        transaction.update(stock.ref, { quantity: increment(quantity), lastUpdated: now });
        restockedItems.push({ itemId: stock.id, quantity });
        const notification = stockNotifications[index];
        if (item.quantity + quantity > item.minStockLevel && notification.exists() && !notification.data().resolved) {
          transaction.update(notification.ref, { resolved: true });
        }
      }
    }
    for (const removed of plan.removedPayments) {
      const ref = doc(bCollection(firestore, "transactions", branchId));
      transaction.set(ref, {
        transactionId: ref.id, type: "sale_correction", bookingId, roomNumber: booking.roomNumber,
        amount: -(removed.cash + removed.gcash + removed.qrph), cashAmount: -removed.cash,
        gcashAmount: -removed.gcash, qrphAmount: -removed.qrph,
        correctsTransactionId: removed.transactionId, correctionId: correctionRef.id,
        note: input.reason.trim(), cashierId: uid, cashierName: actorName, cashierRole: user.role,
        timestamp: removed.timestamp, recordedAt: now,
      });
    }
    transaction.update(bookingRef, {
      ...plan.updates, lastSaleCorrectionId: correctionRef.id,
      saleCorrectionCount: (booking.saleCorrectionCount ?? 0) + 1,
      ...(input.action === "duplicate" ? { reversedByName: actorName } : {}), updatedAt: now,
    });
    transaction.set(correctionRef, {
      correctionId: correctionRef.id, bookingId, roomNumber: booking.roomNumber,
      bookingCheckInTime: booking.checkInTime, action: input.action, reason: input.reason.trim(),
      correctedBy: uid, correctedByName: actorName, correctedByRole: user.role as UserRole,
      recordedAt: now, before: plan.before, after: plan.after,
      removedPayments: plan.removedPayments, restockedItems,
    });
    // Completed bookings only: do not change the room now occupied by another guest.
  });
  return correctionRef.id;
}

export async function fetchSaleCorrections(start: Date, end: Date, branchId = getActiveBranchId()): Promise<SaleCorrection[]> {
  const { firestore } = requireSession();
  const snapshot = await getDocs(query(bCollection(firestore, "saleCorrections", branchId),
    where("bookingCheckInTime", ">=", Timestamp.fromDate(start)), where("bookingCheckInTime", "<=", Timestamp.fromDate(end))));
  return snapshot.docs.map(d => d.data() as SaleCorrection).sort((a, b) => b.recordedAt.toMillis() - a.recordedAt.toMillis());
}
