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
import { recordCheckout, hoursElapsed } from "@/lib/bookings";
import { PAYMENT_METHOD_LABELS, type Booking, type Room } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { Loader2Icon, PrinterIcon } from "lucide-react";

interface CheckoutDialogProps {
  room: Room;
  booking: Booking;
  staffName: string;
  onClose: () => void;
}

export function CheckoutDialog({ room, booking, staffName, onClose }: CheckoutDialogProps) {
  const now = useNowTick(1000);
  const [phase, setPhase] = useState<"confirm" | "receipt">("confirm");
  const [finalPayment, setFinalPayment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkOutTime, setCheckOutTime] = useState<Date | null>(null);

  const balanceBefore = Math.max(booking.totalAmount - booking.amountPaid, 0);
  const paymentInput = Number(finalPayment) || 0;
  const change = paymentInput > balanceBefore ? paymentInput - balanceBefore : 0;
  const finalAmountPaid = booking.amountPaid + Math.min(paymentInput, balanceBefore);
  const hoursUsed = hoursElapsed(booking.checkInTime, now);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await recordCheckout(booking, Math.min(paymentInput, balanceBefore));
      setCheckOutTime(new Date());
      setPhase("receipt");
    } catch {
      toast.error("Couldn't complete checkout — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {phase === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>Check out — Room {room.roomNumber}</DialogTitle>
              <DialogDescription>{booking.guestName}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hours used</span>
                  <span>{hoursUsed.toFixed(1)}h of {booking.hoursBooked}h booked</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Room charge</span>
                  <span>₱{booking.totalRoomCharge.toFixed(2)}</span>
                </div>
                {booking.totalFbCharge > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Store items</span>
                    <span>₱{booking.totalFbCharge.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-medium">
                  <span>Total due</span>
                  <span>₱{booking.totalAmount.toFixed(2)}</span>
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

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="finalPayment">Final payment</Label>
                  <Input
                    id="finalPayment"
                    type="number"
                    min={0}
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
              <div className="text-center">
                <div className="font-heading text-base font-semibold">Marimar Inn</div>
                <div className="text-xs text-muted-foreground">Official Receipt</div>
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
                <span>Room charge ({booking.hoursBooked}h)</span>
                <span>₱{booking.totalRoomCharge.toFixed(2)}</span>
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
                <span>₱{booking.totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Paid via {PAYMENT_METHOD_LABELS[booking.paymentMethod]}</span>
                <span>₱{finalAmountPaid.toFixed(2)}</span>
              </div>
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
