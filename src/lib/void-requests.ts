import {
  collection,
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
import type { AppNotification, Booking, InventoryItem, OrderItem, UserRole, VoidRequest } from "@/lib/types";
import { resolveCheckoutReminder, syncLowStockNotification } from "@/lib/notifications";

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
  requestedByRole?: UserRole;
}

export interface CreateOrderItemVoidRequestInput {
  booking: Booking;
  item: OrderItem;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedByRole?: UserRole;
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
    ...(input.requestedByRole ? { requestedByRole: input.requestedByRole } : {}),
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

/**
 * Same shape as createVoidRequest, but for one already-paid-for order item
 * a cashier added by mistake — used when there's no unpaid balance left to
 * cover it (a free self-remove would otherwise apply, see room-detail-dialog).
 */
export async function createOrderItemVoidRequest(input: CreateOrderItemVoidRequestInput): Promise<string> {
  const firestore = requireDb();
  const { booking, item } = input;
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
    target: "order_item",
    totalAmount: booking.totalAmount,
    amountPaid: booking.amountPaid,
    checkInTime: booking.checkInTime,
    itemId: item.itemId,
    itemName: item.name,
    itemQuantity: item.quantity,
    itemSubtotal: item.subtotal,
    reason: input.reason,
    status: "pending",
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    ...(input.requestedByRole ? { requestedByRole: input.requestedByRole } : {}),
    requestedAt: serverTimestamp(),
  };

  const notification: Omit<AppNotification, "createdAt"> & {
    createdAt: ReturnType<typeof serverTimestamp>;
  } = {
    notificationId: notificationRef.id,
    type: "void_request",
    message: `Room ${booking.roomNumber} — remove ${item.quantity}× ${item.name} (₱${item.subtotal.toFixed(2)}, already paid) needs approval.`,
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

/**
 * Keyed by bookingId -> every pending request for that booking. A booking
 * can have at most one pending "booking" void request, but can also have
 * one pending "order_item" request per mistakenly-added paid item at the
 * same time — a single request per booking isn't enough to represent that.
 */
export function subscribeToPendingVoidRequests(
  onChange: (byBookingId: Map<string, VoidRequest[]>) => void
) {
  const firestore = requireDb();
  const q = query(collection(firestore, "voidRequests"), where("status", "==", "pending"));
  return onSnapshot(q, (snapshot) => {
    const byBookingId = new Map<string, VoidRequest[]>();
    for (const docSnap of snapshot.docs) {
      const request = docSnap.data({ serverTimestamps: "estimate" }) as VoidRequest;
      const existing = byBookingId.get(request.bookingId) ?? [];
      existing.push(request);
      byBookingId.set(request.bookingId, existing);
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
  if (request.target === "order_item") {
    await approveOrderItemVoidRequest(request, actor);
    return;
  }

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

/**
 * Approving an order_item request removes that one line item — same
 * transaction shape as orders.ts's removeOrderItem (restock inventory
 * unless the item is unlimited, recalc totals), plus resolving the
 * request itself. Doesn't touch amountPaid: the item was already paid
 * for, so removing it intentionally leaves the booking looking "overpaid"
 * by that amount — a visible signal that cash is owed back to the guest,
 * same as the existing owner-initiated removeOrderItem already behaves.
 */
async function approveOrderItemVoidRequest(request: VoidRequest, actor: VoidRequestActor) {
  const firestore = requireDb();
  const requestRef = doc(firestore, "voidRequests", request.voidRequestId);
  const bookingRef = doc(firestore, "bookings", request.bookingId);
  const itemId = request.itemId;
  if (!itemId) throw new Error("This request is missing its item — deny it instead.");
  const itemRef = doc(firestore, "inventory", itemId);
  let resultingItem: InventoryItem | null = null;

  await runTransaction(firestore, async (tx) => {
    const [bookingSnap, itemSnap] = await Promise.all([tx.get(bookingRef), tx.get(itemRef)]);
    if (!bookingSnap.exists() || (bookingSnap.data() as Booking).status !== "active") {
      throw new Error(
        "This booking was already checked out or voided — deny this request instead."
      );
    }

    const booking = bookingSnap.data() as Booking;
    const existing = (booking.items ?? []).find((line) => line.itemId === itemId);
    if (!existing) {
      throw new Error("That item is no longer on the booking — deny this request instead.");
    }

    const items = (booking.items ?? []).filter((line) => line.itemId !== itemId);
    const totalFbCharge = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totalAmount = booking.totalRoomCharge + totalFbCharge;
    const isUnlimited = itemSnap.exists() && (itemSnap.data() as InventoryItem).unlimited;

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
    tx.update(requestRef, {
      status: "approved",
      resolvedBy: actor.uid,
      resolvedByName: actor.name,
      resolvedAt: serverTimestamp(),
    });

    if (itemSnap.exists()) {
      const item = itemSnap.data() as InventoryItem;
      resultingItem = { ...item, quantity: item.quantity + existing.quantity };
    }
  });

  if (resultingItem) await syncLowStockNotification(resultingItem);
  await resolveVoidRequestNotification(request.voidRequestId);
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
