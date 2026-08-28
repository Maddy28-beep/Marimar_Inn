"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCategory, createItem, updateItem, type NewItemInput } from "@/lib/inventory";
import { useAuth } from "@/context/auth-context";
import type { InventoryCategory, InventoryItem } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

const NEW_CATEGORY_VALUE = "__new__";

interface ItemFormDialogProps {
  mode: "create" | { item: InventoryItem };
  categories: InventoryCategory[];
  onClose: () => void;
}

export function ItemFormDialog({ mode, categories, onClose }: ItemFormDialogProps) {
  const { appUser } = useAuth();
  const editingItem = mode === "create" ? null : mode.item;
  const [name, setName] = useState(editingItem?.name ?? "");
  const [category, setCategory] = useState(editingItem?.category ?? "");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [sellingPrice, setSellingPrice] = useState(String(editingItem?.sellingPrice ?? ""));
  const [quantity, setQuantity] = useState(String(editingItem?.quantity ?? "0"));
  const [minStockLevel, setMinStockLevel] = useState(String(editingItem?.minStockLevel ?? "5"));
  const [unlimited, setUnlimited] = useState(editingItem?.unlimited ?? false);
  const [submitting, setSubmitting] = useState(false);

  // The item being edited might carry a category that predates the
  // category list (typed free-hand before this picker existed) — keep it
  // selectable even if it's not a registered category.
  const categoryNames = Array.from(
    new Set([...categories.map((c) => c.name), ...(editingItem?.category ? [editingItem.category] : [])])
  ).sort();

  async function handleAddCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    try {
      const created = await createCategory(trimmed);
      setCategory(created);
      setAddingCategory(false);
      setNewCategoryName("");
    } catch {
      toast.error("Couldn't add that category — please try again.");
    }
  }

  async function handleSubmit() {
    if (!name.trim() || !category.trim()) {
      toast.error("Name and category are required.");
      return;
    }
    const input: NewItemInput = {
      name: name.trim(),
      category: category.trim(),
      sellingPrice: Number(sellingPrice) || 0,
      quantity: Number(quantity) || 0,
      minStockLevel: Number(minStockLevel) || 0,
      unlimited,
    };

    setSubmitting(true);
    try {
      if (editingItem) {
        await updateItem(editingItem.itemId, input);
        toast.success(`${input.name} updated.`);
      } else {
        await createItem(input, {
          uid: appUser?.uid ?? "",
          name: appUser?.displayName ?? appUser?.email ?? "Staff",
          role: appUser?.role,
        });
        toast.success(`${input.name} added.`);
      }
      onClose();
    } catch {
      toast.error("Couldn't save the item — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit item" : "Add item"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category">Category</Label>
            {addingCategory ? (
              <div className="flex gap-2">
                <Input
                  id="category"
                  autoFocus
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  disabled={submitting}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCategory();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={handleAddCategory} disabled={submitting}>
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAddingCategory(false);
                    setNewCategoryName("");
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Select
                value={category}
                onValueChange={(v) => (v === NEW_CATEGORY_VALUE ? setAddingCategory(true) : setCategory(v ?? ""))}
                disabled={submitting}
              >
                <SelectTrigger id="category" className="w-full">
                  <SelectValue placeholder="Select a category">{category || undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categoryNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CATEGORY_VALUE}>+ Add new category…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sellingPrice">Price (₱)</Label>
              <Input
                id="sellingPrice"
                type="number"
                min={0}
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                disabled={submitting}
              />
            </div>
            {!unlimited && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={0}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}
          </div>
          <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={unlimited}
              onChange={(e) => setUnlimited(e.target.checked)}
              disabled={submitting}
            />
            <span>
              <span className="font-medium">Always available</span>
              <span className="block text-xs text-muted-foreground">
                For a resource that never runs out (e.g. hot water) — never flagged as low stock,
                and quantity isn&apos;t tracked or reduced when ordered.
              </span>
            </span>
          </label>
          {!unlimited && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="minStockLevel">Low-stock threshold</Label>
            <Input
              id="minStockLevel"
              type="number"
              min={0}
              value={minStockLevel}
              onChange={(e) => setMinStockLevel(e.target.value)}
              disabled={submitting}
            />
          </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
