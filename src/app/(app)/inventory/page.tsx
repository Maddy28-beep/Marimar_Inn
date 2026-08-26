"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { subscribeToInventory, subscribeToCategories, deleteItem, restockItem } from "@/lib/inventory";
import type { InventoryCategory, InventoryItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ItemFormDialog } from "@/components/inventory/item-form-dialog";
import { CategoryManagerDialog } from "@/components/inventory/category-manager-dialog";
import { useAuth } from "@/context/auth-context";
import { isOwnerLikeRole } from "@/lib/roles";
import { Loader2Icon, PencilIcon, PlusIcon, TagIcon, Trash2Icon } from "lucide-react";

type DialogState = "create" | { item: InventoryItem } | null;

function RestockControl({ item }: { item: InventoryItem }) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleRestock() {
    const add = Number(amount);
    if (!add || add <= 0) {
      toast.error("Enter a quantity to add.");
      return;
    }
    setSubmitting(true);
    try {
      await restockItem(item.itemId, add);
      toast.success(`Added ${add} to ${item.name}.`);
      setAmount("");
    } catch {
      toast.error("Couldn't restock — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={submitting}
        placeholder="+ qty"
        className="h-7 w-20"
      />
      <Button variant="outline" size="sm" onClick={handleRestock} disabled={submitting}>
        {submitting ? <Loader2Icon className="size-3.5 animate-spin" /> : "Add"}
      </Button>
    </div>
  );
}

function ManageInventoryContent() {
  const { appUser } = useAuth();
  const canManage = isOwnerLikeRole(appUser?.role);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => subscribeToInventory(setItems), []);
  useEffect(() => subscribeToCategories(setCategories), []);

  // Grouped by category (then name within it) so the table reads as one
  // category block at a time instead of interleaved alphabetically by item
  // name — the Firestore query alone only orders by name.
  const sortedItems = useMemo(() => {
    if (!items) return items;
    return [...items].sort((a, b) => {
      const categoryCompare = a.category.localeCompare(b.category);
      return categoryCompare !== 0 ? categoryCompare : a.name.localeCompare(b.name);
    });
  }, [items]);

  async function handleDelete(item: InventoryItem) {
    if (!window.confirm(`Delete ${item.name}? This can't be undone.`)) return;
    setDeletingId(item.itemId);
    try {
      await deleteItem(item.itemId);
      toast.success(`${item.name} deleted.`);
    } catch {
      toast.error("Couldn't delete the item — please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Manage the store item catalog, prices, and stock levels."
              : "Check current stock levels against the actual inventory."}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCategoryManagerOpen(true)}>
              <TagIcon className="size-4" />
              Manage categories
            </Button>
            <Button onClick={() => setDialog("create")}>
              <PlusIcon className="size-4" />
              Add item
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-xl border">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Price</th>
              <th className="px-4 py-2 font-medium">Stock</th>
              {canManage && <th className="px-4 py-2 font-medium">Restock</th>}
              {canManage && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {sortedItems?.map((item) => {
              const lowStock = !item.unlimited && item.quantity <= item.minStockLevel;
              return (
                <tr key={item.itemId} className="border-t">
                  <td className="px-4 py-2 font-medium">{item.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{item.category}</td>
                  <td className="px-4 py-2">₱{item.sellingPrice.toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {item.unlimited ? (
                        <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">
                          Always available
                        </Badge>
                      ) : (
                        <>
                          {item.quantity}
                          {lowStock && (
                            <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">
                              Low stock
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  {canManage && (
                    <td className="px-4 py-2">
                      {item.unlimited ? (
                        <span className="text-xs text-muted-foreground">Not tracked</span>
                      ) : (
                        <RestockControl item={item} />
                      )}
                    </td>
                  )}
                  {canManage && (
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ item })}>
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(item)}
                          disabled={deletingId === item.itemId}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {items?.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 4} className="px-4 py-8 text-center text-muted-foreground">
                  No inventory items yet — add your first item to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {dialog && (
        <ItemFormDialog
          key={dialog === "create" ? "create" : dialog.item.itemId}
          mode={dialog}
          categories={categories}
          onClose={() => setDialog(null)}
        />
      )}

      {categoryManagerOpen && (
        <CategoryManagerDialog
          categories={categories}
          onClose={() => setCategoryManagerOpen(false)}
        />
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <ProtectedRoute allowedRoles={["owner", "admin", "superadmin", "supervisor", "cashier"]}>
      <ManageInventoryContent />
    </ProtectedRoute>
  );
}
