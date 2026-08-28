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
import { Textarea } from "@/components/ui/textarea";
import { createOrderItemVoidRequest } from "@/lib/void-requests";
import { useAuth } from "@/context/auth-context";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import type { Booking, OrderItem, Room } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

const REASON_MAX_LENGTH = 300;

interface OrderItemVoidRequestDialogProps {
  room: Room;
  booking: Booking;
  item: OrderItem;
  onClose: () => void;
}

export function OrderItemVoidRequestDialog({ room, booking, item, onClose }: OrderItemVoidRequestDialogProps) {
  const { appUser } = useAuth();
  const [reason, setReason] = useState("");
  const { submitting, guard } = useSubmitGuard();

  async function handleSubmit() {
    const trimmed = reason.trim();
    if (!trimmed || !appUser) return;
    await guard(async () => {
      try {
        await createOrderItemVoidRequest({
          booking,
          item,
          reason: trimmed,
          requestedBy: appUser.uid,
          requestedByName: appUser.displayName ?? appUser.email ?? "Cashier",
          requestedByRole: appUser.role,
        });
        toast.success("Request sent — waiting on Owner approval.");
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't send the request — please try again."
        );
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request void — {item.name}</DialogTitle>
          <DialogDescription>
            Room {room.roomNumber} · {item.quantity}× {item.name} (₱{item.subtotal.toFixed(2)}) was
            already paid for, so removing it needs Owner approval. Explain why it needs to be removed.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX_LENGTH))}
          placeholder="e.g. Added the wrong item by mistake, guest never received it."
          rows={4}
          autoFocus
        />
        <p className="text-right text-xs text-muted-foreground">
          {reason.length}/{REASON_MAX_LENGTH}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !reason.trim()}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
