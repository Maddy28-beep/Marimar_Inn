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
  // True for a guest who chooses "open time" right at check-in instead of a
  // fixed package — the package above still applies as a paid floor (same
  // math as converting an active booking via extendStay's Open time mode),
  // just starting from the very first transaction instead of a later one.
  openEnded?: boolean;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  gcashReference?: string;
  qrphReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
  specialRequests?: string;
  cashierId: string;
  cartItems?: CheckInCartLine[];
}

function paymentStatusFor(amountPaid: number, totalAmount: number): PaymentStatus {
  if (amountPaid <= 0) return "unpaid";
  return amountPaid >= totalAmount ? "paid" : "partial";
}

export interface PaymentPortions {
  cash: number;
  gcash: number;
  qrph: number;
}

/**
 * A booking can be paid across several transactions (check-in, extend,
 * checkout) that each pick their own method — split*Amount fields track
 * the running cash / GCash / QRPh total across all of them. Falls back to
 * inferring the breakdown from paymentMethod + amountPaid for bookings
 * written before these fields existed.
 */
export function paymentBreakdown(
  booking: Pick<
    Booking,
    | "paymentMethod"
    | "amountPaid"
    | "splitCashAmount"
    | "splitGcashAmount"
    | "splitQrphAmount"
  >
): PaymentPortions {
  if (
    booking.splitCashAmount !== undefined ||
    booking.splitGcashAmount !== undefined ||
    booking.splitQrphAmount !== undefined
  ) {
    return {
      cash: booking.splitCashAmount ?? 0,
      gcash: booking.splitGcashAmount ?? 0,
      qrph: booking.splitQrphAmount ?? 0,
    };
  }
  if (booking.paymentMethod === "gcash") return { cash: 0, gcash: booking.amountPaid, qrph: 0 };
  if (booking.paymentMethod === "qrph") return { cash: 0, gcash: 0, qrph: booking.amountPaid };
  return { cash: booking.amountPaid, gcash: 0, qrph: 0 };
}

export function methodContribution(
  method: PaymentMethod,
  amount: number,
  split?: Partial<PaymentPortions>
): PaymentPortions {
  if (method === "gcash") return { cash: 0, gcash: amount, qrph: 0 };
  if (method === "qrph") return { cash: 0, gcash: 0, qrph: amount };
  if (method === "split") {
    return {
      cash: split?.cash ?? 0,
      gcash: split?.gcash ?? 0,
      qrph: split?.qrph ?? 0,
    };
  }
  return { cash: amount, gcash: 0, qrph: 0 };
}

export function paymentPortionLines(portions: PaymentPortions): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = [];
  if (portions.cash > 0) lines.push({ label: "Cash", amount: portions.cash });
  if (portions.gcash > 0) lines.push({ label: "GCash", amount: portions.gcash });
  if (portions.qrph > 0) lines.push({ label: "QRPh", amount: portions.qrph });
  return lines;
}

/** Open-time rate: ₱100/hour, billed in 30-minute blocks rounded up. */
export const OPEN_TIME_RATE_PER_HOUR = 100;

/**
 * Past this much overdue, +1 hour / open-time is blocked — the extra hour
 * would undercharge a guest who's already been gone a while, so they check
 * out and book the regular 3h minimum again. The Owner is flagged at the
 * same cutoff.
 */
export const EXTEND_OVERDUE_CUTOFF_MINUTES = 10;
export const EXTEND_OVERDUE_CUTOFF_HOURS = EXTEND_OVERDUE_CUTOFF_MINUTES / 60;
export const REGULAR_BOOKING_MIN_HOURS = 3;
export const VOID_BOOKING_WINDOW_MINUTES = 5;

export function isTooOverdueToExtend(booking: Pick<Booking, "hoursBooked" | "checkInTime" | "openEnded">, now: Date): boolean {
  if (booking.openEnded) return false;
  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  return remaining <= -EXTEND_OVERDUE_CUTOFF_HOURS;
}

export function canVoidBooking(booking: Pick<Booking, "checkInTime">, now: Date): boolean {
  return hoursElapsed(booking.checkInTime, now) * 60 <= VOID_BOOKING_WINDOW_MINUTES;
}

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
    const initialSplit = methodContribution(input.paymentMethod, input.amountPaid, {
      cash: input.splitCashAmount,
      gcash: input.splitGcashAmount,
      qrph: input.splitQrphAmount,
    });

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
      splitQrphAmount: initialSplit.qrph,
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
      ...(input.qrphReference ? { qrphReference: input.qrphReference } : {}),
      ...(input.openEnded ? { openEnded: true } : {}),
    };

    tx.set(bookingRef, booking);
    tx.update(roomRef, { status: "occupied", lastUpdated: serverTimestamp() });
    itemRefs.forEach((ref, i) => {
      tx.update(ref, { quantity: increment(-cartItems[i].quantity), lastUpdated: serverTimestamp() });
    });
  });

  return bookingRef.id;
}

function runningSplitUpdates(booking: Booking, extra: PaymentPortions) {
  const prior = paymentBreakdown(booking);
  const updates: {
    splitCashAmount: number;
    splitGcashAmount: number;
    splitQrphAmount?: number;
  } = {
    splitCashAmount: prior.cash + extra.cash,
    splitGcashAmount: prior.gcash + extra.gcash,
  };
  // Avoid adding splitQrphAmount to older bookings unless QRPh was actually
  // used — older Firestore rules reject that new field and block checkout.
  const nextQrph = prior.qrph + extra.qrph;
  if (booking.splitQrphAmount !== undefined || nextQrph > 0) {
    updates.splitQrphAmount = nextQrph;
  }
  return updates;
}

async function clearCheckoutReminder(bookingId: string) {
  try {
    await resolveCheckoutReminder(bookingId);
  } catch {
    // The booking write already succeeded; don't fail the front-desk action
    // because the reminder doc couldn't be marked resolved.
  }
}

export async function recordCheckout(
  booking: Booking,
  additionalPayment: number,
  payment?: ExtendStayPayment,
  openTime?: { finalRoomCharge: number; actualHoursStayed: number }
) {
  const firestore = requireDb();
  const totalRoomCharge = openTime?.finalRoomCharge ?? booking.totalRoomCharge;
  const totalAmount = totalRoomCharge + booking.totalFbCharge;
  const newAmountPaid = booking.amountPaid + additionalPayment;
  if (Math.round(newAmountPaid * 100) < Math.round(totalAmount * 100)) {
    throw new Error("Collect the remaining balance before checking out.");
  }
  const thisSplit =
    additionalPayment > 0
      ? methodContribution(payment?.paymentMethod ?? "cash", additionalPayment, {
          cash: payment?.splitCashAmount,
          gcash: payment?.splitGcashAmount,
          qrph: payment?.splitQrphAmount,
        })
      : { cash: 0, gcash: 0, qrph: 0 };

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "bookings", booking.bookingId), {
    status: "checked_out",
    checkOutTime: serverTimestamp(),
    amountPaid: newAmountPaid,
    ...runningSplitUpdates(booking, thisSplit),
    paymentStatus: paymentStatusFor(newAmountPaid, totalAmount),
    updatedAt: serverTimestamp(),
    ...(openTime
      ? {
          hoursBooked: openTime.actualHoursStayed,
          totalRoomCharge,
          totalAmount,
        }
      : {}),
    ...(additionalPayment > 0 && payment?.paymentMethod
      ? { paymentMethod: payment.paymentMethod }
      : {}),
    ...(payment?.gcashReference ? { gcashReference: payment.gcashReference } : {}),
    ...(payment?.qrphReference ? { qrphReference: payment.qrphReference } : {}),
  });
  batch.update(doc(firestore, "rooms", booking.roomId), {
    status: "cleaning",
    lastUpdated: serverTimestamp(),
  });
  await batch.commit();
  await clearCheckoutReminder(booking.bookingId);
}

export async function voidBooking(booking: Booking) {
  if (!canVoidBooking(booking, new Date())) {
    throw new Error("Cancel is only allowed in the first 5 minutes. Check out instead.");
  }
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
  await clearCheckoutReminder(booking.bookingId);
}

export async function deleteBooking(bookingId: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "bookings", bookingId));
}

export interface ExtendStayPayment {
  paymentMethod: PaymentMethod;
  gcashReference?: string;
  qrphReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
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
  const thisSplit = methodContribution(payment.paymentMethod, additionalPayment, {
    cash: payment.splitCashAmount,
    gcash: payment.splitGcashAmount,
    qrph: payment.splitQrphAmount,
  });

  await updateDoc(doc(firestore, "bookings", booking.bookingId), {
    hoursBooked: newHoursBooked,
    totalRoomCharge: newTotalRoomCharge,
    totalAmount: newTotalAmount,
    amountPaid: newAmountPaid,
    // paymentMethod reflects how the guest most recently settled up — the
    // running cash/GCash/QRPh totals below are what stay accurate across mixed
    // methods, not this field alone.
    paymentMethod: payment.paymentMethod,
    ...runningSplitUpdates(booking, thisSplit),
    paymentStatus: paymentStatusFor(newAmountPaid, newTotalAmount),
    updatedAt: serverTimestamp(),
    ...(payment.gcashReference ? { gcashReference: payment.gcashReference } : {}),
    ...(payment.qrphReference ? { qrphReference: payment.qrphReference } : {}),
  });
  // Extending pushes the checkout deadline back out — clear any 30-min-
  // warning/overdue reminder (and its repeating alarm) raised before the
  // extension, otherwise it keeps ringing for a room that now has plenty
  // of time left.
  await clearCheckoutReminder(booking.bookingId);
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
  await clearCheckoutReminder(bookingId);
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
