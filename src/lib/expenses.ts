import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ShiftExpense, UserRole } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

/** Same 7am/7pm split the daily report uses — derived from the clock, not the filter. */
export function shiftLabelForTime(date: Date): "Day" | "Night" {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 7 * 60 && minutes < 19 * 60 ? "Day" : "Night";
}

export function totalExpenses(expenses: ShiftExpense[]): number {
  return expenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0);
}

export async function fetchExpensesInRange(start: Date, end: Date): Promise<ShiftExpense[]> {
  const firestore = requireDb();
  const q = query(
    collection(firestore, "shiftExpenses"),
    where("recordedAt", ">=", Timestamp.fromDate(start)),
    where("recordedAt", "<=", Timestamp.fromDate(end))
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => d.data({ serverTimestamps: "estimate" }) as ShiftExpense);
  list.sort((a, b) => (a.recordedAt?.toMillis() ?? 0) - (b.recordedAt?.toMillis() ?? 0));
  return list;
}

export async function recordShiftExpense(input: {
  amount: number;
  description: string;
  cashierId: string;
  cashierName: string;
  cashierRole?: UserRole;
}): Promise<void> {
  await recordShiftExpenses({
    items: [{ amount: input.amount, description: input.description }],
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    cashierRole: input.cashierRole,
  });
}

export async function recordShiftExpenses(input: {
  items: { amount: number; description: string }[];
  cashierId: string;
  cashierName: string;
  cashierRole?: UserRole;
}): Promise<number> {
  const items = input.items.map((item) => ({
    amount: Number(item.amount),
    description: item.description.trim(),
  }));
  if (items.length === 0) {
    throw new Error("Add at least one expense.");
  }
  for (const item of items) {
    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      throw new Error("Enter an amount greater than zero.");
    }
    if (!item.description) {
      throw new Error("Say what each expense was for.");
    }
  }

  const firestore = requireDb();
  const cashierName = input.cashierName.trim() || "Staff";
  const batch = writeBatch(firestore);
  for (const item of items) {
    const ref = doc(collection(firestore, "shiftExpenses"));
    batch.set(ref, {
      expenseId: ref.id,
      amount: item.amount,
      description: item.description.slice(0, 120),
      recordedAt: serverTimestamp(),
      cashierId: input.cashierId,
      cashierName,
      ...(input.cashierRole ? { cashierRole: input.cashierRole } : {}),
    });
  }
  await batch.commit();
  return items.length;
}

export async function deleteShiftExpense(expenseId: string): Promise<void> {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "shiftExpenses", expenseId));
}
