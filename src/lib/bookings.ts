import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking, InventoryItem, OrderItem, PaymentMethod, PaymentStatus } from "@/lib/types";
import { hoursElapsed } from "@/lib/time";
import { resolveCheckoutReminder } from "@/lib/notifications";

export { hoursElapsed };

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export function subscribeToActiveBookings(onChange: (byRoomId: Map<string, Booking>) => void) {
  const firestore = requireDb();
  const q = query(collection(firestore, "bookings"), where("status", "==", "active"));
  return onSnapshot(q, (snapshot) => {
    const byRoomId = new Map<string, Booking>();
    for (const docSnap of snapshot.docs) {
      const booking = docSnap.data({ serverTimestamps: "estimate" }) as Booking;
      byRoomId.set(booking.roomId, booking);
    }
    onChange(byRoomId);
  });
}

export interface CheckInCartLine {
  itemId: string;
  quantity: number;
}

export interface CheckInInput {
  roomId: string;
  roomNumber: string;
  guestName: string;
  guestPhone?: string;
  guestCount?: number;
  packageHours: number;
  packagePrice: number;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  gcashReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  specialRequests?: string;
  cashierId: string;
  cartItems?: CheckInCartLine[];
}

function paymentStatusFor(amountPaid: number, totalAmount: number): PaymentStatus {
  if (amountPaid <= 0) return "unpaid";
  return amountPaid >= totalAmount ? "paid" : "partial";
}

/**
 * A booking can be paid across several transactions (check-in, extend,
 * checkout) that each pick their own method — splitCashAmount/
 * splitGcashAmount track the running cash-vs-GCash total across all of
 * them, not just the latest one. Falls back to inferring the breakdown
 * from paymentMethod + amountPaid for bookings written before these
 * fields existed.
 */
export function paymentBreakdown(
  booking: Pick<Booking, "paymentMethod" | "amountPaid" | "splitCashAmount" | "splitGcashAmount">
): { cash: number; gcash: number } {
  if (booking.splitCashAmount !== undefined || booking.splitGcashAmount !== undefined) {
    return { cash: booking.splitCashAmount ?? 0, gcash: booking.splitGcashAmount ?? 0 };
  }
  if (booking.paymentMethod === "gcash") return { cash: 0, gcash: booking.amountPaid };
  return { cash: booking.amountPaid, gcash: 0 };
}

export function methodContribution(
  method: PaymentMethod,
  amount: number,
  splitCash?: number,
  splitGcash?: number
): { cash: number; gcash: number } {
  if (method === "gcash") return { cash: 0, gcash: amount };
  if (method === "split") return { cash: splitCash ?? 0, gcash: splitGcash ?? 0 };
  return { cash: amount, gcash: 0 };
}

/** Open-time rate: ₱100/hour, billed in 30-minute blocks rounded up. */
export const OPEN_TIME_RATE_PER_HOUR = 100;

/**
 * e.g. 1h01m and 1h20m both round up to the 1.5h block (₱150); 1h31m rounds
 * up to the 2h block (₱200).
 */
export function computeOpenTimeCharge(hoursStayed: number): number {
  const blocks = Math.max(0, Math.ceil((hoursStayed * 60) / 30 - 1e-9));
  return blocks * (OPEN_TIME_RATE_PER_HOUR / 2);
}

export async function checkIn(input: CheckInInput) {
  const firestore = requireDb();
  const totalRoomCharge = input.packagePrice;
  const cartItems = input.cartItems ?? [];

  const bookingRef = doc(collection(firestore, "bookings"));
  const roomRef = doc(firestore, "rooms", input.roomId);
  const itemRefs = cartItems.map((line) => doc(firestore, "inventory", line.itemId));

  await runTransaction(firestore, async (tx) => {
    // All reads must happen before any writes in a Firestore transaction.
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)));

    const orderItems: OrderItem[] = cartItems.map((line, i) => {
      const snap = itemSnaps[i];
      if (!snap.exists()) throw new Error("An item in the order no longer exists.");
      const data = snap.data() as InventoryItem;
      if (data.quantity < line.quantity) {
        throw new Error(`Only ${data.quantity} ${data.name} left in stock.`);
      }
      return {
        itemId: line.itemId,
        name: data.name,
        unitPrice: data.sellingPrice,
        quantity: line.quantity,
        subtotal: line.quantity * data.sellingPrice,
      };
    });

    const totalFbCharge = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const totalAmount = totalRoomCharge + totalFbCharge;
    const initialSplit = methodContribution(
      input.paymentMethod,
      input.amountPaid,
      input.splitCashAmount,
      input.splitGcashAmount
    );

    const booking: Omit<Booking, "checkInTime" | "updatedAt"> & {
      checkInTime: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      bookingId: bookingRef.id,
      roomId: input.roomId,
      roomNumber: input.roomNumber,
      guestName: input.guestName,
      checkInTime: serverTimestamp(),
      hoursBooked: input.packageHours,
      originalPackageHours: input.packageHours,
      originalPackagePrice: input.packagePrice,
      totalRoomCharge,
      totalFbCharge,
      totalAmount,
      amountPaid: input.amountPaid,
      paymentMethod: input.paymentMethod,
      // Tracked from the first transaction on, regardless of method, so
      // later transactions (extend, checkout) always have an accurate
      // running total to accumulate onto — see paymentBreakdown().
      splitCashAmount: initialSplit.cash,
      splitGcashAmount: initialSplit.gcash,
      paymentStatus: paymentStatusFor(input.amountPaid, totalAmount),
      status: "active",
      items: orderItems,
      cashierId: input.cashierId,
      updatedAt: serverTimestamp(),
      // Optional fields are only included when provided — Firestore rejects
      // `undefined` values outright.
      ...(input.guestPhone ? { guestPhone: input.guestPhone } : {}),
      ...(input.guestCount !== undefined ? { guestCount: input.guestCount } : {}),
      ...(input.specialRequests ? { specialRequests: input.specialRequests } : {}),
      ...(input.gcashReference ? { gcashReference: input.gcashReference } : {}),
    };

    tx.set(bookingRef, booking);
    tx.update(roomRef, { status: "occupied", lastUpdated: serverTimestamp() });
    itemRefs.forEach((ref, i) => {
      tx.update(ref, { quantity: increment(-cartItems[i].quantity), lastUpdated: serverTimestamp() });
    });
  });

  return bookingRef.id;
}

export async function recordCheckout(
  booking: Booking,
  additionalPayment: number
) {
  const firestore = requireDb();
  const newAmountPaid = booking.amountPaid + additionalPayment;
  if (Math.round(newAmountPaid * 100) < Math.round(booking.totalAmount * 100)) {
    throw new Error("Cannot check out until the full amount is paid.");
  }
  // Checkout doesn't ask which method settled the balance — attribute it to
  // the booking's current method, falling back to cash for "split" since
  // there's no ratio to split a single top-up payment by here.
  const priorSplit = paymentBreakdown(booking);
  const thisSplit = methodContribution(
    booking.paymentMethod === "split" ? "cash" : booking.paymentMethod,
    additionalPayment
  );

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "bookings", booking.bookingId), {
    status: "checked_out",
    checkOutTime: serverTimestamp(),
    amountPaid: newAmountPaid,
    splitCashAmount: priorSplit.cash + thisSplit.cash,
    splitGcashAmount: priorSplit.gcash + thisSplit.gcash,
    paymentStatus: paymentStatusFor(newAmountPaid, booking.totalAmount),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, "rooms", booking.roomId), {
    status: "cleaning",
    lastUpdated: serverTimestamp(),
  });
  await batch.commit();
  await resolveCheckoutReminder(booking.bookingId);
}

export async function voidBooking(booking: Booking) {
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "bookings", booking.bookingId), {
    status: "voided",
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, "rooms", booking.roomId), {
    status: "available",
    lastUpdated: serverTimestamp(),
  });
  await batch.commit();
  await resolveCheckoutReminder(booking.bookingId);
}

export async function deleteBooking(bookingId: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "bookings", bookingId));
}

export interface ExtendStayPayment {
  paymentMethod: PaymentMethod;
  gcashReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
}

export async function extendStay(
  booking: Booking,
  packageHours: number,
  packagePrice: number,
  additionalPayment: number,
  payment: ExtendStayPayment
) {
  const firestore = requireDb();
  const newHoursBooked = booking.hoursBooked + packageHours;
  const newTotalRoomCharge = booking.totalRoomCharge + packagePrice;
  const newTotalAmount = newTotalRoomCharge + booking.totalFbCharge;
  const newAmountPaid = booking.amountPaid + additionalPayment;
  const priorSplit = paymentBreakdown(booking);
  const thisSplit = methodContribution(
    payment.paymentMethod,
    additionalPayment,
    payment.splitCashAmount,
    payment.splitGcashAmount
  );

  await updateDoc(doc(firestore, "bookings", booking.bookingId), {
    hoursBooked: newHoursBooked,
    totalRoomCharge: newTotalRoomCharge,
    totalAmount: newTotalAmount,
    amountPaid: newAmountPaid,
    // paymentMethod reflects how the guest most recently settled up — the
    // running cash/GCash totals below are what stay accurate across mixed
    // methods, not this field alone.
    paymentMethod: payment.paymentMethod,
    splitCashAmount: priorSplit.cash + thisSplit.cash,
    splitGcashAmount: priorSplit.gcash + thisSplit.gcash,
    paymentStatus: paymentStatusFor(newAmountPaid, newTotalAmount),
    updatedAt: serverTimestamp(),
    ...(payment.gcashReference ? { gcashReference: payment.gcashReference } : {}),
  });
  // Extending pushes the checkout deadline back out — clear any 30-min-
  // warning/overdue reminder (and its repeating alarm) raised before the
  // extension, otherwise it keeps ringing for a room that now has plenty
  // of time left.
  await resolveCheckoutReminder(booking.bookingId);
}

/**
 * Switches a booking to open time — no fixed end time. No charge is
 * collected here since there's no per-hour rate set yet; the final room
 * charge gets typed in by the cashier at checkout (settleOpenTimeCharge).
 */
export async function convertToOpenTime(bookingId: string) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "bookings", bookingId), {
    openEnded: true,
    updatedAt: serverTimestamp(),
  });
  // Open-ended bookings have no fixed end time — clear any reminder raised
  // before the conversion, same reasoning as extendStay().
  await resolveCheckoutReminder(bookingId);
}

/**
 * Records the cashier's final room-charge judgment call for an open-time
 * stay, and locks in the actual hours stayed for reporting. Called right
 * before recordCheckout() once the cashier has settled on a number.
 */
export async function settleOpenTimeCharge(
  booking: Booking,
  finalRoomCharge: number,
  actualHoursStayed: number
) {
  const firestore = requireDb();
  const newTotalAmount = finalRoomCharge + booking.totalFbCharge;

  await updateDoc(doc(firestore, "bookings", booking.bookingId), {
    hoursBooked: actualHoursStayed,
    totalRoomCharge: finalRoomCharge,
    totalAmount: newTotalAmount,
    paymentStatus: paymentStatusFor(booking.amountPaid, newTotalAmount),
    updatedAt: serverTimestamp(),
  });
}
