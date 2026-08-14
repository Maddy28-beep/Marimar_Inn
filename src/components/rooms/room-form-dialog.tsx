"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createRoom, updateRoom, type NewRoomInput } from "@/lib/rooms";
import { ROOM_TYPE_LABELS, type Room, type RoomType } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

interface RoomFormDialogProps {
  mode: "create" | { room: Room };
  onClose: () => void;
}

export function RoomFormDialog({ mode, onClose }: RoomFormDialogProps) {
  const editingRoom = mode === "create" ? null : mode.room;
  const [roomNumber, setRoomNumber] = useState(editingRoom?.roomNumber ?? "");
  const [floor, setFloor] = useState(String(editingRoom?.floor ?? 1));
  const [type, setType] = useState<RoomType>(editingRoom?.type ?? "standard");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!roomNumber.trim()) {
      toast.error("Room number is required.");
      return;
    }
    const input: NewRoomInput = {
      roomNumber: roomNumber.trim(),
      floor: Number(floor) || 1,
      type,
    };

    setSubmitting(true);
    try {
      if (editingRoom) {
        await updateRoom(editingRoom.roomId, input);
        toast.success(`Room ${input.roomNumber} updated.`);
      } else {
        await createRoom(input);
        toast.success(`Room ${input.roomNumber} added.`);
      }
      onClose();
    } catch {
      toast.error("Couldn't save the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingRoom ? "Edit room" : "Add room"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="roomNumber">Room number</Label>
              <Input
                id="roomNumber"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="floor">Floor</Label>
              <Input
                id="floor"
                type="number"
                min={1}
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Room type</Label>
            <Select value={type} onValueChange={(v) => setType(v as RoomType)} disabled={submitting}>
              <SelectTrigger className="w-full">
                <SelectValue>{ROOM_TYPE_LABELS[type]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROOM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
