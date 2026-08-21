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
import { checkIn, methodContribution, OPEN_TIME_RATE_PER_HOUR } from "@/lib/bookings";
import { subscribeToRatePackages, updateRoomStatus } from "@/lib/rooms";
import { subscribeToInventory } from "@/lib/inventory";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useAuth } from "@/context/auth-context";
import {
  printThermalReceipt,
  previewGuestReceipt,
  printerErrorMessage,
  referenceNumberFor,
  shouldOpenDrawer,
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
import {
  ROOM_TYPE_LABELS,
  EXTRA_PERSON_FEE,
  TOWEL_FEE,
  BLANKET_FEE,
  type Booking,
  type InventoryItem,
  type RatePackage,
  type Room,
} from "@/lib/types";
import { ReceiptBrandHeader } from "@/components/receipt-brand-header";
import { ReceiptPreviewStrip } from "@/components/receipt-preview";
import { Loader2Icon, MinusIcon, PlusIcon, PrinterIcon, SparklesIcon, WrenchIcon } from "lucide-react";

function QtyRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-bold">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={disabled || value === 0}
        >
          <MinusIcon className="size-3.5" />
        </Button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onChange(value + 1)}
          disabled={disabled}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

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
  const [openTimeMode, setOpenTimeMode] = useState(false);
  const [payment, setPayment] = useState<PaymentDraft>(emptyPaymentDraft);
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [extraPersons, setExtraPersons] = useState(0);
  const [towels, setTowels] = useState(0);
  const [blankets, setBlankets] = useState(0);
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

  // Open time still floors at the shortest configured package — a guest who
  // picks it and leaves after 1 hour still pays that minimum, same as the
  // Extend Stay → Open time conversion already charges. Whichever package
  // has the fewest hours is treated as "the minimum," so this stays correct
  // even if the Owner edits rate packages later.
  const shortestPackage =
    ratePackages && ratePackages.length > 0
      ? [...ratePackages].sort((a, b) => a.hours - b.hours)[0]
      : null;
  const selectedPackage = openTimeMode
    ? shortestPackage
    : (ratePackages?.find((p) => p.packageId === selectedPackageId) ?? ratePackages?.[0] ?? null);
  const extraPersonCharge = extraPersons * EXTRA_PERSON_FEE;
  const amenityCharge = towels * TOWEL_FEE + blankets * BLANKET_FEE;
  const roomTotal = (selectedPackage?.price ?? 0) + extraPersonCharge;
  const total = roomTotal + fbTotal + amenityCharge;
  const paid = collectedAmount(payment, total);
  const change = paid > total ? paid - total : 0;
  // Guests aren't allowed into the room without paying in full at the desk
  // — check-in itself is the payment moment, so it's blocked until covered.
  const canCheckIn = Math.round(paid * 100) >= Math.round(total * 100);

  async function handleSubmit() {
    if (!room || !selectedPackage || !canCheckIn) return;

    const finalGuestName = guestName.trim() || "Guest";
    const amountCollected = Math.min(paid, total);
    const payload = paymentPayload(payment, total);
    const thisSplit = methodContribution(payload.paymentMethod, amountCollected, {
      cash: payload.splitCashAmount,
      gcash: payload.splitGcashAmount,
      qrph: payload.splitQrphAmount,
    });

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
        openEnded: openTimeMode || undefined,
        paymentMethod: payload.paymentMethod,
        amountPaid: amountCollected,
        gcashReference: payload.gcashReference,
        qrphReference: payload.qrphReference,
        splitCashAmount: payload.splitCashAmount,
        splitGcashAmount: payload.splitGcashAmount,
        splitQrphAmount: payload.splitQrphAmount,
        specialRequests: specialRequests.trim() || undefined,
        cashierId,
        cartItems: cartLines.map((line) => ({ itemId: line.item.itemId, quantity: line.qty })),
        extraPersonCount: extraPersons || undefined,
        towelCount: towels || undefined,
        blanketCount: blankets || undefined,
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
        openEnded: openTimeMode,
        totalRoomCharge: roomTotal,
        totalFbCharge: fbTotal + amenityCharge,
        totalAmount: total,
        amountPaid: amountCollected,
        paymentMethod: payload.paymentMethod,
        gcashReference: payload.gcashReference,
        qrphReference: payload.qrphReference,
        splitCashAmount: thisSplit.cash,
        splitGcashAmount: thisSplit.gcash,
        splitQrphAmount: thisSplit.qrph,
        paymentStatus: amountCollected >= total ? "paid" : amountCollected > 0 ? "partial" : "unpaid",
        status: "active",
        items: [
          ...cartLines.map((line) => ({
            itemId: line.item.itemId,
            name: line.item.name,
            unitPrice: line.item.sellingPrice,
            quantity: line.qty,
            subtotal: line.qty * line.item.sellingPrice,
          })),
          ...(towels > 0
            ? [{ itemId: "amenity-towel", name: "Towel", unitPrice: TOWEL_FEE, quantity: towels, subtotal: towels * TOWEL_FEE }]
            : []),
          ...(blankets > 0
            ? [
                {
                  itemId: "amenity-blanket",
                  name: "Blanket",
                  unitPrice: BLANKET_FEE,
                  quantity: blankets,
                  subtotal: blankets * BLANKET_FEE,
                },
              ]
            : []),
        ],
        extraPersonCount: extraPersons || undefined,
        towelCount: towels || undefined,
        blanketCount: blankets || undefined,
        cashierId,
        updatedAt: Timestamp.now(),
      };

      if (printer.connected) {
        try {
          await printThermalReceipt(receiptBooking, room, {
            staffName,
            finalAmountPaid: amountCollected,
            change,
            kickDrawer: shouldOpenDrawer(cashCollectedNow(payment, total)),
          });
        } catch (error) {
          toast.error(`Checked in, but the printer said: ${printerErrorMessage(error)}`);
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

  async function printThermalCopy() {
    if (!printer.connected || !receipt || !room) return;
    try {
      await printThermalReceipt(receipt.booking, room, {
        staffName,
        finalAmountPaid: receipt.finalAmountPaid,
        change: receipt.change,
      });
    } catch (error) {
      toast.error(printerErrorMessage(error));
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
              <ReceiptBrandHeader
                subtitle="This is not an official receipt"
                reference={referenceNumberFor(receipt.booking.bookingId)}
              />
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
                <span>
                  ₱
                  {(
                    receipt.booking.originalPackagePrice ??
                    Math.max(
                      0,
                      receipt.booking.totalRoomCharge - (receipt.booking.extraPersonCount ?? 0) * EXTRA_PERSON_FEE
                    )
                  ).toFixed(2)}
                </span>
              </div>
              {(receipt.booking.extraPersonCount ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{receipt.booking.extraPersonCount}× Extra person</span>
                  <span>₱{((receipt.booking.extraPersonCount ?? 0) * EXTRA_PERSON_FEE).toFixed(2)}</span>
                </div>
              )}
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
              <PaymentBreakdownDisplay
                portions={{
                  cash: receipt.booking.splitCashAmount ?? 0,
                  gcash: receipt.booking.splitGcashAmount ?? 0,
                  qrph: receipt.booking.splitQrphAmount ?? 0,
                }}
                method={receipt.booking.paymentMethod}
                amountPaid={receipt.finalAmountPaid}
                gcashReference={receipt.booking.gcashReference}
                qrphReference={receipt.booking.qrphReference}
                change={receipt.change}
              />
              <div className="my-1 border-t" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Staff</span>
                <span>{staffName}</span>
              </div>
            </div>

            <div className="print:hidden flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Thermal printer preview</p>
              <div className="max-h-72 overflow-y-auto rounded-md bg-muted/40 p-2">
                <ReceiptPreviewStrip
                  lines={previewGuestReceipt(receipt.booking, room, {
                    staffName,
                    finalAmountPaid: receipt.finalAmountPaid,
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

          <div className="flex flex-col gap-2">
            <Label className="text-base font-bold">Extras</Label>
            <QtyRow
              label="Extra person"
              hint={`₱${EXTRA_PERSON_FEE} each`}
              value={extraPersons}
              onChange={setExtraPersons}
              disabled={submitting}
            />
            <QtyRow
              label="Towel"
              hint={`₱${TOWEL_FEE} each`}
              value={towels}
              onChange={setTowels}
              disabled={submitting}
            />
            <QtyRow
              label="Blanket"
              hint={`₱${BLANKET_FEE} each`}
              value={blankets}
              onChange={setBlankets}
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-base font-bold">Rate package</Label>
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
                    variant={!openTimeMode && selectedPackageId === pkg.packageId ? "default" : "outline"}
                    onClick={() => {
                      setOpenTimeMode(false);
                      setSelectedPackageId(pkg.packageId);
                    }}
                    disabled={submitting}
                  >
                    {pkg.hours}h · ₱{pkg.price}
                  </Button>
                ))}
                {shortestPackage && (
                  <Button
                    type="button"
                    size="sm"
                    variant={openTimeMode ? "default" : "outline"}
                    onClick={() => setOpenTimeMode(true)}
                    disabled={submitting}
                  >
                    Open time
                  </Button>
                )}
              </div>
            )}
            {openTimeMode && shortestPackage && (
              <p className="text-xs text-muted-foreground">
                No fixed end time — the {shortestPackage.hours}h package (₱{shortestPackage.price})
                still applies as a paid minimum. If the stay runs past {shortestPackage.hours}h, the
                overage bills at ₱{OPEN_TIME_RATE_PER_HOUR}/hr in 30-min blocks, entered at checkout.
              </p>
            )}
          </div>

          {inventory !== null && inventory.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-base font-bold">Store items (optional)</Label>
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
              <span>
                Room ({openTimeMode ? `open time, ${selectedPackage?.hours ?? "—"}h min` : `${selectedPackage?.hours ?? "—"}h`})
              </span>
              <span>₱{(selectedPackage?.price ?? 0).toFixed(2)}</span>
            </div>
            {extraPersons > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{extraPersons}× Extra person</span>
                <span>₱{extraPersonCharge.toFixed(2)}</span>
              </div>
            )}
            {amenityCharge > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Towel / blanket</span>
                <span>₱{amenityCharge.toFixed(2)}</span>
              </div>
            )}
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

          <PaymentFields
            draft={payment}
            onChange={setPayment}
            due={total}
            disabled={submitting}
            idPrefix="checkin"
          />
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

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleMarkCleaning}
              disabled={submitting}
              className="border-amber-400/70 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
            >
              <SparklesIcon className="size-4" />
              Mark for cleaning
            </Button>
            <Button
              variant="outline"
              onClick={handleMarkMaintenance}
              disabled={submitting}
              className="border-orange-400/70 bg-orange-50 text-orange-950 hover:bg-orange-100 dark:bg-orange-950/40 dark:text-orange-100 dark:hover:bg-orange-950/70"
            >
              <WrenchIcon className="size-4" />
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
