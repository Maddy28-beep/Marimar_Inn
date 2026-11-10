import {
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { bCollection, bDoc } from "@/lib/branches";
import { paymentBreakdown, type PaymentPortions } from "@/lib/bookings";
import type { Booking, PaymentMethod, StoreSale, Transaction, UserRole } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface PaymentChangeActor {
  uid: string;
  name: string;
  role?: UserRole;
}

export interface NewPaymentSplit {
  cash: number;
  gcash: number;
  qrph: number;
  gcashReference?: string;
  qrphReference?: string;
}

/**
 * One money-collecting event on a booking (check-in, extend, checkout...),
 * with its CURRENT method split — the original transaction plus any earlier
 * method corrections that pointed at it.
 */
export interface PaymentEvent {
  transactionId: string;
  type: Transaction["type"];
  timestamp: Date;
  split: PaymentPortions;
  amount: number;
}

const CORRECTABLE = new Set(["checkin", "extend", "checkout", "order", "payment"]);

/**
 * Cashiers may fix a payment method on the same calendar day it was taken;
 * Owner/Admin/Superadmin any day. Supervisor can't (same carve-out as voids).
 * Enforced in the UI — the rules limit which fields can change, never the
 * amounts, and every change is recorded with who made it.
 */
export function canChangePaymentMethod(role: UserRole | null | undefined, when: Date): boolean {
  if (role === "owner" || role === "admin" || role === "superadmin") return true;
  if (role !== "cashier") return false;
  const now = new Date();
  return (
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate()
  );
}

export function sumSplit(split: PaymentPortions): number {
  return split.cash + split.gcash + split.qrph;
}

function methodFromSplit(split: PaymentPortions): PaymentMethod {
  const used = (["cash", "gcash", "qrph"] as const).filter((m) => split[m] > 0.004);
  return used.length === 1 ? used[0]! : used.length === 0 ? "cash" : "split";
}

function splitLabel(split: PaymentPortions): string {
  const parts: string[] = [];
  if (split.cash > 0.004) parts.push(`Cash ${split.cash.toFixed(2)}`);
  if (split.gcash > 0.004) parts.push(`GCash ${split.gcash.toFixed(2)}`);
  if (split.qrph > 0.004) parts.push(`QRPh ${split.qrph.toFixed(2)}`);
  return parts.join(" + ") || "—";
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

function assertValidNewSplit(current: PaymentPortions, next: NewPaymentSplit) {
  if (next.cash < 0 || next.gcash < 0 || next.qrph < 0) {
    throw new Error("Amounts can't be negative.");
  }
  if (!near(sumSplit(current), next.cash + next.gcash + next.qrph)) {
    throw new Error("The new split must add up to the same amount that was paid.");
  }
  if (
    near(current.cash, next.cash) &&
    near(current.gcash, next.gcash) &&
    near(current.qrph, next.qrph)
  ) {
    throw new Error("That's the same payment method — nothing to change.");
  }
  if (next.gcash > 0 && !next.gcashReference?.trim() && !near(current.gcash, next.gcash)) {
    throw new Error("Enter the GCash reference number.");
  }
  if (next.qrph > 0 && !next.qrphReference?.trim() && !near(current.qrph, next.qrph)) {
    throw new Error("Enter the QRPh reference number.");
  }
}

/** Every payment taken on a booking, newest last, with its current split. */
export async function fetchPaymentEvents(bookingId: string): Promise<PaymentEvent[]> {
  const firestore = requireDb();
  const snap = await getDocs(
    query(bCollection(firestore, "transactions"), where("bookingId", "==", bookingId))
  );
  const all = snap.docs.map(
    (d) => d.data({ serverTimestamps: "estimate" }) as Transaction & { correctsTransactionId?: string }
  );
  const events: PaymentEvent[] = [];
  for (const t of all) {
    if (!CORRECTABLE.has(t.type) || t.amount <= 0) continue;
    const split: PaymentPortions = {
      cash: t.cashAmount ?? 0,
      gcash: t.gcashAmount ?? 0,
      qrph: t.qrphAmount ?? 0,
    };
    for (const c of all) {
      if (c.type === "method_change" && c.correctsTransactionId === t.transactionId) {
        split.cash += c.cashAmount ?? 0;
        split.gcash += c.gcashAmount ?? 0;
        split.qrph += c.qrphAmount ?? 0;
      }
    }
    events.push({
      transactionId: t.transactionId,
      type: t.type,
      timestamp: t.timestamp?.toDate?.() ?? new Date(),
      split,
      amount: sumSplit(split),
    });
  }
  return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Moves one booking payment to a different method (or split) WITHOUT changing
 * the amount. History isn't edited: a "method_change" transaction carrying the
 * per-method difference is added at the payment's original time, so the shift
 * that took the money reconciles with what was really in its drawer, and the
 * booking's running cash/GCash/QRPh totals are shifted by the same difference.
 */
export async function changeBookingPaymentMethod(
  bookingId: string,
  transactionId: string,
  next: NewPaymentSplit,
  actor: PaymentChangeActor
) {
  const firestore = requireDb();
  const bookingRef = bDoc(firestore, "bookings", bookingId);
  const bookingSnap = await getDoc(bookingRef);
  if (!bookingSnap.exists()) throw new Error("Booking not found.");
  const booking = bookingSnap.data() as Booking;
  if (booking.status === "voided") {
    throw new Error(
      "A voided booking's payment can't be changed here — ask the owner to remove it as a duplicate."
    );
  }

  const events = await fetchPaymentEvents(bookingId);
  const event = events.find((e) => e.transactionId === transactionId);
  if (!event) throw new Error("That payment record wasn't found.");
  if (!canChangePaymentMethod(actor.role, event.timestamp)) {
    throw new Error("Only the owner can change a payment from an earlier day.");
  }
  assertValidNewSplit(event.split, next);

  const delta: PaymentPortions = {
    cash: next.cash - event.split.cash,
    gcash: next.gcash - event.split.gcash,
    qrph: next.qrph - event.split.qrph,
  };

  const running = paymentBreakdown(booking);
  const updated: PaymentPortions = {
    cash: running.cash + delta.cash,
    gcash: running.gcash + delta.gcash,
    qrph: running.qrph + delta.qrph,
  };

  const batch = writeBatch(firestore);
  const txRef = doc(bCollection(firestore, "transactions"));
  batch.set(txRef, {
    transactionId: txRef.id,
    type: "method_change",
    bookingId,
    roomNumber: booking.roomNumber,
    amount: 0,
    cashAmount: delta.cash,
    gcashAmount: delta.gcash,
    qrphAmount: delta.qrph,
    correctsTransactionId: transactionId,
    note: `${splitLabel(event.split)} → ${splitLabel(next)}`,
    cashierId: actor.uid,
    cashierName: actor.name,
    ...(actor.role ? { cashierRole: actor.role } : {}),
    // Original time, so it lands in the same day/shift as the payment.
    timestamp: Timestamp.fromDate(event.timestamp),
  });

  const bookingUpdate: Record<string, unknown> = {
    paymentMethod: methodFromSplit(updated),
    splitCashAmount: updated.cash,
    splitGcashAmount: updated.gcash,
    updatedAt: serverTimestamp(),
  };
  if (booking.splitQrphAmount !== undefined || updated.qrph > 0) {
    bookingUpdate.splitQrphAmount = updated.qrph;
  }
  if (next.gcashReference?.trim()) bookingUpdate.gcashReference = next.gcashReference.trim();
  else if (updated.gcash <= 0.004 && booking.gcashReference) bookingUpdate.gcashReference = deleteField();
  if (next.qrphReference?.trim()) bookingUpdate.qrphReference = next.qrphReference.trim();
  else if (updated.qrph <= 0.004 && booking.qrphReference) bookingUpdate.qrphReference = deleteField();
  batch.update(bookingRef, bookingUpdate);

  await batch.commit();
}

/** Same idea for a walk-in store sale — one payment, edited in place with a history entry. */
export async function changeStoreSalePaymentMethod(
  saleId: string,
  next: NewPaymentSplit,
  actor: PaymentChangeActor
) {
  const firestore = requireDb();
  const saleRef = bDoc(firestore, "storeSales", saleId);
  const snap = await getDoc(saleRef);
  if (!snap.exists()) throw new Error("Sale not found.");
  const sale = snap.data() as StoreSale;
  const when = sale.soldAt?.toDate?.() ?? new Date();
  if (!canChangePaymentMethod(actor.role, when)) {
    throw new Error("Only the owner can change a payment from an earlier day.");
  }
  const current = paymentBreakdown(sale);
  assertValidNewSplit(current, next);
  const updated: PaymentPortions = { cash: next.cash, gcash: next.gcash, qrph: next.qrph };

  const update: Record<string, unknown> = {
    paymentMethod: methodFromSplit(updated),
    splitCashAmount: updated.cash,
    splitGcashAmount: updated.gcash,
    splitQrphAmount: updated.qrph,
    methodChanges: arrayUnion({
      at: Timestamp.now(),
      byId: actor.uid,
      byName: actor.name,
      from: splitLabel(current),
      to: splitLabel(updated),
    }),
  };
  if (next.gcashReference?.trim()) update.gcashReference = next.gcashReference.trim();
  else if (updated.gcash <= 0.004 && sale.gcashReference) update.gcashReference = deleteField();
  if (next.qrphReference?.trim()) update.qrphReference = next.qrphReference.trim();
  else if (updated.qrph <= 0.004 && sale.qrphReference) update.qrphReference = deleteField();

  const batch = writeBatch(firestore);
  batch.update(saleRef, update);
  await batch.commit();
}

