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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  convertToOpenTime,
  extendStay,
  hoursElapsed,
  OPEN_TIME_RATE_PER_HOUR,
} from "@/lib/bookings";
import { PAYMENT_METHOD_LABELS, type Booking, type PaymentMethod, type Room } from "@/lib/types";
import { formatHours } from "@/lib/time";
import { useNowTick } from "@/hooks/use-now-tick";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useAuth } from "@/context/auth-context";
import {
  printExtensionReceipt,
  printerErrorMessage,
  referenceNumberFor,
  shouldOpenDrawer,
} from "@/lib/receipt-printer";
import { Loader2Icon, PrinterIcon } from "lucide-react";

interface ExtendStayDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
}

type ExtendMode = "hour" | "open";

// Past this much overdue, neither extend option is offered — "+1 hour"
// is a cheap flat top-up that undercharges a guest who's been gone a while,
// and "Open time" would let the same guest linger indefinitely without
// ever having to commit to a fresh booking. The guest goes through a
// regular booking (3h minimum) instead. A short grace window still covers
// someone just a few minutes behind wrapping up.
const EXTEND_OVERDUE_CUTOFF_MINUTES = 10;
const REGULAR_BOOKING_MIN_HOURS = 3;

export function ExtendStayDialog({ room, booking, onClose }: ExtendStayDialogProps) {
  const now = useNowTick(1000);
  const printer = useReceiptPrinter();
  const { appUser } = useAuth();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [mode, setMode] = useState<ExtendMode>("hour");
  const [hourPrice, setHourPrice] = useState(String(OPEN_TIME_RATE_PER_HOUR));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [gcashReference, setGcashReference] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitGcash, setSplitGcash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{
    amountCharged: number;
    amountPaid: number;
    change: number;
    paymentMethod: PaymentMethod;
    gcashReference?: string;
    splitCashAmount?: number;
    splitGcashAmount?: number;
  } | null>(null);

  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  const overdueMinutes = remaining < 0 ? -remaining * 60 : 0;
  const tooOverdueToExtend = overdueMinutes >= EXTEND_OVERDUE_CUTOFF_MINUTES;
  const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
  const packagePrice = booking.originalPackagePrice ?? booking.totalRoomCharge;
  const additionalCost = Number(hourPrice) || 0;
  const splitCashValue = Number(splitCash) || 0;
  const splitGcashValue = Number(splitGcash) || 0;
  const paid =
    paymentMethod === "gcash"
      ? additionalCost
      : paymentMethod === "split"
        ? splitCashValue + splitGcashValue
        : Number(amountPaid) || 0;
  const change = paid > additionalCost ? paid - additionalCost : 0;

  async function handleExtendByHour() {
    if (tooOverdueToExtend) {
      toast.error("Too overdue for a quick extension — start a new booking instead.");
      return;
    }
    if (additionalCost <= 0) {
      toast.error("Enter the price for the extra hour.");
      return;
    }
    setSubmitting(true);
    const amountCollected = Math.min(paid, additionalCost);
    const usesGcashRef = paymentMethod === "gcash" || paymentMethod === "split";
    const cashPortion = paymentMethod === "split" ? splitCashValue : amountCollected;
    const gcashPortion = paymentMethod === "split" ? splitGcashValue : undefined;
    try {
      await extendStay(booking, 1, additionalCost, amountCollected, {
        paymentMethod,
        gcashReference: usesGcashRef ? gcashReference.trim() || undefined : undefined,
        splitCashAmount: paymentMethod === "split" ? splitCashValue : undefined,
        splitGcashAmount: gcashPortion,
      });
      toast.success(`Room ${room.roomNumber} extended by 1h.`);
      if (printer.connected) {
        try {
          await printExtensionReceipt(booking, room, {
            staffName,
            hours: 1,
            amountCharged: additionalCost,
            amountPaid: amountCollected,
            change,
            paymentMethod,
            gcashReference: usesGcashRef ? gcashReference.trim() || undefined : undefined,
            splitCashAmount: paymentMethod === "split" ? splitCashValue : undefined,
            splitGcashAmount: gcashPortion,
            kickDrawer: shouldOpenDrawer(paymentMethod, cashPortion),
          });
        } catch (error) {
          toast.error(`Extended, but the printer said: ${printerErrorMessage(error)}`);
        }
      }
      setReceipt({
        amountCharged: additionalCost,
        amountPaid: amountCollected,
        change,
        paymentMethod,
        gcashReference: usesGcashRef ? gcashReference.trim() || undefined : undefined,
        splitCashAmount: paymentMethod === "split" ? splitCashValue : undefined,
        splitGcashAmount: gcashPortion,
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
        hours: 1,
        amountCharged: receipt.amountCharged,
        amountPaid: receipt.amountPaid,
        change: receipt.change,
        paymentMethod: receipt.paymentMethod,
        gcashReference: receipt.gcashReference,
        splitCashAmount: receipt.splitCashAmount,
        splitGcashAmount: receipt.splitGcashAmount,
      });
    } catch (error) {
      toast.error(printerErrorMessage(error));
    }
  }

  async function handleConvertToOpenTime() {
    if (tooOverdueToExtend) {
      toast.error("Too overdue to extend — start a new booking instead.");
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
            <div className="text-center">
              <div className="font-heading text-base font-semibold">Marimar Inn</div>
              <div className="text-xs text-muted-foreground">Extension Receipt</div>
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
            <div className="my-1 border-t" />
            <div className="flex justify-between font-medium">
              <span>+1h extension</span>
              <span>₱{receipt.amountCharged.toFixed(2)}</span>
            </div>
            {receipt.paymentMethod === "split" ? (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Paid via Cash</span>
                  <span>₱{(receipt.splitCashAmount ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Paid via GCash</span>
                  <span>₱{(receipt.splitGcashAmount ?? 0).toFixed(2)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-muted-foreground">
                <span>Paid via {PAYMENT_METHOD_LABELS[receipt.paymentMethod]}</span>
                <span>₱{receipt.amountPaid.toFixed(2)}</span>
              </div>
            )}
            {(receipt.paymentMethod === "gcash" || receipt.paymentMethod === "split") &&
              receipt.gcashReference && (
                <div className="flex justify-between text-muted-foreground">
                  <span>GCash Ref</span>
                  <span>{receipt.gcashReference}</span>
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
            <Label>Extend by</Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={mode === "hour" ? "default" : "outline"}
                onClick={() => setMode("hour")}
                disabled={submitting}
              >
                +1 hour
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "open" ? "default" : "outline"}
                onClick={() => setMode("open")}
                disabled={submitting}
              >
                Open time
              </Button>
            </div>
          </div>

          {tooOverdueToExtend ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              This room is already {formatHours(overdueMinutes / 60)} overdue — too late to
              extend, either by the hour or to open time. Check the guest out and start a new
              booking ({REGULAR_BOOKING_MIN_HOURS}h minimum) instead.
            </p>
          ) : mode === "hour" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hourPrice">Price for the hour</Label>
                <Input
                  id="hourPrice"
                  type="number"
                  min={0}
                  value={hourPrice}
                  onChange={(e) => setHourPrice(e.target.value)}
                  disabled={submitting}
                  className="max-w-40"
                />
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

              {(paymentMethod === "gcash" || paymentMethod === "split") && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="extGcashReference">GCash reference number</Label>
                  <Input
                    id="extGcashReference"
                    value={gcashReference}
                    onChange={(e) => setGcashReference(e.target.value)}
                    placeholder="e.g. 1234 567 890123"
                    disabled={submitting}
                  />
                </div>
              )}

              {paymentMethod === "gcash" ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Amount paid</Label>
                  <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                    Full amount — ₱{additionalCost.toFixed(2)} via GCash
                  </div>
                </div>
              ) : paymentMethod === "split" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="extSplitCash">Cash amount</Label>
                    <Input
                      id="extSplitCash"
                      type="number"
                      min={0}
                      value={splitCash}
                      onChange={(e) => setSplitCash(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="extSplitGcash">GCash amount</Label>
                    <Input
                      id="extSplitGcash"
                      type="number"
                      min={0}
                      value={splitGcash}
                      onChange={(e) => setSplitGcash(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : (
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
              )}

              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Change</span>
                <span className="font-medium">₱{change.toFixed(2)}</span>
              </div>
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
          {mode === "hour" ? (
            <Button
              onClick={handleExtendByHour}
              disabled={submitting || tooOverdueToExtend}
              title={tooOverdueToExtend ? "Too overdue — start a new booking instead" : undefined}
            >
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Extend by 1 hour
            </Button>
          ) : (
            <Button
              onClick={handleConvertToOpenTime}
              disabled={submitting || tooOverdueToExtend}
              title={tooOverdueToExtend ? "Too overdue — start a new booking instead" : undefined}
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
