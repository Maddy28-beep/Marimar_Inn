import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking, InventoryItem, OrderItem, PaymentMethod, PaymentStatus } from "@/lib/types";

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
  hoursBooked: number;
  ratePerHour: number;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  specialRequests?: string;
  cashierId: string;
  cartItems?: CheckInCartLine[];
}

function paymentStatusFor(amountPaid: number, totalAmount: number): PaymentStatus {
  if (amountPaid <= 0) return "unpaid";
  return amountPaid >= totalAmount ? "paid" : "partial";
}

export async function checkIn(input: CheckInInput) {
  const firestore = requireDb();
  const totalRoomCharge = input.hoursBooked * input.ratePerHour;
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

    const booking: Omit<Booking, "checkInTime" | "updatedAt"> & {
      checkInTime: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      bookingId: bookingRef.id,
      roomId: input.roomId,
      roomNumber: input.roomNumber,
      guestName: input.guestName,
      checkInTime: serverTimestamp(),
      hoursBooked: input.hoursBooked,
      totalRoomCharge,
      totalFbCharge,
      totalAmount,
      amountPaid: input.amountPaid,
      paymentMethod: input.paymentMethod,
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

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "bookings", booking.bookingId), {
    status: "checked_out",
    checkOutTime: serverTimestamp(),
    amountPaid: newAmountPaid,
    paymentStatus: paymentStatusFor(newAmountPaid, booking.totalAmount),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, "rooms", booking.roomId), {
    status: "cleaning",
    lastUpdated: serverTimestamp(),
  });
  await batch.commit();
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
}

export async function deleteBooking(bookingId: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "bookings", bookingId));
}

export function hoursElapsed(checkInTime: Timestamp | null, now: Date): number {
  // checkInTime can be transiently null: a serverTimestamp() write hasn't
  // round-tripped to the server yet, so the local snapshot has no value for
  // it even with `serverTimestamps: "estimate"` on the very first tick.
  if (!checkInTime) return 0;
  return (now.getTime() - checkInTime.toMillis()) / (1000 * 60 * 60);
}
