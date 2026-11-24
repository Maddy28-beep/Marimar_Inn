import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { bCollection, bDoc } from "@/lib/branches";
import type { InventoryCategory, InventoryItem, UserRole } from "@/lib/types";
import { syncLowStockNotification } from "@/lib/notifications";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export function subscribeToInventory(onChange: (items: InventoryItem[]) => void) {
  const firestore = requireDb();
  const q = query(bCollection(firestore, "inventory"), orderBy("name"));
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
  unlimited?: boolean;
  piecesPerSale?: number;
}

/** Raw stock units consumed by selling `count` order-lines of this item. */
export function stockUnitsFor(
  item: Pick<InventoryItem, "piecesPerSale">,
  count: number
): number {
  return count * (item.piecesPerSale ?? 1);
}

/**
 * How many order-lines of this item current stock can still cover — e.g. 2
 * pieces left of a 3-pieces-per-sale item is 0 sellable, not "some". Used
 * everywhere a picker caps how much a cashier can add to a cart.
 */
export function sellableUnits(item: Pick<InventoryItem, "quantity" | "piecesPerSale">): number {
  return Math.floor(item.quantity / (item.piecesPerSale ?? 1));
}

export interface ItemActor {
  uid: string;
  name: string;
  role?: UserRole;
}

export async function createItem(input: NewItemInput, actor: ItemActor) {
  const firestore = requireDb();
  const ref = doc(bCollection(firestore, "inventory"));
  const item: Omit<InventoryItem, "lastUpdated" | "createdAt"> & {
    lastUpdated: ReturnType<typeof serverTimestamp>;
    createdAt: ReturnType<typeof serverTimestamp>;
  } = {
    itemId: ref.id,
    name: input.name,
    category: input.category,
    sellingPrice: input.sellingPrice,
    quantity: input.quantity,
    minStockLevel: input.minStockLevel,
    lastUpdated: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name,
    ...(actor.role ? { createdByRole: actor.role } : {}),
    ...(input.unlimited ? { unlimited: true } : {}),
    ...(input.piecesPerSale && input.piecesPerSale > 1 ? { piecesPerSale: input.piecesPerSale } : {}),
  };
  await setDoc(ref, item);
  await syncLowStockNotification(item);
}

export async function updateItem(itemId: string, input: NewItemInput) {
  const firestore = requireDb();
  await updateDoc(bDoc(firestore, "inventory", itemId), {
    name: input.name,
    category: input.category,
    sellingPrice: input.sellingPrice,
    quantity: input.quantity,
    minStockLevel: input.minStockLevel,
    lastUpdated: serverTimestamp(),
    // Always written (not conditionally spread) so unchecking "Always
    // available" on an existing item actually clears the flag instead of
    // leaving the old value in place. Same reasoning for piecesPerSale —
    // resetting it back to 1 must actually overwrite a previous bundle size.
    unlimited: input.unlimited ?? false,
    piecesPerSale: input.piecesPerSale && input.piecesPerSale > 1 ? input.piecesPerSale : 1,
  });
  await syncLowStockNotification({
    itemId,
    name: input.name,
    quantity: input.quantity,
    minStockLevel: input.minStockLevel,
    unlimited: input.unlimited,
  });
}

export async function restockItem(itemId: string, addQuantity: number) {
  const firestore = requireDb();
  const ref = bDoc(firestore, "inventory", itemId);
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
  await deleteDoc(bDoc(firestore, "inventory", itemId));
}

export function subscribeToCategories(onChange: (categories: InventoryCategory[]) => void) {
  const firestore = requireDb();
  const q = query(bCollection(firestore, "inventoryCategories"), orderBy("name"));
  return onSnapshot(q, (snapshot) => {
    onChange(
      snapshot.docs.map((d) => d.data({ serverTimestamps: "estimate" }) as InventoryCategory)
    );
  });
}

/**
 * The trimmed category name doubles as the document ID — creating the same
 * name twice just overwrites the same doc, so categories can't accidentally
 * end up duplicated ("Drinks" vs "Drinks " vs a second identical entry).
 */
export async function createCategory(name: string) {
  const firestore = requireDb();
  const trimmed = name.trim().replace(/\//g, "-");
  if (!trimmed) throw new Error("Category name is required.");
  const ref = bDoc(firestore, "inventoryCategories", trimmed);
  await setDoc(ref, { categoryId: trimmed, name: trimmed, createdAt: serverTimestamp() });
  return trimmed;
}

export interface CatalogCopyPlan {
  items: InventoryItem[];
  categoryNames: string[];
  skippedExisting: number;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * What copying another branch's store list into the ACTIVE branch would add.
 * Read-only. Items whose name already exists here are skipped, so the copy
 * can be run again without creating duplicates.
 */
export async function planCatalogCopy(sourceBranchId: string): Promise<CatalogCopyPlan> {
  const firestore = requireDb();
  const [sourceItems, sourceCats, hereItems, hereCats] = await Promise.all([
    getDocs(bCollection(firestore, "inventory", sourceBranchId)),
    getDocs(bCollection(firestore, "inventoryCategories", sourceBranchId)),
    getDocs(bCollection(firestore, "inventory")),
    getDocs(bCollection(firestore, "inventoryCategories")),
  ]);
  const haveNames = new Set(hereItems.docs.map((d) => nameKey(String(d.data().name ?? ""))));
  const haveCategories = new Set(hereCats.docs.map((d) => d.id));
  const items: InventoryItem[] = [];
  let skippedExisting = 0;
  for (const d of sourceItems.docs) {
    const item = d.data() as InventoryItem;
    if (haveNames.has(nameKey(item.name))) skippedExisting++;
    else items.push(item);
  }
  const wanted = new Set<string>([
    ...sourceCats.docs.map((d) => String(d.data().name ?? d.id)),
    ...items.map((i) => i.category),
  ]);
  const categoryNames = [...wanted].filter((n) => n && !haveCategories.has(n.trim().replace(/\//g, "-")));
  return { items, categoryNames, skippedExisting };
}

/**
 * Copies the planned items into the active branch with every quantity at 0
 * (each branch counts its own stock). Nothing in the source branch changes.
 */
export async function applyCatalogCopy(plan: CatalogCopyPlan, actor: ItemActor) {
  const firestore = requireDb();
  const writes: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const name of plan.categoryNames) {
    const id = name.trim().replace(/\//g, "-");
    writes.push((batch) =>
      batch.set(bDoc(firestore, "inventoryCategories", id), {
        categoryId: id,
        name: id,
        createdAt: serverTimestamp(),
      })
    );
  }
  for (const src of plan.items) {
    const ref = doc(bCollection(firestore, "inventory"));
    writes.push((batch) =>
      batch.set(ref, {
        itemId: ref.id,
        name: src.name,
        category: src.category,
        sellingPrice: src.sellingPrice,
        quantity: 0,
        minStockLevel: src.minStockLevel ?? 0,
        lastUpdated: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
        createdByName: actor.name,
        ...(actor.role ? { createdByRole: actor.role } : {}),
        ...(src.unlimited ? { unlimited: true } : {}),
        ...(src.piecesPerSale && src.piecesPerSale > 1 ? { piecesPerSale: src.piecesPerSale } : {}),
      })
    );
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(firestore);
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
}

export async function deleteCategory(categoryId: string) {
  const firestore = requireDb();
  await deleteDoc(bDoc(firestore, "inventoryCategories", categoryId));
}
