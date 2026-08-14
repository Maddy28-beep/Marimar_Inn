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
import { voidBooking, hoursElapsed } from "@/lib/bookings";
import { PAYMENT_METHOD_LABELS, type Booking, type Room } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { Loader2Icon } from "lucide-react";

interface RoomDetailDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
  onRequestCheckout: () => void;
}

function formatHours(hours: number): string {
  const sign = hours < 0 ? "-" : "";
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `${sign}${h}h ${m}m`;
}

export function RoomDetailDialog({
  room,
  booking,
  onClose,
  onRequestCheckout,
}: RoomDetailDialogProps) {
  const now = useNowTick(1000);
  const [voiding, setVoiding] = useState(false);

  const elapsed = hoursElapsed(booking.checkInTime, now);
  const remaining = booking.hoursBooked - elapsed;
  const isOverdue = remaining <= 0;
  const isRunningLow = !isOverdue && remaining <= 0.5;
  const balance = Math.max(booking.totalAmount - booking.amountPaid, 0);

  async function handleVoid() {
    if (!window.confirm(`Cancel this booking for Room ${room.roomNumber}? This frees up the room without checking out.`)) {
      return;
    }
    setVoiding(true);
    try {
      await voidBooking(booking);
      toast.success(`Booking for Room ${room.roomNumber} cancelled.`);
      onClose();
    } catch {
      toast.error("Couldn't cancel the booking — please try again.");
    } finally {
      setVoiding(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Room {room.roomNumber} — {booking.guestName}</DialogTitle>
          <DialogDescription>
            Checked in {booking.checkInTime.toDate().toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div
            className={
              isOverdue
                ? "rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400"
                : isRunningLow
                  ? "rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-400"
                  : "rounded-lg bg-muted px-3 py-2 text-sm font-medium"
            }
          >
            {isOverdue
              ? `Overdue by ${formatHours(-remaining)}`
              : `${formatHours(remaining)} remaining`}
            {isRunningLow && !isOverdue && " — less than 30 minutes left"}
          </div>

          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            {booking.guestPhone && (
              <>
                <dt className="text-muted-foreground">Contact</dt>
                <dd>{booking.guestPhone}</dd>
              </>
            )}
            {booking.guestCount !== undefined && (
              <>
                <dt className="text-muted-foreground">Guests</dt>
                <dd>{booking.guestCount}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Booked hours</dt>
            <dd>{booking.hoursBooked}h</dd>
            {booking.specialRequests && (
              <>
                <dt className="text-muted-foreground">Requests</dt>
                <dd>{booking.specialRequests}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Room charge</span>
              <span>₱{booking.totalRoomCharge.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between font-medium">
              <span>Total</span>
              <span>₱{booking.totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Paid ({PAYMENT_METHOD_LABELS[booking.paymentMethod]})</span>
              <span>₱{booking.amountPaid.toFixed(2)}</span>
            </div>
            {balance > 0 && (
              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                <span>Balance</span>
                <span>₱{balance.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleVoid}
            disabled={voiding}
            className="text-muted-foreground"
          >
            {voiding && <Loader2Icon className="size-4 animate-spin" />}
            Cancel booking
          </Button>
          <Button onClick={onRequestCheckout} disabled={voiding}>
            Check out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
