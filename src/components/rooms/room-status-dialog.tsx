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
import { updateRoomStatus } from "@/lib/rooms";
import { ROOM_TYPE_LABELS, type Room } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

interface RoomStatusDialogProps {
  room: Room;
  onClose: () => void;
}

export function RoomStatusDialog({ room, onClose }: RoomStatusDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  async function markAvailable() {
    setSubmitting(true);
    try {
      await updateRoomStatus(room.roomId, "available");
      toast.success(`Room ${room.roomNumber} is now available.`);
      onClose();
    } catch {
      toast.error("Couldn't update the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Room {room.roomNumber}</DialogTitle>
          <DialogDescription>
            {ROOM_TYPE_LABELS[room.type]} ·{" "}
            {room.status === "cleaning" ? "Being cleaned" : "Under maintenance"}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {room.status === "cleaning"
            ? "Mark this room available once housekeeping has finished."
            : "Clear this room's maintenance flag once the issue is resolved."}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button onClick={markAvailable} disabled={submitting}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Mark available
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
