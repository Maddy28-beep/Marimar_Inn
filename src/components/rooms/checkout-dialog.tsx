"use client";

import { useEffect, useState } from "react";
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
  hoursElapsed,
} from "@/lib/bookings";
import { type Booking, type Room } from "@/lib/types";
import { bookingExtras, isAmenityItem } from "@/lib/booking-extras";
import { useNowTick } from "@/hooks/use-now-tick";
import { useAuth } from "@/context/auth-context";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { ReceiptBrandHeader } from "@/components/receipt-brand-header";
import { ReceiptPreviewStrip } from "@/components/receipt-preview";
import { printThermalReceipt, previewGuestReceipt, printerErrorMessage, referenceNumberFor, kickDrawerForCashPayment, staffFirstName } from "@/lib/receipt-printer";
import {
  cashCollectedNow,
  collectedAmount,
  emptyPaymentDraft,
  PaymentBreakdownDisplay,
  PaymentFields,
  paymentPayload,
  type PaymentDraft,
} from "@/components/payments/payment-fields";
import { Loader2Icon, PrinterIcon } from "lucide-react";

interface CheckoutDialogProps {
  room: Room;
  booking: Booking;
  staffName: string;
  cashierId: string;
  onClose: () => void;
}

export function CheckoutDialog({ room, booking, staffName, cashierId, onClose }: CheckoutDialogProps) {
  const { appUser } = useAuth();
  const now = useNowTick(1000);
  const printer = useReceiptPrinter();
  const [phase, setPhase] = useState<"confirm" | "receipt">("confirm");
  const [payment, setPayment] = useState<PaymentDraft>(emptyPaymentDraft);
  // The original package (e.g. 3h/₱200) is a floor, not something open time
  // replaces — converting to open time only changes what happens *after*
  // that package's hours run out. Checking out before then still owes the
  // full package price; only the overage bills at ₱100/hr in 30-min blocks.
  // Auto-calculated once at open time — the cashier can still override it
  // for edge cases.
  const [openTimeCharge, setOpenTimeCharge] = useState(() => {
    if (!booking.openEnded) return String(booking.totalRoomCharge);
    const extrasOnBooking = bookingExtras(booking);
    const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
    const packagePrice =
      booking.originalPackagePrice ??
      Math.max(0, booking.totalRoomCharge - extrasOnBooking.extraPersonAmount);
    const extraHours = Math.max(0, hoursElapsed(booking.checkInTime, now) - packageHours);
    return String(packagePrice + extrasOnBooking.extraPersonAmount + computeOpenTimeCharge(extraHours));
  });
  const { submitting, guard } = useSubmitGuard();
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
  const receiptPortions = paymentBreakdown(receiptData);

  const balanceBefore = Math.max(effectiveTotalAmount - booking.amountPaid, 0);
  const paid = balanceBefore > 0 ? collectedAmount(payment, balanceBefore) : 0;
  const change = paid > balanceBefore ? paid - balanceBefore : 0;
  const finalAmountPaid = booking.amountPaid + Math.min(paid, balanceBefore);
  const canComplete = Math.round(paid * 100) >= Math.round(balanceBefore * 100);

  useEffect(() => {
    if (balanceBefore <= 0) return;
    setPayment((current) => {
      if (current.method !== "cash" || current.amountPaid !== "") return current;
      return { ...current, amountPaid: balanceBefore.toFixed(2) };
    });
  }, [balanceBefore]);

  async function printThermalCopy() {
    if (!printer.connected || !settledBooking) return;
    try {
      await printThermalReceipt(settledBooking, room, { staffName, finalAmountPaid, change });
    } catch (error) {
      toast.error(printerErrorMessage(error));
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
    await guard(submitCheckout);
  }

  async function submitCheckout() {
    const amountCollectedNow = Math.min(paid, balanceBefore);
    const payload = amountCollectedNow > 0 ? paymentPayload(payment, balanceBefore) : undefined;
    const priorSplit = paymentBreakdown(effectiveBooking);
    const thisSplit = payload
      ? methodContribution(payload.paymentMethod, amountCollectedNow, {
          cash: payload.splitCashAmount,
          gcash: payload.splitGcashAmount,
          qrph: payload.splitQrphAmount,
        })
      : { cash: 0, gcash: 0, qrph: 0 };
    const finalBooking: Booking = {
      ...effectiveBooking,
      amountPaid: finalAmountPaid,
      paymentMethod: payload?.paymentMethod ?? effectiveBooking.paymentMethod,
      gcashReference: payload?.gcashReference ?? effectiveBooking.gcashReference,
      qrphReference: payload?.qrphReference ?? effectiveBooking.qrphReference,
      splitCashAmount: priorSplit.cash + thisSplit.cash,
      splitGcashAmount: priorSplit.gcash + thisSplit.gcash,
      splitQrphAmount: priorSplit.qrph + thisSplit.qrph,
    };
    try {
      await recordCheckout(
        booking,
        amountCollectedNow,
        { uid: cashierId, name: staffName, role: appUser?.role },
        payload
          ? {
              paymentMethod: payload.paymentMethod,
              gcashReference: payload.gcashReference,
              qrphReference: payload.qrphReference,
              splitCashAmount: payload.splitCashAmount,
              splitGcashAmount: payload.splitGcashAmount,
              splitQrphAmount: payload.splitQrphAmount,
            }
          : undefined,
        booking.openEnded
          ? {
              finalRoomCharge: effectiveRoomCharge,
              actualHoursStayed: Math.round(hoursUsed * 10) / 10,
            }
          : undefined
      );
      setSettledBooking(finalBooking);
      setCheckOutTime(new Date());
      setPhase("receipt");

      const cashNow =
        amountCollectedNow > 0 ? cashCollectedNow(payment, balanceBefore) : 0;
      if (printer.connected) {
        try {
          await kickDrawerForCashPayment(cashNow);
        } catch (error) {
          toast.error(`Checked out, but the drawer said: ${printerErrorMessage(error)}`);
        }
      }
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error && error.message && !error.message.toLowerCase().includes("permission")
          ? error.message
          : "Couldn't complete checkout — please try again.";
      toast.error(message);
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
                <PaymentFields
                  draft={payment}
                  onChange={setPayment}
                  due={balanceBefore}
                  disabled={submitting}
                  idPrefix="checkout"
                />
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
              <Button onClick={handleConfirm} disabled={submitting}>
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
              <ReceiptBrandHeader
                subtitle="This is not an official receipt"
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
              <div className="flex justify-between">
                <span>Check-in</span>
                <span>{booking.checkInTime.toDate().toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Check-out</span>
                <span>{(checkOutTime ?? now).toLocaleString()}</span>
              </div>
              <div className="my-1 border-t" />
              {(() => {
                const extrasOnReceipt = bookingExtras(receiptData);
                const packageHours = receiptData.originalPackageHours ?? receiptData.hoursBooked;
                const packagePrice =
                  receiptData.originalPackagePrice ??
                  Math.max(0, receiptData.totalRoomCharge - extrasOnReceipt.extraPersonAmount);
                const extensionHours = receiptData.openEnded
                  ? 0
                  : Math.max(0, (receiptData.hoursBooked ?? packageHours) - packageHours);
                const extensionAmount = Math.max(
                  0,
                  receiptData.totalRoomCharge - packagePrice - extrasOnReceipt.extraPersonAmount
                );
                const storeItems = receiptData.items.filter((line) => !isAmenityItem(line));
                const storeTotal = Math.max(0, receiptData.totalFbCharge - extrasOnReceipt.amenityAmount);
                return (
                  <>
                    <div className="flex justify-between">
                      <span>
                        Room {receiptData.openEnded ? "(open time)" : `(${packageHours}h)`}
                      </span>
                      <span>₱{packagePrice.toFixed(2)}</span>
                    </div>
                    {extrasOnReceipt.extraPersons > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{extrasOnReceipt.extraPersons}× Extra/Request</span>
                        <span>₱{extrasOnReceipt.extraPersonAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {extrasOnReceipt.towels > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{extrasOnReceipt.towels}× Towel</span>
                        <span>₱{extrasOnReceipt.towelAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {extrasOnReceipt.blankets > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{extrasOnReceipt.blankets}× Blanket</span>
                        <span>₱{extrasOnReceipt.blanketAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {extensionAmount > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>
                          {receiptData.openEnded
                            ? "Open time"
                            : `+${extensionHours}h extension`}
                        </span>
                        <span>₱{extensionAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {storeItems.map((line) => (
                      <div key={line.itemId} className="flex justify-between text-muted-foreground">
                        <span>
                          {line.quantity}× {line.name}
                        </span>
                        <span>₱{line.subtotal.toFixed(2)}</span>
                      </div>
                    ))}
                    {storeTotal > 0 && (
                      <div className="flex justify-between">
                        <span>Store items total</span>
                        <span>₱{storeTotal.toFixed(2)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>₱{receiptData.totalAmount.toFixed(2)}</span>
              </div>
              <PaymentBreakdownDisplay
                portions={receiptPortions}
                method={receiptData.paymentMethod}
                amountPaid={finalAmountPaid}
                gcashReference={receiptData.gcashReference}
                qrphReference={receiptData.qrphReference}
                change={change}
              />
              <div className="my-1 border-t" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Staff</span>
                <span>{staffFirstName(staffName)}</span>
              </div>
            </div>

            {settledBooking ? (
              <div className="print:hidden flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">Thermal printer preview</p>
                <div className="max-h-72 overflow-y-auto rounded-md bg-muted/40 p-2">
                  <ReceiptPreviewStrip
                    lines={previewGuestReceipt(settledBooking, room, {
                      staffName,
                      finalAmountPaid,
                      change,
                    })}
                    paperWidth={printer.paperWidth}
                  />
                </div>
              </div>
            ) : null}

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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
