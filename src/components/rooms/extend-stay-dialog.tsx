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
import { extendStay, hoursElapsed } from "@/lib/bookings";
import { ROOM_RATE_PACKAGES, type Booking, type Room } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { Loader2Icon } from "lucide-react";

interface ExtendStayDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
}

export function ExtendStayDialog({ room, booking, onClose }: ExtendStayDialogProps) {
  const now = useNowTick(1000);
  const [packageIndex, setPackageIndex] = useState(0);
  const [amountPaid, setAmountPaid] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  const selectedPackage = ROOM_RATE_PACKAGES[packageIndex];
  const additionalCost = selectedPackage.price;
  const paid = Number(amountPaid) || 0;
  const change = paid > additionalCost ? paid - additionalCost : 0;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await extendStay(booking, selectedPackage.hours, selectedPackage.price, Math.min(paid, additionalCost));
      toast.success(`Room ${room.roomNumber} extended by ${selectedPackage.hours}h.`);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Couldn't extend the stay — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Extend stay — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>
            {booking.guestName} ·{" "}
            {remaining > 0 ? `${remaining.toFixed(1)}h remaining` : "Overdue"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Additional package</Label>
            <div className="flex flex-wrap gap-1.5">
              {ROOM_RATE_PACKAGES.map((pkg, index) => (
                <Button
                  key={pkg.hours}
                  type="button"
                  size="sm"
                  variant={packageIndex === index ? "default" : "outline"}
                  onClick={() => setPackageIndex(index)}
                  disabled={submitting}
                >
                  {pkg.hours}h · ₱{pkg.price}
                </Button>
              ))}
            </div>
          </div>

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

          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
            <span>Additional cost</span>
            <span>₱{additionalCost.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Extend stay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
