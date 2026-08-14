import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Booking, PaymentMethod, PaymentStatus } from "@/lib/types";

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
}

function paymentStatusFor(amountPaid: number, totalAmount: number): PaymentStatus {
  if (amountPaid <= 0) return "unpaid";
  return amountPaid >= totalAmount ? "paid" : "partial";
}

export async function checkIn(input: CheckInInput) {
  const firestore = requireDb();
  const totalRoomCharge = input.hoursBooked * input.ratePerHour;

  const bookingRef = doc(collection(firestore, "bookings"));
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
    totalAmount: totalRoomCharge,
    amountPaid: input.amountPaid,
    paymentMethod: input.paymentMethod,
    paymentStatus: paymentStatusFor(input.amountPaid, totalRoomCharge),
    status: "active",
    cashierId: input.cashierId,
    updatedAt: serverTimestamp(),
    // Optional fields are only included when provided — Firestore rejects
    // `undefined` values outright.
    ...(input.guestPhone ? { guestPhone: input.guestPhone } : {}),
    ...(input.guestCount !== undefined ? { guestCount: input.guestCount } : {}),
    ...(input.specialRequests ? { specialRequests: input.specialRequests } : {}),
  };

  const roomRef = doc(firestore, "rooms", input.roomId);

  const batch = writeBatch(firestore);
  batch.set(bookingRef, booking);
  batch.update(roomRef, { status: "occupied", lastUpdated: serverTimestamp() });
  await batch.commit();

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
