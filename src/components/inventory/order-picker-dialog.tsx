"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subscribeToInventory } from "@/lib/inventory";
import { addOrderItem } from "@/lib/orders";
import type { InventoryItem } from "@/lib/types";
import { Loader2Icon, MinusIcon, PlusIcon, SearchIcon } from "lucide-react";

interface OrderPickerDialogProps {
  bookingId: string;
  onClose: () => void;
}

export function OrderPickerDialog({ bookingId, onClose }: OrderPickerDialogProps) {
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => subscribeToInventory(setInventory), []);

  const categories = useMemo(() => {
    if (!inventory) return [];
    return Array.from(new Set(inventory.map((i) => i.category))).sort();
  }, [inventory]);

  const filtered = useMemo(() => {
    if (!inventory) return [];
    return inventory.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (search && !item.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [inventory, category, search]);

  const cartLines = useMemo(() => {
    if (!inventory) return [];
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const item = inventory.find((i) => i.itemId === itemId);
        return item ? { item, qty } : null;
      })
      .filter((line): line is { item: InventoryItem; qty: number } => line !== null);
  }, [cart, inventory]);

  const cartTotal = cartLines.reduce((sum, line) => sum + line.qty * line.item.sellingPrice, 0);

  function adjustCart(item: InventoryItem, delta: number) {
    setCart((prev) => {
      const current = prev[item.itemId] ?? 0;
      const next = Math.max(0, Math.min(item.quantity, current + delta));
      return { ...prev, [item.itemId]: next };
    });
  }

  async function handleSubmit() {
    if (cartLines.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    setSubmitting(true);
    try {
      for (const line of cartLines) {
        await addOrderItem(bookingId, line.item.itemId, line.qty);
      }
      toast.success("Order added.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add order</DialogTitle>
          <DialogDescription>Search or browse by category.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search items"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "all")}>
              <SelectTrigger className="w-36">
                <SelectValue>{category === "all" ? "All categories" : category}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
            {inventory === null && (
              <p className="p-2 text-sm text-muted-foreground">Loading…</p>
            )}
            {inventory !== null && filtered.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">No items found.</p>
            )}
            {filtered.map((item) => {
              const qty = cart[item.itemId] ?? 0;
              const outOfStock = item.quantity <= 0;
              const lowStock = !outOfStock && item.quantity <= item.minStockLevel;
              return (
                <div
                  key={item.itemId}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      ₱{item.sellingPrice.toFixed(2)} ·{" "}
                      {outOfStock ? (
                        <span className="text-rose-600 dark:text-rose-400">Out of stock</span>
                      ) : lowStock ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {item.quantity} left
                        </span>
                      ) : (
                        `${item.quantity} in stock`
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => adjustCart(item, -1)}
                      disabled={qty === 0 || submitting}
                    >
                      <MinusIcon className="size-3.5" />
                    </Button>
                    <span className="w-5 text-center tabular-nums">{qty}</span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => adjustCart(item, 1)}
                      disabled={qty >= item.quantity || submitting}
                    >
                      <PlusIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
            <span>Cart total</span>
            <span>₱{cartTotal.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || cartLines.length === 0}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Add to order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
