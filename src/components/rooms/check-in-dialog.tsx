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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkIn } from "@/lib/bookings";
import { updateRoomStatus } from "@/lib/rooms";
import {
  PAYMENT_METHOD_LABELS,
  ROOM_TYPE_LABELS,
  type PaymentMethod,
  type Room,
} from "@/lib/types";
import { Loader2Icon } from "lucide-react";

const DURATION_PRESETS = [2, 3, 4, 6, 8, 12, 24];

interface CheckInDialogProps {
  room: Room | null;
  cashierId: string;
  onClose: () => void;
}

export function CheckInDialog({ room, cashierId, onClose }: CheckInDialogProps) {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestCount, setGuestCount] = useState("1");
  const [hours, setHours] = useState(3);
  const [customHours, setCustomHours] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!room) return null;

  const effectiveHours = customHours ? Number(customHours) || 0 : hours;
  const total = effectiveHours * room.ratePerHour;
  const paid = Number(amountPaid) || 0;
  const change = paid > total ? paid - total : 0;

  async function handleSubmit() {
    if (!room) return;
    if (!guestName.trim()) {
      toast.error("Guest name is required.");
      return;
    }
    if (effectiveHours <= 0) {
      toast.error("Duration must be greater than zero.");
      return;
    }

    setSubmitting(true);
    try {
      await checkIn({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        guestCount: guestCount ? Number(guestCount) : undefined,
        hoursBooked: effectiveHours,
        ratePerHour: room.ratePerHour,
        paymentMethod,
        amountPaid: Math.min(paid, total),
        specialRequests: specialRequests.trim() || undefined,
        cashierId,
      });
      toast.success(`Room ${room.roomNumber} checked in.`);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Couldn't check in — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkMaintenance() {
    if (!room) return;
    setSubmitting(true);
    try {
      await updateRoomStatus(room.roomId, "maintenance");
      toast.success(`Room ${room.roomNumber} marked under maintenance.`);
      onClose();
    } catch {
      toast.error("Couldn't update the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check in — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>
            {ROOM_TYPE_LABELS[room.type]} · ₱{room.ratePerHour}/hr
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="guestName">Guest name</Label>
            <Input
              id="guestName"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guestPhone">Contact number</Label>
              <Input
                id="guestPhone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guestCount"># of guests</Label>
              <Input
                id="guestCount"
                type="number"
                min={1}
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Duration</Label>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialRequests">Special requests</Label>
            <Textarea
              id="specialRequests"
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium">
            <span>Total due</span>
            <span>₱{total.toFixed(2)}</span>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkMaintenance}
            disabled={submitting}
            className="text-muted-foreground"
          >
            Report issue / mark maintenance
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Check in
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
