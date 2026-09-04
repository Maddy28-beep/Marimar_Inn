import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Transaction, TransactionType, UserRole } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface RecordTransactionInput {
  type: TransactionType;
  bookingId: string;
  roomNumber: string;
  amount: number;
  cashAmount: number;
  gcashAmount: number;
  qrphAmount: number;
  cashierId: string;
  cashierName: string;
  cashierRole?: UserRole;
}

/**
 * Writes one transaction doc — best-effort, doesn't block or roll back the
 * booking write it accompanies (a missing transaction log entry is a minor
 * reporting gap, not worth failing check-in/extend/checkout over). A plain
 * setDoc rather than part of a Firestore transaction — every caller runs
 * standalone now (see bookings.ts/orders.ts/store-sales.ts/void-requests.ts,
 * which all moved off runTransaction so their writes can queue offline).
 */
export async function recordTransaction(input: RecordTransactionInput): Promise<void> {
  if (input.amount <= 0) return;
  const firestore = requireDb();
  const ref = doc(collection(firestore, "transactions"));
  const record = {
    transactionId: ref.id,
    type: input.type,
    bookingId: input.bookingId,
    roomNumber: input.roomNumber,
    amount: input.amount,
    cashAmount: input.cashAmount,
    gcashAmount: input.gcashAmount,
    qrphAmount: input.qrphAmount,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    ...(input.cashierRole ? { cashierRole: input.cashierRole } : {}),
    timestamp: serverTimestamp(),
  };
  try {
    await setDoc(ref, record);
  } catch {
    // Best-effort — the booking write already succeeded; don't fail the
    // front-desk action because the transaction log entry couldn't be saved.
  }
}

export async function fetchTransactionsInRange(start: Date, end: Date): Promise<Transaction[]> {
  const firestore = requireDb();
  const q = query(
    collection(firestore, "transactions"),
    where("timestamp", ">=", Timestamp.fromDate(start)),
    where("timestamp", "<=", Timestamp.fromDate(end))
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data({ serverTimestamps: "estimate" }) as Transaction);
}
