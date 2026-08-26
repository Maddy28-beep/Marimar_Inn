import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { methodContribution } from "@/lib/bookings";
import { syncLowStockNotification } from "@/lib/notifications";
import type { InventoryItem, OrderItem, PaymentMethod, StoreSale } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export interface StoreSaleInput {
  guestName?: string;
  cartItems: { itemId: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  amountPaid: number;
  gcashReference?: string;
  qrphReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
  cashierId: string;
  cashierName: string;
}

export async function createStoreSale(input: StoreSaleInput): Promise<StoreSale> {
  const firestore = requireDb();
  const cartItems = input.cartItems.filter((line) => line.quantity > 0);
  if (cartItems.length === 0) throw new Error("Add at least one item.");

  const saleRef = doc(collection(firestore, "storeSales"));
  const itemRefs = cartItems.map((line) => doc(firestore, "inventory", line.itemId));
  const lowStock: InventoryItem[] = [];
  let items: OrderItem[] = [];
  let totalAmount = 0;

  await runTransaction(firestore, async (tx) => {
    const snaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)));
    items = [];
    totalAmount = 0;

    for (let i = 0; i < cartItems.length; i++) {
      const snap = snaps[i];
      if (!snap.exists()) throw new Error("An item is missing from inventory.");
      const item = snap.data() as InventoryItem;
      const quantity = cartItems[i].quantity;
      if (!item.unlimited && item.quantity < quantity) {
        throw new Error(`Only ${item.quantity} ${item.name} left in stock.`);
      }
      items.push({
        itemId: item.itemId,
        name: item.name,
        unitPrice: item.sellingPrice,
        quantity,
        subtotal: quantity * item.sellingPrice,
      });
      totalAmount += quantity * item.sellingPrice;
      if (!item.unlimited) {
        tx.update(itemRefs[i], {
          quantity: increment(-quantity),
          lastUpdated: serverTimestamp(),
        });
        lowStock.push({ ...item, quantity: item.quantity - quantity });
      }
    }

    const sale: Omit<StoreSale, "soldAt"> & { soldAt: ReturnType<typeof serverTimestamp> } = {
      saleId: saleRef.id,
      soldAt: serverTimestamp(),
      guestName: input.guestName?.trim() || "Walk-in",
      items,
      totalAmount,
      amountPaid: input.amountPaid,
      paymentMethod: input.paymentMethod,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      ...(input.gcashReference ? { gcashReference: input.gcashReference } : {}),
      ...(input.qrphReference ? { qrphReference: input.qrphReference } : {}),
      ...(input.splitCashAmount !== undefined ? { splitCashAmount: input.splitCashAmount } : {}),
      ...(input.splitGcashAmount !== undefined ? { splitGcashAmount: input.splitGcashAmount } : {}),
      ...(input.splitQrphAmount !== undefined ? { splitQrphAmount: input.splitQrphAmount } : {}),
    };
    tx.set(saleRef, sale);
  });

  await Promise.all(lowStock.map((item) => syncLowStockNotification(item)));

  const portions = methodContribution(input.paymentMethod, input.amountPaid, {
    cash: input.splitCashAmount,
    gcash: input.splitGcashAmount,
    qrph: input.splitQrphAmount,
  });

  return {
    saleId: saleRef.id,
    soldAt: Timestamp.now(),
    guestName: input.guestName?.trim() || "Walk-in",
    items,
    totalAmount,
    amountPaid: input.amountPaid,
    paymentMethod: input.paymentMethod,
    gcashReference: input.gcashReference,
    qrphReference: input.qrphReference,
    splitCashAmount: portions.cash || input.splitCashAmount,
    splitGcashAmount: portions.gcash || input.splitGcashAmount,
    splitQrphAmount: portions.qrph || input.splitQrphAmount,
    cashierId: input.cashierId,
    cashierName: input.cashierName,
  };
}

export async function fetchStoreSalesInRange(start: Date, end: Date): Promise<StoreSale[]> {
  const firestore = requireDb();
  const q = query(
    collection(firestore, "storeSales"),
    where("soldAt", ">=", Timestamp.fromDate(start)),
    where("soldAt", "<=", Timestamp.fromDate(end))
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as StoreSale);
}
