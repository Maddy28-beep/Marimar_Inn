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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subscribeToInventory } from "@/lib/inventory";
import { createStoreSale } from "@/lib/store-sales";
import { methodContribution } from "@/lib/bookings";
import { useAuth } from "@/context/auth-context";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import {
  previewStoreSaleReceipt,
  printStoreSaleReceipt,
  printerErrorMessage,
  referenceNumberFor,
  kickDrawerForCashPayment,
  staffFirstName,
} from "@/lib/receipt-printer";
import {
  cashCollectedNow,
  collectedAmount,
  emptyPaymentDraft,
  PaymentBreakdownDisplay,
  PaymentFields,
  paymentPayload,
  type PaymentDraft,
} from "@/components/payments/payment-fields";
import { ReceiptBrandHeader } from "@/components/receipt-brand-header";
import { ReceiptPreviewStrip } from "@/components/receipt-preview";
import type { AppUser, InventoryItem, StoreSale } from "@/lib/types";
import { Loader2Icon, MinusIcon, PlusIcon, PrinterIcon, SearchIcon } from "lucide-react";

interface WalkInSaleDialogProps {
  onClose: () => void;
}

export function WalkInSaleDialog({ onClose }: WalkInSaleDialogProps) {
  const { appUser } = useAuth();
  const printer = useReceiptPrinter();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [guestName, setGuestName] = useState("");
  const [payment, setPayment] = useState<PaymentDraft>(emptyPaymentDraft);
  const { submitting, guard } = useSubmitGuard();
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{ sale: StoreSale; change: number } | null>(null);

  useEffect(() => subscribeToInventory(setInventory), []);

  const categories = useMemo(() => {
    if (!inventory) return [];
    return Array.from(new Set(inventory.map((item) => item.category))).sort();
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
        const item = inventory.find((row) => row.itemId === itemId);
        return item ? { item, qty } : null;
      })
      .filter((line): line is { item: InventoryItem; qty: number } => line !== null);
  }, [cart, inventory]);

  const total = cartLines.reduce((sum, line) => sum + line.qty * line.item.sellingPrice, 0);
  const paid = collectedAmount(payment, total);
  const change = Math.max(0, paid - total);

  function adjustCart(item: InventoryItem, delta: number) {
    setCart((prev) => {
      const current = prev[item.itemId] ?? 0;
      const cap = item.unlimited ? Infinity : item.quantity;
      const next = Math.max(0, Math.min(cap, current + delta));
      return { ...prev, [item.itemId]: next };
    });
  }

  async function handleCharge() {
    if (!appUser) return;
    if (cartLines.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    if (paid < total) {
      toast.error(`Collect ₱${(total - paid).toFixed(2)} before charging.`);
      return;
    }
    await guard(() => submitCharge(appUser));
  }

  async function submitCharge(appUser: AppUser) {
    try {
      const payload = paymentPayload(payment, total);
      const sale = await createStoreSale({
        guestName: guestName.trim() || undefined,
        cartItems: cartLines.map((line) => ({ itemId: line.item.itemId, quantity: line.qty })),
        cashierId: appUser.uid,
        cashierName: staffName,
        ...payload,
      });
      if (printer.connected) {
        try {
          await kickDrawerForCashPayment(cashCollectedNow(payment, total));
        } catch (error) {
          toast.error(`Sold, but the drawer said: ${printerErrorMessage(error)}`);
        }
      }
      setReceipt({ sale, change });
      setPhase("receipt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't complete the sale.");
    }
  }

  async function printThermalCopy() {
    if (!printer.connected || !receipt) return;
    try {
      await printStoreSaleReceipt(receipt.sale, { staffName, change: receipt.change });
    } catch (error) {
      toast.error(printerErrorMessage(error));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        {phase === "receipt" && receipt ? (
          <>
            <DialogHeader>
              <DialogTitle>Store sale</DialogTitle>
              <DialogDescription>Hand this receipt to the customer.</DialogDescription>
            </DialogHeader>

            <div className="print-area flex flex-col gap-2 rounded-lg border p-4 text-sm">
              <ReceiptBrandHeader
                subtitle="This is not an official receipt"
                reference={referenceNumberFor(receipt.sale.saleId)}
              />
              <div className="my-1 border-t" />
              <div className="flex justify-between">
                <span>Sale</span>
                <span>Walk-in store</span>
              </div>
              <div className="flex justify-between">
                <span>Customer</span>
                <span>{receipt.sale.guestName || "Walk-in"}</span>
              </div>
              <div className="flex justify-between">
                <span>Time</span>
                <span>{receipt.sale.soldAt?.toDate?.()?.toLocaleString() ?? new Date().toLocaleString()}</span>
              </div>
              <div className="my-1 border-t" />
              {receipt.sale.items.map((item) => (
                <div key={item.itemId} className="flex justify-between">
                  <span>
                    {item.quantity}× {item.name}
                  </span>
                  <span>₱{item.subtotal.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>₱{receipt.sale.totalAmount.toFixed(2)}</span>
              </div>
              <PaymentBreakdownDisplay
                portions={methodContribution(receipt.sale.paymentMethod, receipt.sale.amountPaid, {
                  cash: receipt.sale.splitCashAmount,
                  gcash: receipt.sale.splitGcashAmount,
                  qrph: receipt.sale.splitQrphAmount,
                })}
                method={receipt.sale.paymentMethod}
                amountPaid={receipt.sale.amountPaid}
                gcashReference={receipt.sale.gcashReference}
                qrphReference={receipt.sale.qrphReference}
                change={receipt.change}
              />
              <div className="my-1 border-t" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Staff</span>
                <span>{staffFirstName(staffName)}</span>
              </div>
            </div>

            <div className="print:hidden flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Thermal printer preview</p>
              <div className="max-h-72 overflow-y-auto rounded-md bg-muted/40 p-2">
                <ReceiptPreviewStrip
                  lines={previewStoreSaleReceipt(receipt.sale, {
                    staffName,
                    change: receipt.change,
                  })}
                  paperWidth={printer.paperWidth}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              {printer.connected && (
                <Button variant="outline" onClick={() => void printThermalCopy()}>
                  <PrinterIcon className="size-4" />
                  Print Receipt
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Walk-in store</DialogTitle>
              <DialogDescription>
                Sell Colgate, shampoo, water, and other items without a room.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="walkInName">Customer name (optional)</Label>
                <Input
                  id="walkInName"
                  placeholder="Walk-in"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search items"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                    disabled={submitting}
                  />
                </div>
                <Select value={category} onValueChange={(value) => setCategory(value ?? "all")}>
                  <SelectTrigger className="w-36">
                    <SelectValue>{category === "all" ? "All categories" : category}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                {inventory === null && <p className="p-2 text-sm text-muted-foreground">Loading…</p>}
                {inventory !== null && filtered.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">No items found.</p>
                )}
                {filtered.map((item) => {
                  const qty = cart[item.itemId] ?? 0;
                  const outOfStock = !item.unlimited && item.quantity <= 0;
                  return (
                    <div key={item.itemId} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          ₱{item.sellingPrice.toFixed(2)}
                          {item.unlimited ? (
                            <span className="text-emerald-700 dark:text-emerald-400"> · Always available</span>
                          ) : outOfStock ? (
                            <span className="text-rose-600 dark:text-rose-400"> · Out of stock</span>
                          ) : (
                            ` · ${item.quantity} in stock`
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
                          disabled={outOfStock || (!item.unlimited && qty >= item.quantity) || submitting}
                        >
                          <PlusIcon className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
                <span>Total due</span>
                <span>₱{total.toFixed(2)}</span>
              </div>

              <PaymentFields
                draft={payment}
                onChange={setPayment}
                due={total}
                disabled={submitting}
                idPrefix="store"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => void handleCharge()} disabled={submitting || cartLines.length === 0 || paid < total}>
                {submitting && <Loader2Icon className="size-4 animate-spin" />}
                Charge ₱{total.toFixed(2)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
