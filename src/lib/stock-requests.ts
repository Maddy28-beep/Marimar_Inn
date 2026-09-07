import {
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AppNotification, InventoryItem, StockRequest, UserRole } from "@/lib/types";
import { syncLowStockNotification } from "@/lib/notifications";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface StockRequestActor {
  uid: string;
  name: string;
}

export interface CreateStockRequestInput {
  item: InventoryItem;
  quantity: number;
  reason?: string;
  requestedBy: string;
  requestedByName: string;
  requestedByRole?: UserRole;
}

/**
 * Writes the stockRequests doc + a paired "stock_request" notification in
 * one batch — same shape as createVoidRequest. Inventory quantity is
 * untouched here; it only changes once an owner/admin approves.
 */
export async function createStockRequest(input: CreateStockRequestInput): Promise<string> {
  const firestore = requireDb();
  const { item } = input;
  const requestRef = doc(collection(firestore, "stockRequests"));
  const notificationRef = doc(firestore, "notifications", `stock-request-${requestRef.id}`);

  const request: Omit<StockRequest, "requestedAt"> & {
    requestedAt: ReturnType<typeof serverTimestamp>;
  } = {
    stockRequestId: requestRef.id,
    itemId: item.itemId,
    itemName: item.name,
    category: item.category,
    quantity: input.quantity,
    ...(input.reason ? { reason: input.reason } : {}),
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
    type: "stock_request",
    message: `Add ${input.quantity}× ${item.name} to inventory needs approval.`,
    itemId: item.itemId,
    itemName: item.name,
    stockRequestId: requestRef.id,
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

export function subscribeToPendingStockRequests(onChange: (requests: StockRequest[]) => void) {
  const firestore = requireDb();
  const q = query(collection(firestore, "stockRequests"), where("status", "==", "pending"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(
      (d) => d.data({ serverTimestamps: "estimate" }) as StockRequest
    );
    list.sort((a, b) => (a.requestedAt?.toMillis() ?? 0) - (b.requestedAt?.toMillis() ?? 0));
    onChange(list);
  });
}

async function resolveStockRequestNotification(stockRequestId: string) {
  try {
    const firestore = requireDb();
    await updateDoc(doc(firestore, "notifications", `stock-request-${stockRequestId}`), {
      resolved: true,
    });
  } catch {
    // Best-effort — the stock request itself already resolved successfully.
  }
}

/**
 * getDoc + writeBatch (not runTransaction) — same offline-safety reasoning
 * as approveVoidRequest(): a request can sit pending for a while, and this
 * app runs on a single tablet with no concurrent writer to actually race
 * against, so "last-synced" instead of "guaranteed live" stock is an
 * accepted tradeoff here too.
 */
export async function approveStockRequest(request: StockRequest, actor: StockRequestActor) {
  const firestore = requireDb();
  const requestRef = doc(firestore, "stockRequests", request.stockRequestId);
  const itemRef = doc(firestore, "inventory", request.itemId);

  const itemSnap = await getDoc(itemRef);
  if (!itemSnap.exists()) {
    throw new Error("That item no longer exists — deny this request instead.");
  }
  const item = itemSnap.data() as InventoryItem;

  const batch = writeBatch(firestore);
  batch.update(itemRef, {
    quantity: increment(request.quantity),
    lastUpdated: serverTimestamp(),
  });
  batch.update(requestRef, {
    status: "approved",
    resolvedBy: actor.uid,
    resolvedByName: actor.name,
    resolvedAt: serverTimestamp(),
  });
  await batch.commit();

  await syncLowStockNotification({ ...item, quantity: item.quantity + request.quantity });
  await resolveStockRequestNotification(request.stockRequestId);
}

export async function denyStockRequest(
  request: StockRequest,
  actor: StockRequestActor,
  note?: string
) {
  const firestore = requireDb();
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "stockRequests", request.stockRequestId), {
    status: "denied",
    resolvedBy: actor.uid,
    resolvedByName: actor.name,
    resolvedAt: serverTimestamp(),
    ...(note ? { resolutionNote: note } : {}),
  });
  await batch.commit();
  await resolveStockRequestNotification(request.stockRequestId);
}
