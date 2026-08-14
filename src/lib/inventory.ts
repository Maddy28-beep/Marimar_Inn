import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InventoryItem } from "@/lib/types";
import { syncLowStockNotification } from "@/lib/notifications";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export function subscribeToInventory(onChange: (items: InventoryItem[]) => void) {
  const firestore = requireDb();
  const q = query(collection(firestore, "inventory"), orderBy("name"));
  return onSnapshot(q, (snapshot) => {
    onChange(
      snapshot.docs.map((d) => d.data({ serverTimestamps: "estimate" }) as InventoryItem)
    );
  });
}

export interface NewItemInput {
  name: string;
  category: string;
  sellingPrice: number;
  quantity: number;
  minStockLevel: number;
}

export async function createItem(input: NewItemInput) {
  const firestore = requireDb();
  const ref = doc(collection(firestore, "inventory"));
  const item: Omit<InventoryItem, "lastUpdated"> & {
    lastUpdated: ReturnType<typeof serverTimestamp>;
  } = {
    itemId: ref.id,
    name: input.name,
    category: input.category,
    sellingPrice: input.sellingPrice,
    quantity: input.quantity,
    minStockLevel: input.minStockLevel,
    lastUpdated: serverTimestamp(),
  };
  await setDoc(ref, item);
  await syncLowStockNotification(item);
}

export async function updateItem(itemId: string, input: NewItemInput) {
  const firestore = requireDb();
  await updateDoc(doc(firestore, "inventory", itemId), {
    name: input.name,
    category: input.category,
    sellingPrice: input.sellingPrice,
    quantity: input.quantity,
    minStockLevel: input.minStockLevel,
    lastUpdated: serverTimestamp(),
  });
  await syncLowStockNotification({
    itemId,
    name: input.name,
    quantity: input.quantity,
    minStockLevel: input.minStockLevel,
  });
}

export async function restockItem(itemId: string, addQuantity: number) {
  const firestore = requireDb();
  const ref = doc(firestore, "inventory", itemId);
  await updateDoc(ref, {
    quantity: increment(addQuantity),
    lastUpdated: serverTimestamp(),
  });
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await syncLowStockNotification(snap.data() as InventoryItem);
  }
}

export async function deleteItem(itemId: string) {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, "inventory", itemId));
}
