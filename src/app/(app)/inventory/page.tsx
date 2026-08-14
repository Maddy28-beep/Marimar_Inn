"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { subscribeToInventory, deleteItem, restockItem } from "@/lib/inventory";
import type { InventoryItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ItemFormDialog } from "@/components/inventory/item-form-dialog";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

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
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => subscribeToInventory(setItems), []);

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
            Manage the store item catalog, prices, and stock levels.
          </p>
        </div>
        <Button onClick={() => setDialog("create")}>
          <PlusIcon className="size-4" />
          Add item
        </Button>
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
              <th className="px-4 py-2 font-medium">Restock</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items?.map((item) => {
              const lowStock = item.quantity <= item.minStockLevel;
              return (
                <tr key={item.itemId} className="border-t">
                  <td className="px-4 py-2 font-medium">{item.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{item.category}</td>
                  <td className="px-4 py-2">₱{item.sellingPrice.toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {item.quantity}
                      {lowStock && (
                        <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">
                          Low stock
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <RestockControl item={item} />
                  </td>
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
                </tr>
              );
            })}
            {items?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
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
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <ManageInventoryContent />
    </ProtectedRoute>
  );
}
