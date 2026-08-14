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
import { createItem, updateItem, type NewItemInput } from "@/lib/inventory";
import type { InventoryItem } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

interface ItemFormDialogProps {
  mode: "create" | { item: InventoryItem };
  onClose: () => void;
}

export function ItemFormDialog({ mode, onClose }: ItemFormDialogProps) {
  const editingItem = mode === "create" ? null : mode.item;
  const [name, setName] = useState(editingItem?.name ?? "");
  const [category, setCategory] = useState(editingItem?.category ?? "");
  const [sellingPrice, setSellingPrice] = useState(String(editingItem?.sellingPrice ?? ""));
  const [quantity, setQuantity] = useState(String(editingItem?.quantity ?? "0"));
  const [minStockLevel, setMinStockLevel] = useState(String(editingItem?.minStockLevel ?? "5"));
  const [submitting, setSubmitting] = useState(false);

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
    };

    setSubmitting(true);
    try {
      if (editingItem) {
        await updateItem(editingItem.itemId, input);
        toast.success(`${input.name} updated.`);
      } else {
        await createItem(input);
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
      <DialogContent className="sm:max-w-sm">
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
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              placeholder="e.g. Drinks, Snacks, Meals"
            />
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
          </div>
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
