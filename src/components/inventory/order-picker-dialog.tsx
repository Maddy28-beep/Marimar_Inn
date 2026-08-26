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
import { addOrderToBooking } from "@/lib/bookings";
import { useAuth } from "@/context/auth-context";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import {
  printOrderReceipt,
  previewOrderReceipt,
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
import type { Booking, InventoryItem, OrderItem, PaymentMethod, Room } from "@/lib/types";
import { Loader2Icon, MinusIcon, PlusIcon, PrinterIcon, SearchIcon } from "lucide-react";

interface OrderPickerDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
}

export function OrderPickerDialog({ room, booking, onClose }: OrderPickerDialogProps) {
  const { appUser } = useAuth();
  const printer = useReceiptPrinter();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<PaymentDraft>(emptyPaymentDraft);
  const { submitting, guard } = useSubmitGuard();
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{
    items: OrderItem[];
    amountCharged: number;
    amountPaid: number;
    change: number;
    paymentMethod: PaymentMethod;
    gcashReference?: string;
    qrphReference?: string;
    splitCashAmount?: number;
    splitGcashAmount?: number;
    splitQrphAmount?: number;
  } | null>(null);

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
  const paid = collectedAmount(payment, cartTotal);
  const change = paid > cartTotal ? paid - cartTotal : 0;

  function adjustCart(item: InventoryItem, delta: number) {
    setCart((prev) => {
      const current = prev[item.itemId] ?? 0;
      const cap = item.unlimited ? Infinity : item.quantity;
      const next = Math.max(0, Math.min(cap, current + delta));
      return { ...prev, [item.itemId]: next };
    });
  }

  async function handleSubmit() {
    if (cartLines.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    await guard(submitOrder);
  }

  async function submitOrder() {
    if (!appUser) return;
    const payload = paymentPayload(payment, cartTotal);
    try {
      const result = await addOrderToBooking(
        booking,
        cartLines.map((line) => ({ itemId: line.item.itemId, quantity: line.qty })),
        payload.amountPaid,
        {
          paymentMethod: payload.paymentMethod,
          gcashReference: payload.gcashReference,
          qrphReference: payload.qrphReference,
          splitCashAmount: payload.splitCashAmount,
          splitGcashAmount: payload.splitGcashAmount,
          splitQrphAmount: payload.splitQrphAmount,
        },
        { uid: appUser.uid, name: staffName }
      );
      toast.success(
        result.amountCollected > 0
          ? `Order added and ₱${result.amountCollected.toFixed(2)} collected.`
          : "Order added."
      );
      if (printer.connected && result.amountCollected > 0) {
        try {
          await kickDrawerForCashPayment(cashCollectedNow(payment, cartTotal));
        } catch (error) {
          toast.error(`Order added, but the drawer said: ${printerErrorMessage(error)}`);
        }
      }
      setReceipt({
        items: cartLines.map((line) => ({
          itemId: line.item.itemId,
          name: line.item.name,
          unitPrice: line.item.sellingPrice,
          quantity: line.qty,
          subtotal: line.qty * line.item.sellingPrice,
        })),
        amountCharged: result.cartTotal,
        amountPaid: result.amountCollected,
        change,
        paymentMethod: payload.paymentMethod,
        gcashReference: payload.gcashReference,
        qrphReference: payload.qrphReference,
        splitCashAmount: payload.splitCashAmount,
        splitGcashAmount: payload.splitGcashAmount,
        splitQrphAmount: payload.splitQrphAmount,
      });
      setPhase("receipt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the order.");
    }
  }

  async function printThermalCopy() {
    if (!printer.connected || !receipt) return;
    try {
      await printOrderReceipt(booking, room, {
        staffName,
        items: receipt.items,
        amountCharged: receipt.amountCharged,
        amountPaid: receipt.amountPaid,
        change: receipt.change,
        paymentMethod: receipt.paymentMethod,
        gcashReference: receipt.gcashReference,
        qrphReference: receipt.qrphReference,
        splitCashAmount: receipt.splitCashAmount,
        splitGcashAmount: receipt.splitGcashAmount,
        splitQrphAmount: receipt.splitQrphAmount,
      });
    } catch (error) {
      toast.error(printerErrorMessage(error));
    }
  }

  if (phase === "receipt" && receipt) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Order added</DialogTitle>
            <DialogDescription>
              Room {room.roomNumber} — hand this receipt to the guest.
            </DialogDescription>
          </DialogHeader>

          <div className="print-area flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <ReceiptBrandHeader
              subtitle="Order Receipt"
              reference={referenceNumberFor(booking.bookingId)}
            />
            <div className="my-1 border-t" />
            <div className="flex justify-between">
              <span>Room</span>
              <span>{room.roomNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Guest</span>
              <span>{booking.guestName}</span>
            </div>
            <div className="my-1 border-t" />
            {receipt.items.map((line) => (
              <div key={line.itemId} className="flex justify-between">
                <span>
                  {line.quantity}× {line.name}
                </span>
                <span>₱{line.subtotal.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span>₱{receipt.amountCharged.toFixed(2)}</span>
            </div>
            {receipt.amountPaid > 0 ? (
              <PaymentBreakdownDisplay
                portions={{
                  cash: receipt.splitCashAmount ?? (receipt.paymentMethod === "cash" ? receipt.amountPaid : 0),
                  gcash: receipt.splitGcashAmount ?? (receipt.paymentMethod === "gcash" ? receipt.amountPaid : 0),
                  qrph: receipt.splitQrphAmount ?? (receipt.paymentMethod === "qrph" ? receipt.amountPaid : 0),
                }}
                method={receipt.paymentMethod}
                amountPaid={receipt.amountPaid}
                gcashReference={receipt.gcashReference}
                qrphReference={receipt.qrphReference}
                change={receipt.change}
              />
            ) : (
              <p className="text-muted-foreground">Not paid yet — added to the room balance.</p>
            )}
            {receipt.amountPaid < receipt.amountCharged && (
              <div className="flex justify-between font-medium text-amber-600 dark:text-amber-400">
                <span>Balance due</span>
                <span>₱{(receipt.amountCharged - receipt.amountPaid).toFixed(2)}</span>
              </div>
            )}
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
                lines={previewOrderReceipt(booking, room, {
                  staffName,
                  items: receipt.items,
                  amountCharged: receipt.amountCharged,
                  amountPaid: receipt.amountPaid,
                  change: receipt.change,
                  paymentMethod: receipt.paymentMethod,
                  gcashReference: receipt.gcashReference,
                  qrphReference: receipt.qrphReference,
                  splitCashAmount: receipt.splitCashAmount,
                  splitGcashAmount: receipt.splitGcashAmount,
                  splitQrphAmount: receipt.splitQrphAmount,
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
              <Button variant="outline" onClick={printThermalCopy}>
                <PrinterIcon className="size-4" />
                Print Receipt
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add order — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>Search or browse by category, then collect payment now.</DialogDescription>
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
                disabled={submitting}
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
              const outOfStock = !item.unlimited && item.quantity <= 0;
              const lowStock = !item.unlimited && !outOfStock && item.quantity <= item.minStockLevel;
              return (
                <div
                  key={item.itemId}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        ₱{item.sellingPrice.toFixed(2)}
                      </span>{" "}
                      ·{" "}
                      {item.unlimited ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Always available
                        </span>
                      ) : outOfStock ? (
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
                      disabled={(!item.unlimited && qty >= item.quantity) || submitting}
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

          {cartTotal > 0 && (
            <PaymentFields
              draft={payment}
              onChange={setPayment}
              due={cartTotal}
              disabled={submitting}
              idPrefix="order"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || cartLines.length === 0}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            {paid > 0 ? `Charge ₱${Math.min(paid, cartTotal).toFixed(2)}` : "Add to order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
