"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkIn } from "@/lib/bookings";
import { subscribeToRatePackages, updateRoomStatus } from "@/lib/rooms";
import { subscribeToInventory } from "@/lib/inventory";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useAuth } from "@/context/auth-context";
import {
  openCashDrawer,
  printThermalReceipt,
  referenceNumberFor,
  shouldOpenDrawer,
} from "@/lib/receipt-printer";
import {
  PAYMENT_METHOD_LABELS,
  ROOM_TYPE_LABELS,
  type Booking,
  type InventoryItem,
  type PaymentMethod,
  type RatePackage,
  type Room,
} from "@/lib/types";
import { Loader2Icon, MinusIcon, PlusIcon, PrinterIcon } from "lucide-react";

interface CheckInDialogProps {
  room: Room | null;
  cashierId: string;
  onClose: () => void;
}

export function CheckInDialog({ room, cashierId, onClose }: CheckInDialogProps) {
  const printer = useReceiptPrinter();
  const { appUser } = useAuth();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestCount, setGuestCount] = useState("2");
  const [ratePackages, setRatePackages] = useState<RatePackage[] | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [gcashReference, setGcashReference] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{
    booking: Booking;
    finalAmountPaid: number;
    change: number;
  } | null>(null);

  useEffect(() => subscribeToInventory(setInventory), []);
  useEffect(() => subscribeToRatePackages(setRatePackages), []);

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

  const fbTotal = cartLines.reduce((sum, line) => sum + line.qty * line.item.sellingPrice, 0);

  function adjustCart(item: InventoryItem, delta: number) {
    setCart((prev) => {
      const current = prev[item.itemId] ?? 0;
      const next = Math.max(0, Math.min(item.quantity, current + delta));
      return { ...prev, [item.itemId]: next };
    });
  }

  if (!room) return null;

  const selectedPackage =
    ratePackages?.find((p) => p.packageId === selectedPackageId) ?? ratePackages?.[0] ?? null;
  const roomTotal = selectedPackage?.price ?? 0;
  const total = roomTotal + fbTotal;
  const paid = Number(amountPaid) || 0;
  const change = paid > total ? paid - total : 0;
  // Guests aren't allowed into the room without paying in full at the desk
  // — check-in itself is the payment moment, so it's blocked until covered.
  const canCheckIn = Math.round(paid * 100) >= Math.round(total * 100);

  async function handleSubmit() {
    if (!room || !selectedPackage || !canCheckIn) return;

    const finalGuestName = guestName.trim() || "Guest";
    const amountCollected = Math.min(paid, total);

    setSubmitting(true);
    try {
      const newBookingId = await checkIn({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        guestName: finalGuestName,
        guestPhone: guestPhone.trim() || undefined,
        guestCount: guestCount ? Number(guestCount) : undefined,
        packageHours: selectedPackage.hours,
        packagePrice: selectedPackage.price,
        paymentMethod,
        amountPaid: amountCollected,
        gcashReference: paymentMethod === "gcash" ? gcashReference.trim() || undefined : undefined,
        specialRequests: specialRequests.trim() || undefined,
        cashierId,
        cartItems: cartLines.map((line) => ({ itemId: line.item.itemId, quantity: line.qty })),
      });
      toast.success(`Room ${room.roomNumber} checked in.`);

      const receiptBooking: Booking = {
        bookingId: newBookingId,
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        guestName: finalGuestName,
        checkInTime: Timestamp.now(),
        hoursBooked: selectedPackage.hours,
        originalPackageHours: selectedPackage.hours,
        originalPackagePrice: selectedPackage.price,
        totalRoomCharge: roomTotal,
        totalFbCharge: fbTotal,
        totalAmount: total,
        amountPaid: amountCollected,
        paymentMethod,
        gcashReference: paymentMethod === "gcash" ? gcashReference.trim() || undefined : undefined,
        paymentStatus: amountCollected >= total ? "paid" : amountCollected > 0 ? "partial" : "unpaid",
        status: "active",
        items: cartLines.map((line) => ({
          itemId: line.item.itemId,
          name: line.item.name,
          unitPrice: line.item.sellingPrice,
          quantity: line.qty,
          subtotal: line.qty * line.item.sellingPrice,
        })),
        cashierId,
        updatedAt: Timestamp.now(),
      };

      if (printer.connected) {
        if (shouldOpenDrawer(paymentMethod, amountCollected)) {
          try {
            openCashDrawer();
          } catch {
            toast.error("Checked in, but couldn't open the cash drawer.");
          }
        }
        try {
          printThermalReceipt(receiptBooking, room, {
            staffName,
            finalAmountPaid: amountCollected,
            change,
          });
        } catch {
          toast.error("Checked in, but the thermal printer didn't respond.");
        }
      }

      setReceipt({ booking: receiptBooking, finalAmountPaid: amountCollected, change });
      setPhase("receipt");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error && error.message.includes("left in stock")
          ? error.message
          : "Couldn't check in — please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function printThermalCopy() {
    if (!printer.connected || !receipt || !room) return;
    try {
      printThermalReceipt(receipt.booking, room, {
        staffName,
        finalAmountPaid: receipt.finalAmountPaid,
        change: receipt.change,
      });
    } catch {
      toast.error("Couldn't print to the thermal printer.");
    }
  }

  async function handleMarkCleaning() {
    if (!room) return;
    setSubmitting(true);
    try {
      await updateRoomStatus(room.roomId, "cleaning");
      toast.success(`Room ${room.roomNumber} marked for cleaning.`);
      onClose();
    } catch {
      toast.error("Couldn't update the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkMaintenance() {
    if (!room) return;
    setSubmitting(true);
    try {
      await updateRoomStatus(room.roomId, "maintenance");
      toast.success(`Room ${room.roomNumber} marked under maintenance.`);
      onClose();
    } catch {
      toast.error("Couldn't update the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        {phase === "receipt" && receipt ? (
          <>
            <DialogHeader>
              <DialogTitle>Checked in</DialogTitle>
              <DialogDescription>
                Room {room.roomNumber} is ready — hand this receipt to the guest.
              </DialogDescription>
            </DialogHeader>

            <div className="print-area flex flex-col gap-2 rounded-lg border p-4 text-sm">
              <div className="text-center">
                <div className="font-heading text-base font-semibold">Marimar Inn</div>
                <div className="text-xs text-muted-foreground">Official Receipt</div>
                <div className="text-xs text-muted-foreground">
                  Ref: {referenceNumberFor(receipt.booking.bookingId)}
                </div>
              </div>
              <div className="my-1 border-t" />
              <div className="flex justify-between">
                <span>Room</span>
                <span>{room.roomNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Guest</span>
                <span>{receipt.booking.guestName}</span>
              </div>
              <div className="flex justify-between">
                <span>Check-in</span>
                <span>{receipt.booking.checkInTime.toDate().toLocaleString()}</span>
              </div>
              <div className="my-1 border-t" />
              <div className="flex justify-between">
                <span>Room ({receipt.booking.hoursBooked}h)</span>
                <span>₱{receipt.booking.totalRoomCharge.toFixed(2)}</span>
              </div>
              {receipt.booking.items.length > 0 && (
                <>
                  {receipt.booking.items.map((line) => (
                    <div key={line.itemId} className="flex justify-between text-muted-foreground">
                      <span>
                        {line.quantity}× {line.name}
                      </span>
                      <span>₱{line.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                </>
              )}
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>₱{receipt.booking.totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Paid via {PAYMENT_METHOD_LABELS[receipt.booking.paymentMethod]}</span>
                <span>₱{receipt.finalAmountPaid.toFixed(2)}</span>
              </div>
              {receipt.booking.paymentMethod === "gcash" && receipt.booking.gcashReference && (
                <div className="flex justify-between text-muted-foreground">
                  <span>GCash Ref</span>
                  <span>{receipt.booking.gcashReference}</span>
                </div>
              )}
              {receipt.change > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Change</span>
                  <span>₱{receipt.change.toFixed(2)}</span>
                </div>
              )}
              <div className="my-1 border-t" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Staff</span>
                <span>{staffName}</span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              {printer.connected && (
                <Button variant="outline" onClick={printThermalCopy}>
                  <PrinterIcon className="size-4" />
                  Reprint (thermal)
                </Button>
              )}
              <Button onClick={() => window.print()}>
                <PrinterIcon className="size-4" />
                Print receipt
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>Check in — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>{ROOM_TYPE_LABELS[room.type]}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="guestName">Guest name (optional)</Label>
            <Input
              id="guestName"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guestPhone">Contact number</Label>
              <Input
                id="guestPhone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guestCount"># of guests</Label>
              <Input
                id="guestCount"
                type="number"
                min={1}
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Rate package</Label>
            {ratePackages?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rate packages set up yet — add some under Manage Rooms.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ratePackages?.map((pkg) => (
                  <Button
                    key={pkg.packageId}
                    type="button"
                    size="sm"
                    variant={selectedPackage?.packageId === pkg.packageId ? "default" : "outline"}
                    onClick={() => setSelectedPackageId(pkg.packageId)}
                    disabled={submitting}
                  >
                    {pkg.hours}h · ₱{pkg.price}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {inventory !== null && inventory.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Store items (optional)</Label>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-1.5">
                {inventory.map((item) => {
                  const qty = cart[item.itemId] ?? 0;
                  const outOfStock = item.quantity <= 0;
                  return (
                    <div
                      key={item.itemId}
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        {item.name}{" "}
                        <span className="text-xs font-medium text-foreground">
                          ₱{item.sellingPrice.toFixed(2)}
                        </span>
                      </div>
                      {outOfStock ? (
                        <span className="text-xs text-rose-600 dark:text-rose-400">
                          Out of stock
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            onClick={() => adjustCart(item, -1)}
                            disabled={qty === 0 || submitting}
                          >
                            <MinusIcon className="size-3" />
                          </Button>
                          <span className="w-4 text-center tabular-nums">{qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            onClick={() => adjustCart(item, 1)}
                            disabled={qty >= item.quantity || submitting}
                          >
                            <PlusIcon className="size-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Room ({selectedPackage?.hours ?? "—"}h)</span>
              <span>₱{roomTotal.toFixed(2)}</span>
            </div>
            {fbTotal > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Store items</span>
                <span>₱{fbTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-base font-bold">
              <span>Total due</span>
              <span>₱{total.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Payment method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              disabled={submitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{PAYMENT_METHOD_LABELS[paymentMethod]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentMethod === "gcash" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gcashReference">GCash reference number</Label>
              <Input
                id="gcashReference"
                value={gcashReference}
                onChange={(e) => setGcashReference(e.target.value)}
                placeholder="e.g. 1234 567 890123"
                disabled={submitting}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amountPaid">Amount paid</Label>
              <Input
                id="amountPaid"
                type="number"
                min={0}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Change</Label>
              <div className="flex h-8 items-center text-sm font-medium">
                ₱{change.toFixed(2)}
              </div>
            </div>
          </div>
          {!canCheckIn && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Collect ₱{(total - paid).toFixed(2)} before checking in — guests aren&apos;t let
              into the room until payment is settled.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialRequests">Special requests</Label>
            <Textarea
              id="specialRequests"
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkCleaning}
              disabled={submitting}
              className="text-muted-foreground"
            >
              Mark for cleaning
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkMaintenance}
              disabled={submitting}
              className="text-muted-foreground"
            >
              Mark maintenance
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedPackage || !canCheckIn}
              title={!canCheckIn ? `Collect ₱${(total - paid).toFixed(2)} before checking in` : undefined}
            >
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Check in
            </Button>
          </div>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
