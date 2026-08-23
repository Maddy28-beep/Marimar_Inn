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
import { voidBooking, hoursElapsed, paymentBreakdown, isTooOverdueToExtend, canVoidBooking } from "@/lib/bookings";
import { removeOrderItem } from "@/lib/orders";
import type { Booking, Room } from "@/lib/types";
import { formatHours } from "@/lib/time";
import { useNowTick } from "@/hooks/use-now-tick";
import { useAuth } from "@/context/auth-context";
import { isOwnerLikeRole } from "@/lib/roles";
import { OrderPickerDialog } from "@/components/inventory/order-picker-dialog";
import { ExtendStayDialog } from "@/components/rooms/extend-stay-dialog";
import { Loader2Icon, ShoppingCartIcon, TimerIcon, XIcon } from "lucide-react";

interface RoomDetailDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
  onRequestCheckout: () => void;
}

export function RoomDetailDialog({
  room,
  booking,
  onClose,
  onRequestCheckout,
}: RoomDetailDialogProps) {
  const { appUser } = useAuth();
  const now = useNowTick(1000);
  const [voiding, setVoiding] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);

  const elapsed = hoursElapsed(booking.checkInTime, now);
  const remaining = booking.hoursBooked - elapsed;
  const tooOverdueToExtend = isTooOverdueToExtend(booking, now);
  const canCancel = canVoidBooking(booking, now);
  const isOverdue = !booking.openEnded && remaining <= 0;
  const isRunningLow = !booking.openEnded && !isOverdue && remaining <= 0.5;
  const balance = Math.max(booking.totalAmount - booking.amountPaid, 0);
  const { cash: cashPaid, gcash: gcashPaid } = paymentBreakdown(booking);
  const isOwnerLike = isOwnerLikeRole(appUser?.role);
  const canRemoveOrderItems = isOwnerLike;

  async function handleVoid() {
    if (!canCancel) {
      toast.error("Cancel is only allowed in the first 5 minutes. Check out instead.");
      return;
    }
    if (!window.confirm(`Cancel this booking for Room ${room.roomNumber}? This frees up the room without checking out.`)) {
      return;
    }
    setVoiding(true);
    try {
      await voidBooking(booking);
      toast.success(`Booking for Room ${room.roomNumber} cancelled.`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't cancel the booking — please try again.");
    } finally {
      setVoiding(false);
    }
  }

  async function handleRemoveItem(itemId: string, name: string) {
    setRemovingItemId(itemId);
    try {
      await removeOrderItem(booking.bookingId, itemId);
      toast.success(`Removed ${name}.`);
    } catch {
      toast.error("Couldn't remove that item — please try again.");
    } finally {
      setRemovingItemId(null);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-xl md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Room {room.roomNumber} — {booking.guestName}</DialogTitle>
            <DialogDescription>
              Checked in {booking.checkInTime.toDate().toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div
              className={
                booking.openEnded
                  ? "rounded-lg bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-600 dark:text-sky-400"
                  : isOverdue
                    ? "rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400"
                    : isRunningLow
                      ? "rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-400"
                      : "rounded-lg bg-muted px-3 py-2 text-sm font-medium"
              }
            >
              {booking.openEnded
                ? `Open time — ${formatHours(elapsed)} so far`
                : isOverdue
                  ? // Owner-only duration, same reasoning as RoomCard — a
                    // cashier just sees "Overdue," not how overdue.
                    isOwnerLike
                    ? `Overdue by ${formatHours(-remaining)}`
                    : "Overdue"
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
              <dd>{booking.openEnded ? "Open time" : `${booking.hoursBooked}h`}</dd>
              {booking.specialRequests && (
                <>
                  <dt className="text-muted-foreground">Requests</dt>
                  <dd>{booking.specialRequests}</dd>
                </>
              )}
            </dl>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Order</span>
                <Button variant="outline" size="sm" onClick={() => setOrderPickerOpen(true)}>
                  <ShoppingCartIcon className="size-3.5" />
                  Add order
                </Button>
              </div>
              {booking.items.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border p-2 text-sm">
                  {booking.items.map((line) => (
                    <div key={line.itemId} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {line.quantity}× {line.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span>₱{line.subtotal.toFixed(2)}</span>
                        {canRemoveOrderItems && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleRemoveItem(line.itemId, line.name)}
                            disabled={removingItemId === line.itemId}
                          >
                            {removingItemId === line.itemId ? (
                              <Loader2Icon className="size-3 animate-spin" />
                            ) : (
                              <XIcon className="size-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
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
                <span>Total</span>
                <span>₱{booking.totalAmount.toFixed(2)}</span>
              </div>
              {/* Cash/GCash shown as separate lines whenever both are
                  nonzero — a booking can mix methods across check-in,
                  extend, and checkout, so a single "Paid (method)" label
                  would misrepresent the true breakdown. */}
              {cashPaid > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Paid (Cash)</span>
                  <span>₱{cashPaid.toFixed(2)}</span>
                </div>
              )}
              {gcashPaid > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Paid (GCash)</span>
                  <span>₱{gcashPaid.toFixed(2)}</span>
                </div>
              )}
              {booking.gcashReference && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>GCash Ref</span>
                  <span>{booking.gcashReference}</span>
                </div>
              )}
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
              disabled={voiding || !canCancel}
              className="text-muted-foreground"
              title={
                canCancel
                  ? undefined
                  : "More than 5 minutes in the room — check out instead"
              }
            >
              {voiding && <Loader2Icon className="size-4 animate-spin" />}
              Cancel booking
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setExtendOpen(true)}
                disabled={voiding}
                title={
                  tooOverdueToExtend
                    ? "Too overdue to extend — check out and start a new 3h booking"
                    : undefined
                }
              >
                <TimerIcon className="size-4" />
                Extend stay
              </Button>
              <Button
                onClick={onRequestCheckout}
                disabled={voiding}
                title={
                  balance > 0
                    ? `Collect ₱${balance.toFixed(2)} at checkout before the room can be released`
                    : undefined
                }
              >
                Check out
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {orderPickerOpen && (
        <OrderPickerDialog
          bookingId={booking.bookingId}
          onClose={() => setOrderPickerOpen(false)}
        />
      )}

      {extendOpen && (
        <ExtendStayDialog room={room} booking={booking} onClose={() => setExtendOpen(false)} />
      )}
    </>
  );
}
