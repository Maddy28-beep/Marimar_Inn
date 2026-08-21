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
import { Label } from "@/components/ui/label";
import {
  convertToOpenTime,
  extendStay,
  hoursElapsed,
  isTooOverdueToExtend,
  OPEN_TIME_RATE_PER_HOUR,
  REGULAR_BOOKING_MIN_HOURS,
} from "@/lib/bookings";
import { subscribeToRatePackages } from "@/lib/rooms";
import { formatHours } from "@/lib/time";
import { useNowTick } from "@/hooks/use-now-tick";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useAuth } from "@/context/auth-context";
import { ReceiptBrandHeader } from "@/components/receipt-brand-header";
import { ReceiptPreviewStrip } from "@/components/receipt-preview";
import {
  printExtensionReceipt,
  previewExtensionReceipt,
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
import { type Booking, type PaymentMethod, type RatePackage, type Room } from "@/lib/types";
import { Loader2Icon, PrinterIcon } from "lucide-react";

interface ExtendStayDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
}

type ExtendMode = "package" | "open";

export function ExtendStayDialog({ room, booking, onClose }: ExtendStayDialogProps) {
  const now = useNowTick(1000);
  const printer = useReceiptPrinter();
  const { appUser } = useAuth();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [mode, setMode] = useState<ExtendMode>("package");
  const [ratePackages, setRatePackages] = useState<RatePackage[] | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>(emptyPaymentDraft);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{
    hours: number;
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

  useEffect(() => subscribeToRatePackages(setRatePackages), []);

  useEffect(() => {
    if (!ratePackages?.length) return;
    setSelectedPackageId((current) => current ?? ratePackages[0].packageId);
    setPayment((current) => {
      if (current.method !== "cash" || current.amountPaid !== "") return current;
      return { ...current, amountPaid: String(ratePackages[0].price) };
    });
  }, [ratePackages]);

  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  const overdueMinutes = remaining < 0 ? -remaining * 60 : 0;
  const tooOverdueToExtend = isTooOverdueToExtend(booking, now);
  const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
  const packagePrice = booking.originalPackagePrice ?? booking.totalRoomCharge;
  const selectedPackage =
    ratePackages?.find((pkg) => pkg.packageId === selectedPackageId) ?? ratePackages?.[0] ?? null;
  const additionalHours = selectedPackage?.hours ?? 0;
  const additionalCost = selectedPackage?.price ?? 0;
  const paid = collectedAmount(payment, additionalCost);
  const change = paid > additionalCost ? paid - additionalCost : 0;

  async function handleExtendByPackage() {
    if (tooOverdueToExtend) {
      toast.error("Too overdue for a quick extension — check out and start a new 3h booking.");
      return;
    }
    if (!selectedPackage || additionalHours <= 0 || additionalCost <= 0) {
      toast.error("Pick a rate package to extend.");
      return;
    }
    setSubmitting(true);
    const amountCollected = Math.min(paid, additionalCost);
    const payload = paymentPayload(payment, additionalCost);
    try {
      await extendStay(booking, additionalHours, additionalCost, amountCollected, {
        paymentMethod: payload.paymentMethod,
        gcashReference: payload.gcashReference,
        qrphReference: payload.qrphReference,
        splitCashAmount: payload.splitCashAmount,
        splitGcashAmount: payload.splitGcashAmount,
        splitQrphAmount: payload.splitQrphAmount,
      });
      toast.success(`Room ${room.roomNumber} extended by ${additionalHours}h.`);
      if (printer.connected) {
        try {
          await printExtensionReceipt(booking, room, {
            staffName,
            hours: additionalHours,
            amountCharged: additionalCost,
            amountPaid: amountCollected,
            change,
            paymentMethod: payload.paymentMethod,
            gcashReference: payload.gcashReference,
            qrphReference: payload.qrphReference,
            splitCashAmount: payload.splitCashAmount,
            splitGcashAmount: payload.splitGcashAmount,
            splitQrphAmount: payload.splitQrphAmount,
            kickDrawer: shouldOpenDrawer(cashCollectedNow(payment, additionalCost)),
          });
        } catch (error) {
          toast.error(`Extended, but the printer said: ${printerErrorMessage(error)}`);
        }
      }
      setReceipt({
        hours: additionalHours,
        amountCharged: additionalCost,
        amountPaid: amountCollected,
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
      console.error(error);
      toast.error("Couldn't extend the stay — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function printThermalCopy() {
    if (!printer.connected || !receipt) return;
    try {
      await printExtensionReceipt(booking, room, {
        staffName,
        hours: receipt.hours,
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

  async function handleConvertToOpenTime() {
    if (tooOverdueToExtend) {
      toast.error("Too overdue to extend — check out and start a new 3h booking.");
      return;
    }
    setSubmitting(true);
    try {
      await convertToOpenTime(booking.bookingId);
      toast.success(`Room ${room.roomNumber} switched to open time.`);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Couldn't switch to open time — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (booking.openEnded) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Room {room.roomNumber} — open time</DialogTitle>
            <DialogDescription>{booking.guestName}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This room has no fixed end time. Enter the final room charge when
            the guest checks out.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (phase === "receipt" && receipt) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extended</DialogTitle>
            <DialogDescription>
              Room {room.roomNumber} — hand this receipt to the guest.
            </DialogDescription>
          </DialogHeader>

          <div className="print-area flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <ReceiptBrandHeader
              subtitle="Extension Receipt"
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
            <div className="flex justify-between font-medium">
              <span>+{receipt.hours}h extension</span>
              <span>₱{receipt.amountCharged.toFixed(2)}</span>
            </div>
            <PaymentBreakdownDisplay
              portions={{
                cash: receipt.splitCashAmount ?? 0,
                gcash: receipt.splitGcashAmount ?? 0,
                qrph: receipt.splitQrphAmount ?? 0,
              }}
              method={receipt.paymentMethod}
              amountPaid={receipt.amountPaid}
              gcashReference={receipt.gcashReference}
              qrphReference={receipt.qrphReference}
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
                lines={previewExtensionReceipt(booking, room, {
                  staffName,
                  hours: receipt.hours,
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
                Reprint (thermal)
              </Button>
            )}
            <Button onClick={() => window.print()}>
              <PrinterIcon className="size-4" />
              Print receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Extend stay — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>
            {booking.guestName} ·{" "}
            {remaining > 0 ? `${remaining.toFixed(1)}h remaining` : "Overdue"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-base font-bold">Extend by</Label>
            <div className="flex flex-wrap gap-1.5">
              {ratePackages?.map((pkg) => (
                <Button
                  key={pkg.packageId}
                  type="button"
                  size="sm"
                  className="font-semibold"
                  variant={mode === "package" && selectedPackage?.packageId === pkg.packageId ? "default" : "outline"}
                  onClick={() => {
                    setMode("package");
                    setSelectedPackageId(pkg.packageId);
                    setPayment((current) =>
                      current.method === "cash" ? { ...current, amountPaid: String(pkg.price) } : current
                    );
                  }}
                  disabled={submitting || tooOverdueToExtend}
                >
                  {pkg.hours}h · ₱{pkg.price}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                className="font-semibold"
                variant={mode === "open" ? "default" : "outline"}
                onClick={() => setMode("open")}
                disabled={submitting || tooOverdueToExtend}
              >
                Open time
              </Button>
            </div>
          </div>

          {tooOverdueToExtend ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              This room is already {formatHours(overdueMinutes / 60)} overdue — too late to
              extend, either by the hour or to open time. Check the guest out and start a new
              booking ({REGULAR_BOOKING_MIN_HOURS}h / ₱200 minimum) instead.
            </p>
          ) : mode === "package" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Adds the selected package onto this stay — {additionalHours}h for ₱{additionalCost.toFixed(2)}.
              </p>

              <PaymentFields
                draft={payment}
                onChange={setPayment}
                due={additionalCost}
                disabled={submitting}
                idPrefix="extend"
              />
            </>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              The {packageHours}h package (₱{packagePrice.toFixed(2)}) still applies in full —
              this only removes the fixed end time so the stay can keep going past it. No
              charge is collected now; at checkout, any time beyond the {packageHours}h bills
              on top at ₱{OPEN_TIME_RATE_PER_HOUR}/hr in 30-min blocks.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {mode === "package" ? (
            <Button
              onClick={() => void handleExtendByPackage()}
              disabled={submitting || tooOverdueToExtend || !selectedPackage}
              title={tooOverdueToExtend ? "Too overdue — start a new 3h booking instead" : undefined}
            >
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Extend {additionalHours}h · ₱{additionalCost.toFixed(2)}
            </Button>
          ) : (
            <Button
              onClick={handleConvertToOpenTime}
              disabled={submitting || tooOverdueToExtend}
              title={tooOverdueToExtend ? "Too overdue — start a new 3h booking instead" : undefined}
            >
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Switch to open time
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
