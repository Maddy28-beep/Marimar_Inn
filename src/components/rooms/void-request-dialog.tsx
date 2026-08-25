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
import { createVoidRequest } from "@/lib/void-requests";
import { useAuth } from "@/context/auth-context";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import type { Booking, Room } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

const REASON_MAX_LENGTH = 300;

interface VoidRequestDialogProps {
  room: Room;
  booking: Booking;
  onClose: () => void;
}

export function VoidRequestDialog({ room, booking, onClose }: VoidRequestDialogProps) {
  const { appUser } = useAuth();
  const [reason, setReason] = useState("");
  const { submitting, guard } = useSubmitGuard();

  async function handleSubmit() {
    const trimmed = reason.trim();
    if (!trimmed || !appUser) return;
    await guard(async () => {
      try {
        await createVoidRequest({
          booking,
          reason: trimmed,
          requestedBy: appUser.uid,
          requestedByName: appUser.displayName ?? appUser.email ?? "Cashier",
        });
        toast.success("Void request sent — waiting on Owner approval.");
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't send the void request — please try again."
        );
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request void — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>
            This booking is past the 7-minute self-serve window. Explain why it needs to be
            cancelled — the Owner will review and approve or deny.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX_LENGTH))}
          placeholder="e.g. Guest changed their mind right after paying, hasn't used the room."
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
