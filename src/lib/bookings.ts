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
import type { Booking, InventoryItem, OrderItem, PaymentMethod, PaymentStatus, UserRole } from "@/lib/types";
import {
  AMENITY_BLANKET_ID,
  AMENITY_TOWEL_ID,
  BLANKET_FEE,
  EXTRA_PERSON_FEE,
  TOWEL_FEE,
} from "@/lib/types";
import { hoursElapsed } from "@/lib/time";
import { resolveCheckoutReminder, syncLowStockNotification } from "@/lib/notifications";
import { recordTransaction } from "@/lib/transactions";

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
  cashierName?: string;
  cashierRole?: UserRole;
  cartItems?: CheckInCartLine[];
  extraPersonCount?: number;
  towelCount?: number;
  blanketCount?: number;
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
export const VOID_BOOKING_WINDOW_MINUTES = 7;

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

function amenityLineItems(towels: number, blankets: number): OrderItem[] {
  const items: OrderItem[] = [];
  if (towels > 0) {
    items.push({
      itemId: AMENITY_TOWEL_ID,
      name: "Towel",
      unitPrice: TOWEL_FEE,
      quantity: towels,
      subtotal: towels * TOWEL_FEE,
    });
  }
  if (blankets > 0) {
    items.push({
      itemId: AMENITY_BLANKET_ID,
      name: "Blanket",
      unitPrice: BLANKET_FEE,
      quantity: blankets,
      subtotal: blankets * BLANKET_FEE,
    });
  }
  return items;
}

export async function checkIn(input: CheckInInput) {
  const firestore = requireDb();
  const extraPersonCount = Math.max(0, Math.floor(input.extraPersonCount ?? 0));
  const towelCount = Math.max(0, Math.floor(input.towelCount ?? 0));
  const blanketCount = Math.max(0, Math.floor(input.blanketCount ?? 0));
  const totalRoomCharge = input.packagePrice + extraPersonCount * EXTRA_PERSON_FEE;
  const cartItems = input.cartItems ?? [];

  const bookingRef = doc(collection(firestore, "bookings"));
  const roomRef = doc(firestore, "rooms", input.roomId);
  const itemRefs = cartItems.map((line) => doc(firestore, "inventory", line.itemId));

  await runTransaction(firestore, async (tx) => {
    // All reads must happen before any writes in a Firestore transaction.
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)));

    const orderItems: OrderItem[] = [
      ...cartItems.map((line, i) => {
      const snap = itemSnaps[i];
      if (!snap.exists()) throw new Error("An item in the order no longer exists.");
      const data = snap.data() as InventoryItem;
      if (!data.unlimited && data.quantity < line.quantity) {
        throw new Error(`Only ${data.quantity} ${data.name} left in stock.`);
      }
      return {
        itemId: line.itemId,
        name: data.name,
        unitPrice: data.sellingPrice,
        quantity: line.quantity,
        subtotal: line.quantity * data.sellingPrice,
      };
      }),
      ...amenityLineItems(towelCount, blanketCount),
    ];

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
      ...(input.cashierName ? { cashierName: input.cashierName } : {}),
      ...(input.cashierRole ? { cashierRole: input.cashierRole } : {}),
      ...(extraPersonCount > 0 ? { extraPersonCount } : {}),
      ...(towelCount > 0 ? { towelCount } : {}),
      ...(blanketCount > 0 ? { blanketCount } : {}),
    };

    tx.set(bookingRef, booking);
    tx.update(roomRef, { status: "occupied", lastUpdated: serverTimestamp() });
    itemRefs.forEach((ref, i) => {
      // An unlimited item's quantity is never tracked, so never decrement it.
      if ((itemSnaps[i].data() as InventoryItem | undefined)?.unlimited) return;
      tx.update(ref, { quantity: increment(-cartItems[i].quantity), lastUpdated: serverTimestamp() });
    });
    await recordTransaction(
      {
        type: "checkin",
        bookingId: bookingRef.id,
        roomNumber: input.roomNumber,
        amount: input.amountPaid,
        cashAmount: initialSplit.cash,
        gcashAmount: initialSplit.gcash,
        qrphAmount: initialSplit.qrph,
        cashierId: input.cashierId,
        cashierName: input.cashierName ?? "Staff",
      },
      tx
    );
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

export interface TransactionActor {
  uid: string;
  name: string;
}

export async function recordCheckout(
  booking: Booking,
  additionalPayment: number,
  actor: TransactionActor,
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
  await recordTransaction({
    type: "checkout",
    bookingId: booking.bookingId,
    roomNumber: booking.roomNumber,
    amount: additionalPayment,
    cashAmount: thisSplit.cash,
    gcashAmount: thisSplit.gcash,
    qrphAmount: thisSplit.qrph,
    cashierId: actor.uid,
    cashierName: actor.name,
  });
}

export async function voidBooking(booking: Booking, opts?: { bypassWindow?: boolean }) {
  if (!opts?.bypassWindow && !canVoidBooking(booking, new Date())) {
    throw new Error("Cancel is only allowed in the first 7 minutes. Check out instead.");
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
  payment: ExtendStayPayment,
  actor: TransactionActor
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
  await recordTransaction({
    type: "extend",
    bookingId: booking.bookingId,
    roomNumber: booking.roomNumber,
    amount: additionalPayment,
    cashAmount: thisSplit.cash,
    gcashAmount: thisSplit.gcash,
    qrphAmount: thisSplit.qrph,
    cashierId: actor.uid,
    cashierName: actor.name,
  });
}

/**
 * Adds store items to an active booking and — unlike the old fire-and-
 * forget addOrderItem in orders.ts — collects payment for them right then,
 * the same way extendStay() collects payment for the extra hours. Before
 * this, a mid-stay order just raised the booking's totalAmount with no way
 * to charge for it until checkout, forcing the cashier to remember and the
 * guest to wait. Partial payment is allowed (mirrors extendStay) — anything
 * short of the order's cost just adds to the balance due at checkout.
 */
export async function addOrderToBooking(
  booking: Booking,
  cartItems: CheckInCartLine[],
  amountPaid: number,
  payment: ExtendStayPayment,
  actor: TransactionActor
): Promise<{ items: OrderItem[]; cartTotal: number; amountCollected: number }> {
  if (cartItems.length === 0) throw new Error("Add at least one item.");
  const firestore = requireDb();
  const bookingRef = doc(firestore, "bookings", booking.bookingId);
  const itemRefs = cartItems.map((line) => doc(firestore, "inventory", line.itemId));

  let resultItems: OrderItem[] = [];
  let cartTotal = 0;
  let amountCollected = 0;
  const lowStockCandidates: InventoryItem[] = [];

  await runTransaction(firestore, async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)));
    if (!bookingSnap.exists()) throw new Error("Booking not found.");
    const liveBooking = bookingSnap.data() as Booking;
    if (liveBooking.status !== "active") throw new Error("This booking is no longer active.");

    const items = [...(liveBooking.items ?? [])];
    cartTotal = 0;
    cartItems.forEach((line, i) => {
      const snap = itemSnaps[i];
      if (!snap.exists()) throw new Error("An item in the order no longer exists.");
      const data = snap.data() as InventoryItem;
      if (!data.unlimited && data.quantity < line.quantity) {
        throw new Error(`Only ${data.quantity} ${data.name} left in stock.`);
      }
      const subtotal = line.quantity * data.sellingPrice;
      cartTotal += subtotal;
      const existingIndex = items.findIndex((existing) => existing.itemId === line.itemId);
      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        const newQuantity = existing.quantity + line.quantity;
        items[existingIndex] = {
          ...existing,
          quantity: newQuantity,
          subtotal: newQuantity * existing.unitPrice,
        };
      } else {
        items.push({
          itemId: line.itemId,
          name: data.name,
          unitPrice: data.sellingPrice,
          quantity: line.quantity,
          subtotal,
        });
      }
      if (!data.unlimited) {
        lowStockCandidates.push({ ...data, quantity: data.quantity - line.quantity });
      }
    });

    const totalFbCharge = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totalAmount = liveBooking.totalRoomCharge + totalFbCharge;
    amountCollected = Math.max(0, Math.min(amountPaid, cartTotal));
    const newAmountPaid = liveBooking.amountPaid + amountCollected;
    const thisSplit =
      amountCollected > 0
        ? methodContribution(payment.paymentMethod, amountCollected, {
            cash: payment.splitCashAmount,
            gcash: payment.splitGcashAmount,
            qrph: payment.splitQrphAmount,
          })
        : { cash: 0, gcash: 0, qrph: 0 };

    tx.update(bookingRef, {
      items,
      totalFbCharge,
      totalAmount,
      amountPaid: newAmountPaid,
      ...(amountCollected > 0 ? { paymentMethod: payment.paymentMethod } : {}),
      ...runningSplitUpdates(liveBooking, thisSplit),
      paymentStatus: paymentStatusFor(newAmountPaid, totalAmount),
      updatedAt: serverTimestamp(),
      ...(payment.gcashReference ? { gcashReference: payment.gcashReference } : {}),
      ...(payment.qrphReference ? { qrphReference: payment.qrphReference } : {}),
    });

    itemRefs.forEach((ref, i) => {
      // An unlimited item's quantity is never tracked, so never decrement it.
      if ((itemSnaps[i].data() as InventoryItem | undefined)?.unlimited) return;
      tx.update(ref, { quantity: increment(-cartItems[i].quantity), lastUpdated: serverTimestamp() });
    });

    resultItems = items;

    await recordTransaction(
      {
        type: "order",
        bookingId: booking.bookingId,
        roomNumber: booking.roomNumber,
        amount: amountCollected,
        cashAmount: thisSplit.cash,
        gcashAmount: thisSplit.gcash,
        qrphAmount: thisSplit.qrph,
        cashierId: actor.uid,
        cashierName: actor.name,
      },
      tx
    );
  });

  await Promise.all(lowStockCandidates.map((item) => syncLowStockNotification(item)));

  return { items: resultItems, cartTotal, amountCollected };
}

/**
 * Collects payment toward an existing outstanding balance — e.g. a guest
 * who paid partially at check-in, or skipped payment on a mid-stay order,
 * now wants to settle up before checkout. Unlike addOrderToBooking, there's
 * nothing new being added here, just money changing hands against the
 * booking's current totalAmount, so it's logged as its own "payment"
 * transaction type rather than "order".
 */
export async function collectBalance(
  booking: Booking,
  amountPaid: number,
  payment: ExtendStayPayment,
  actor: TransactionActor
): Promise<{ balance: number; amountCollected: number }> {
  const firestore = requireDb();
  const bookingRef = doc(firestore, "bookings", booking.bookingId);

  let balance = 0;
  let amountCollected = 0;

  await runTransaction(firestore, async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists()) throw new Error("Booking not found.");
    const liveBooking = bookingSnap.data() as Booking;
    if (liveBooking.status !== "active") throw new Error("This booking is no longer active.");

    balance = Math.max(0, liveBooking.totalAmount - liveBooking.amountPaid);
    amountCollected = Math.max(0, Math.min(amountPaid, balance));
    if (amountCollected <= 0) throw new Error("There's no balance left to collect.");

    const newAmountPaid = liveBooking.amountPaid + amountCollected;
    const thisSplit = methodContribution(payment.paymentMethod, amountCollected, {
      cash: payment.splitCashAmount,
      gcash: payment.splitGcashAmount,
      qrph: payment.splitQrphAmount,
    });

    tx.update(bookingRef, {
      amountPaid: newAmountPaid,
      paymentMethod: payment.paymentMethod,
      ...runningSplitUpdates(liveBooking, thisSplit),
      paymentStatus: paymentStatusFor(newAmountPaid, liveBooking.totalAmount),
      updatedAt: serverTimestamp(),
      ...(payment.gcashReference ? { gcashReference: payment.gcashReference } : {}),
      ...(payment.qrphReference ? { qrphReference: payment.qrphReference } : {}),
    });

    await recordTransaction(
      {
        type: "payment",
        bookingId: booking.bookingId,
        roomNumber: booking.roomNumber,
        amount: amountCollected,
        cashAmount: thisSplit.cash,
        gcashAmount: thisSplit.gcash,
        qrphAmount: thisSplit.qrph,
        cashierId: actor.uid,
        cashierName: actor.name,
      },
      tx
    );
  });

  return { balance: balance - amountCollected, amountCollected };
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
