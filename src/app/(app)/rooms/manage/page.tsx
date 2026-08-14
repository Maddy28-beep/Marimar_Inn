"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { subscribeToRooms, deleteRoom, seedInitialRooms } from "@/lib/rooms";
import { ROOM_TYPE_LABELS, type Room } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RoomFormDialog } from "@/components/rooms/room-form-dialog";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

type DialogState = "create" | { room: Room } | null;

function ManageRoomsContent() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [seeding, setSeeding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToRooms(setRooms);
  }, []);

  async function handleSeed() {
    setSeeding(true);
    try {
      await seedInitialRooms();
      toast.success("Seeded 17 rooms.");
    } catch {
      toast.error("Couldn't seed rooms — please try again.");
    } finally {
      setSeeding(false);
    }
  }

  async function handleDelete(room: Room) {
    if (!window.confirm(`Delete Room ${room.roomNumber}? This can't be undone.`)) return;
    setDeletingId(room.roomId);
    try {
      await deleteRoom(room.roomId);
      toast.success(`Room ${room.roomNumber} deleted.`);
    } catch {
      toast.error("Couldn't delete the room — please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Manage Rooms</h1>
          <p className="text-sm text-muted-foreground">
            Add, edit, or remove rooms and set hourly rates.
          </p>
        </div>
        <div className="flex gap-2">
          {rooms?.length === 0 && (
            <Button variant="outline" onClick={handleSeed} disabled={seeding}>
              {seeding && <Loader2Icon className="size-4 animate-spin" />}
              Seed 17 rooms
            </Button>
          )}
          <Button onClick={() => setDialog("create")}>
            <PlusIcon className="size-4" />
            Add room
          </Button>
        </div>
      </div>

      <div className="rounded-xl border">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Room</th>
              <th className="px-4 py-2 font-medium">Floor</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Rate/hr</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rooms?.map((room) => (
              <tr key={room.roomId} className="border-t">
                <td className="px-4 py-2 font-medium">{room.roomNumber}</td>
                <td className="px-4 py-2">{room.floor}</td>
                <td className="px-4 py-2">{ROOM_TYPE_LABELS[room.type]}</td>
                <td className="px-4 py-2">₱{room.ratePerHour.toFixed(2)}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary" className="capitalize">
                    {room.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDialog({ room })}
                    >
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(room)}
                      disabled={deletingId === room.roomId}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rooms?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No rooms yet — seed the initial 17 rooms to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {dialog && (
        <RoomFormDialog
          key={dialog === "create" ? "create" : dialog.room.roomId}
          mode={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export default function ManageRoomsPage() {
  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <ManageRoomsContent />
    </ProtectedRoute>
  );
}
