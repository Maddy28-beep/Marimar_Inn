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
  convertToOpenTime,
  extendStay,
  hoursElapsed,
  OPEN_TIME_RATE_PER_HOUR,
} from "@/lib/bookings";
import { PAYMENT_METHOD_LABELS, type Booking, type Room } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useAuth } from "@/context/auth-context";
import {
  openCashDrawer,
  printExtensionReceipt,
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

export function ExtendStayDialog({ room, booking, onClose }: ExtendStayDialogProps) {
  const now = useNowTick(1000);
  const printer = useReceiptPrinter();
  const { appUser } = useAuth();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [mode, setMode] = useState<ExtendMode>("hour");
  const [hourPrice, setHourPrice] = useState(String(OPEN_TIME_RATE_PER_HOUR));
  const [amountPaid, setAmountPaid] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{
    amountCharged: number;
    amountPaid: number;
    change: number;
  } | null>(null);

  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
  const packagePrice = booking.originalPackagePrice ?? booking.totalRoomCharge;
  const additionalCost = Number(hourPrice) || 0;
  const paid = Number(amountPaid) || 0;
  const change = paid > additionalCost ? paid - additionalCost : 0;

  async function handleExtendByHour() {
    if (additionalCost <= 0) {
      toast.error("Enter the price for the extra hour.");
      return;
    }
    setSubmitting(true);
    const amountCollected = Math.min(paid, additionalCost);
    try {
      await extendStay(booking, 1, additionalCost, amountCollected);
      toast.success(`Room ${room.roomNumber} extended by 1h.`);
      if (printer.connected) {
        if (shouldOpenDrawer(booking.paymentMethod, amountCollected)) {
          try {
            openCashDrawer();
          } catch {
            toast.error("Extended, but couldn't open the cash drawer.");
          }
        }
        try {
          printExtensionReceipt(booking, room, {
            staffName,
            hours: 1,
            amountCharged: additionalCost,
            amountPaid: amountCollected,
            change,
          });
        } catch {
          toast.error("Extended, but the thermal printer didn't respond.");
        }
      }
      setReceipt({ amountCharged: additionalCost, amountPaid: amountCollected, change });
      setPhase("receipt");
    } catch (error) {
      console.error(error);
      toast.error("Couldn't extend the stay — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function printThermalCopy() {
    if (!printer.connected || !receipt) return;
    try {
      printExtensionReceipt(booking, room, {
        staffName,
        hours: 1,
        amountCharged: receipt.amountCharged,
        amountPaid: receipt.amountPaid,
        change: receipt.change,
      });
    } catch {
      toast.error("Couldn't print to the thermal printer.");
    }
  }

  async function handleConvertToOpenTime() {
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
            <div className="flex justify-between text-muted-foreground">
              <span>Paid via {PAYMENT_METHOD_LABELS[booking.paymentMethod]}</span>
              <span>₱{receipt.amountPaid.toFixed(2)}</span>
            </div>
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

          {mode === "hour" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="hourPrice">Price for the hour</Label>
                  <Input
                    id="hourPrice"
                    type="number"
                    min={0}
                    value={hourPrice}
                    onChange={(e) => setHourPrice(e.target.value)}
                    disabled={submitting}
                  />
                </div>
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
              </div>

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
            <Button onClick={handleExtendByHour} disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Extend by 1 hour
            </Button>
          ) : (
            <Button onClick={handleConvertToOpenTime} disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Switch to open time
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
