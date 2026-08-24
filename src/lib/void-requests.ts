import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AppNotification, Booking, VoidRequest } from "@/lib/types";
import { resolveCheckoutReminder } from "@/lib/notifications";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface VoidRequestActor {
  uid: string;
  name: string;
}

export interface CreateVoidRequestInput {
  booking: Booking;
  reason: string;
  requestedBy: string;
  requestedByName: string;
}

/**
 * Writes the voidRequests doc + a paired "void_request" notification in one
 * batch. The notification ID is keyed off the *request*, not the booking —
 * a booking can accumulate more than one request over time if an earlier
 * one gets denied, so it can't reuse the checkout-reminder/low-stock
 * per-subject-ID pattern.
 */
export async function createVoidRequest(input: CreateVoidRequestInput): Promise<string> {
  const firestore = requireDb();
  const { booking } = input;
  const requestRef = doc(collection(firestore, "voidRequests"));
  const notificationRef = doc(firestore, "notifications", `void-request-${requestRef.id}`);

  const request: Omit<VoidRequest, "requestedAt"> & {
    requestedAt: ReturnType<typeof serverTimestamp>;
  } = {
    voidRequestId: requestRef.id,
    bookingId: booking.bookingId,
    roomId: booking.roomId,
    roomNumber: booking.roomNumber,
    guestName: booking.guestName,
    totalAmount: booking.totalAmount,
    amountPaid: booking.amountPaid,
    checkInTime: booking.checkInTime,
    reason: input.reason,
    status: "pending",
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    requestedAt: serverTimestamp(),
  };

  const notification: Omit<AppNotification, "createdAt"> & {
    createdAt: ReturnType<typeof serverTimestamp>;
  } = {
    notificationId: notificationRef.id,
    type: "void_request",
    message: `Room ${booking.roomNumber} — ${booking.guestName}'s void request needs approval.`,
    roomId: booking.roomId,
    roomNumber: booking.roomNumber,
    bookingId: booking.bookingId,
    voidRequestId: requestRef.id,
    createdAt: serverTimestamp(),
    resolved: false,
    readBy: [],
  };

  const batch = writeBatch(firestore);
  batch.set(requestRef, request);
  batch.set(notificationRef, notification);
  await batch.commit();

  return requestRef.id;
}

export function subscribeToPendingVoidRequests(
  onChange: (byBookingId: Map<string, VoidRequest>) => void
) {
  const firestore = requireDb();
  const q = query(collection(firestore, "voidRequests"), where("status", "==", "pending"));
  return onSnapshot(q, (snapshot) => {
    const byBookingId = new Map<string, VoidRequest>();
    for (const docSnap of snapshot.docs) {
      const request = docSnap.data({ serverTimestamps: "estimate" }) as VoidRequest;
      byBookingId.set(request.bookingId, request);
    }
    onChange(byBookingId);
  });
}

async function resolveVoidRequestNotification(voidRequestId: string) {
  try {
    const firestore = requireDb();
    await updateDoc(doc(firestore, "notifications", `void-request-${voidRequestId}`), {
      resolved: true,
    });
  } catch {
    // Best-effort — the void request itself already resolved successfully.
  }
}

/**
 * Re-reads the live booking inside the transaction — it may have been
 * checked out (or voided some other way) between the request being filed
 * and the owner approving it. Refuses cleanly rather than corrupting state;
 * the owner should deny the stale request instead.
 */
export async function approveVoidRequest(request: VoidRequest, actor: VoidRequestActor) {
  const firestore = requireDb();
  const requestRef = doc(firestore, "voidRequests", request.voidRequestId);
  const bookingRef = doc(firestore, "bookings", request.bookingId);
  const roomRef = doc(firestore, "rooms", request.roomId);

  await runTransaction(firestore, async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists() || (bookingSnap.data() as Booking).status !== "active") {
      throw new Error(
        "This booking was already checked out or voided — deny this request instead."
      );
    }

    tx.update(bookingRef, { status: "voided", updatedAt: serverTimestamp() });
    tx.update(roomRef, { status: "available", lastUpdated: serverTimestamp() });
    tx.update(requestRef, {
      status: "approved",
      resolvedBy: actor.uid,
      resolvedByName: actor.name,
      resolvedAt: serverTimestamp(),
    });
  });

  await resolveVoidRequestNotification(request.voidRequestId);
  try {
    await resolveCheckoutReminder(request.bookingId);
  } catch {
    // The void already succeeded; don't fail this action over the reminder doc.
  }
}

export async function denyVoidRequest(
  request: VoidRequest,
  actor: VoidRequestActor,
  note?: string
) {
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "voidRequests", request.voidRequestId), {
    status: "denied",
    resolvedBy: actor.uid,
    resolvedByName: actor.name,
    resolvedAt: serverTimestamp(),
    ...(note ? { resolutionNote: note } : {}),
  });
  await batch.commit();
  await resolveVoidRequestNotification(request.voidRequestId);
}
