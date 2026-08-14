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
import type { Booking, Room } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { Loader2Icon } from "lucide-react";

const DURATION_PRESETS = [1, 2, 3, 6, 12, 24];

interface ExtendStayDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
}

export function ExtendStayDialog({ room, booking, onClose }: ExtendStayDialogProps) {
  const now = useNowTick(1000);
  const [hours, setHours] = useState(1);
  const [customHours, setCustomHours] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
  const effectiveHours = customHours ? Number(customHours) || 0 : hours;
  const additionalCost = effectiveHours * room.ratePerHour;
  const paid = Number(amountPaid) || 0;
  const change = paid > additionalCost ? paid - additionalCost : 0;

  async function handleSubmit() {
    if (effectiveHours <= 0) {
      toast.error("Additional hours must be greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      await extendStay(booking, room, effectiveHours, Math.min(paid, additionalCost));
      toast.success(`Room ${room.roomNumber} extended by ${effectiveHours}h.`);
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
            <Label>Additional hours</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((h) => (
                <Button
                  key={h}
                  type="button"
                  size="sm"
                  variant={!customHours && hours === h ? "default" : "outline"}
                  onClick={() => {
                    setHours(h);
                    setCustomHours("");
                  }}
                  disabled={submitting}
                >
                  {h}h
                </Button>
              ))}
              <Input
                placeholder="Custom"
                type="number"
                min={0}
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                disabled={submitting}
                className="w-20"
              />
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
