"use client";

import { useState } from "react";
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
  computeOpenTimeCharge,
  methodContribution,
  paymentBreakdown,
  recordCheckout,
  settleOpenTimeCharge,
  hoursElapsed,
} from "@/lib/bookings";
import { PAYMENT_METHOD_LABELS, type Booking, type Room } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { openCashDrawer, printThermalReceipt, referenceNumberFor, shouldOpenDrawer } from "@/lib/receipt-printer";
import { Loader2Icon, PrinterIcon } from "lucide-react";

interface CheckoutDialogProps {
  room: Room;
  booking: Booking;
  staffName: string;
  onClose: () => void;
}

export function CheckoutDialog({ room, booking, staffName, onClose }: CheckoutDialogProps) {
  const now = useNowTick(1000);
  const printer = useReceiptPrinter();
  const [phase, setPhase] = useState<"confirm" | "receipt">("confirm");
  const [finalPayment, setFinalPayment] = useState("");
  // The original package (e.g. 3h/₱200) is a floor, not something open time
  // replaces — converting to open time only changes what happens *after*
  // that package's hours run out. Checking out before then still owes the
  // full package price; only the overage bills at ₱100/hr in 30-min blocks.
  // Auto-calculated once at open time — the cashier can still override it
  // for edge cases.
  const [openTimeCharge, setOpenTimeCharge] = useState(() => {
    if (!booking.openEnded) return String(booking.totalRoomCharge);
    const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
    const packagePrice = booking.originalPackagePrice ?? booking.totalRoomCharge;
    const extraHours = Math.max(0, hoursElapsed(booking.checkInTime, now) - packageHours);
    return String(packagePrice + computeOpenTimeCharge(extraHours));
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkOutTime, setCheckOutTime] = useState<Date | null>(null);
  const [settledBooking, setSettledBooking] = useState<Booking | null>(null);

  const hoursUsed = hoursElapsed(booking.checkInTime, now);
  const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
  const packagePrice = booking.originalPackagePrice ?? booking.totalRoomCharge;

  // For an open-time stay, the room charge is whatever the cashier types in
  // here (no fixed rate yet) — everything downstream uses this effective
  // booking instead of the raw prop so the math and the printed receipt
  // agree with what's actually being charged.
  const effectiveRoomCharge = booking.openEnded
    ? Number(openTimeCharge) || 0
    : booking.totalRoomCharge;
  const effectiveTotalAmount = effectiveRoomCharge + booking.totalFbCharge;
  const effectiveBooking: Booking = booking.openEnded
    ? { ...booking, totalRoomCharge: effectiveRoomCharge, totalAmount: effectiveTotalAmount }
    : booking;

  // Once checked out, the receipt reads from the final settled numbers
  // (matters for open-time stays, where the room charge is only locked in
  // at this point) rather than the stale pre-checkout booking prop.
  const receiptData = settledBooking ?? booking;
  const { cash: receiptCashPaid, gcash: receiptGcashPaid } = paymentBreakdown(receiptData);

  const balanceBefore = Math.max(effectiveTotalAmount - booking.amountPaid, 0);
  const paymentInput = Number(finalPayment) || 0;
  const change = paymentInput > balanceBefore ? paymentInput - balanceBefore : 0;
  const finalAmountPaid = booking.amountPaid + Math.min(paymentInput, balanceBefore);
  const canComplete =
    Math.round(paymentInput * 100) >= Math.round(balanceBefore * 100);

  function printThermalCopy() {
    if (!printer.connected || !settledBooking) return;
    try {
      printThermalReceipt(settledBooking, room, { staffName, finalAmountPaid, change });
    } catch {
      toast.error("Couldn't print to the thermal printer.");
    }
  }

  async function handleConfirm() {
    if (!canComplete) {
      toast.error(`Collect ₱${balanceBefore.toFixed(2)} before checking out.`);
      return;
    }
    if (booking.openEnded && effectiveRoomCharge <= 0) {
      toast.error("Enter the final room charge for this open-time stay.");
      return;
    }
    setSubmitting(true);
    const amountCollectedNow = Math.min(paymentInput, balanceBefore);
    // Checkout doesn't ask which method covered the top-up — same fallback
    // recordCheckout() applies server-side — so the receipt's cash/GCash
    // breakdown (which now includes this payment) stays accurate too.
    const priorSplit = paymentBreakdown(effectiveBooking);
    const thisSplit = methodContribution(
      booking.paymentMethod === "split" ? "cash" : booking.paymentMethod,
      amountCollectedNow
    );
    const finalBooking: Booking = {
      ...effectiveBooking,
      amountPaid: finalAmountPaid,
      splitCashAmount: priorSplit.cash + thisSplit.cash,
      splitGcashAmount: priorSplit.gcash + thisSplit.gcash,
    };
    try {
      if (booking.openEnded) {
        await settleOpenTimeCharge(booking, effectiveRoomCharge, Math.round(hoursUsed * 10) / 10);
      }
      await recordCheckout(effectiveBooking, amountCollectedNow);
      setSettledBooking(finalBooking);
      setCheckOutTime(new Date());
      setPhase("receipt");

      if (printer.connected) {
        try {
          if (shouldOpenDrawer(booking.paymentMethod, amountCollectedNow)) {
            openCashDrawer();
          }
          printThermalReceipt(finalBooking, room, { staffName, finalAmountPaid, change });
        } catch {
          toast.error("Checked out, but the thermal printer didn't respond.");
        }
      }
    } catch {
      toast.error("Couldn't complete checkout — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        {phase === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>Check out — Room {room.roomNumber}</DialogTitle>
              <DialogDescription>{booking.guestName}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              {booking.openEnded && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-sky-500/10 p-3">
                  <Label htmlFor="openTimeCharge" className="text-sky-700 dark:text-sky-400">
                    Open time — {hoursUsed.toFixed(1)}h stayed. {packageHours}h package (₱
                    {packagePrice.toFixed(2)}) still applies; extra time bills at ₱100/hr in
                    30-min blocks. Final room charge:
                  </Label>
                  <Input
                    id="openTimeCharge"
                    type="number"
                    min={0}
                    step="0.01"
                    value={openTimeCharge}
                    onChange={(e) => setOpenTimeCharge(e.target.value)}
                    disabled={submitting}
                    className="bg-background"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
                {!booking.openEnded && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Hours used</span>
                    <span>{hoursUsed.toFixed(1)}h of {booking.hoursBooked}h booked</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Room charge</span>
                  <span>₱{effectiveRoomCharge.toFixed(2)}</span>
                </div>
                {booking.totalFbCharge > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Store items</span>
                    <span>₱{booking.totalFbCharge.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-medium">
                  <span>Total due</span>
                  <span>₱{effectiveTotalAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Already paid</span>
                  <span>₱{booking.amountPaid.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between font-medium text-amber-600 dark:text-amber-400">
                  <span>Balance</span>
                  <span>₱{balanceBefore.toFixed(2)}</span>
                </div>
              </div>

              {balanceBefore > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="finalPayment">Final payment</Label>
                    <Input
                      id="finalPayment"
                      type="number"
                      min={balanceBefore}
                      step="0.01"
                      value={finalPayment}
                      onChange={(e) => setFinalPayment(e.target.value)}
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
              )}
              {balanceBefore > 0 && !canComplete && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Collect ₱{balanceBefore.toFixed(2)} before checking out.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={submitting || !canComplete}>
                {submitting && <Loader2Icon className="size-4 animate-spin" />}
                Complete checkout
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Checked out</DialogTitle>
              <DialogDescription>
                Room {room.roomNumber} is now marked for cleaning.
              </DialogDescription>
            </DialogHeader>

            <div className="print-area flex flex-col gap-2 rounded-lg border p-4 text-sm">
              <div className="text-center">
                <div className="font-heading text-base font-semibold">Marimar Inn</div>
                <div className="text-xs text-muted-foreground">Official Receipt</div>
                <div className="text-xs text-muted-foreground">
                  Ref: {referenceNumberFor(booking.bookingId)}
                </div>
              </div>
              <div className="my-1 border-t" />
              <div className="flex justify-between">
                <span>Room</span>
                <span>{room.roomNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Guest</span>
                <span>{booking.guestName}</span>
              </div>
              <div className="flex justify-between">
                <span>Check-in</span>
                <span>{booking.checkInTime.toDate().toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Check-out</span>
                <span>{(checkOutTime ?? now).toLocaleString()}</span>
              </div>
              <div className="my-1 border-t" />
              <div className="flex justify-between">
                <span>
                  Room charge{" "}
                  {booking.openEnded ? "(open time)" : `(${receiptData.hoursBooked}h)`}
                </span>
                <span>₱{receiptData.totalRoomCharge.toFixed(2)}</span>
              </div>
              {booking.items.length > 0 && (
                <>
                  {booking.items.map((line) => (
                    <div key={line.itemId} className="flex justify-between text-muted-foreground">
                      <span>
                        {line.quantity}× {line.name}
                      </span>
                      <span>₱{line.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span>Store items total</span>
                    <span>₱{booking.totalFbCharge.toFixed(2)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>₱{receiptData.totalAmount.toFixed(2)}</span>
              </div>
              {receiptCashPaid > 0 && receiptGcashPaid > 0 ? (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paid via Cash</span>
                    <span>₱{receiptCashPaid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paid via GCash</span>
                    <span>₱{receiptGcashPaid.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-muted-foreground">
                  <span>Paid via {PAYMENT_METHOD_LABELS[booking.paymentMethod]}</span>
                  <span>₱{finalAmountPaid.toFixed(2)}</span>
                </div>
              )}
              {(booking.paymentMethod === "gcash" || booking.paymentMethod === "split") &&
                booking.gcashReference && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>GCash Ref</span>
                    <span>{booking.gcashReference}</span>
                  </div>
                )}
              {change > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Change</span>
                  <span>₱{change.toFixed(2)}</span>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
