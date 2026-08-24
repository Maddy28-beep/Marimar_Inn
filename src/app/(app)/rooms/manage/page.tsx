"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import {
  subscribeToRooms,
  deleteRoom,
  seedInitialRooms,
  subscribeToRatePackages,
  deleteRatePackage,
  seedDefaultRatePackages,
} from "@/lib/rooms";
import { ROOM_TYPE_LABELS, type RatePackage, type Room } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RoomFormDialog } from "@/components/rooms/room-form-dialog";
import { RatePackageFormDialog } from "@/components/rooms/rate-package-form-dialog";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

type DialogState = "create" | { room: Room } | null;
type RateDialogState = "create" | { pkg: RatePackage } | null;

function RatePackagesSection() {
  const [packages, setPackages] = useState<RatePackage[] | null>(null);
  const [dialog, setDialog] = useState<RateDialogState>(null);
  const [seeding, setSeeding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => subscribeToRatePackages(setPackages), []);

  async function handleSeed() {
    setSeeding(true);
    try {
      await seedDefaultRatePackages();
      toast.success("Seeded default rate packages.");
    } catch {
      toast.error("Couldn't seed rate packages — please try again.");
    } finally {
      setSeeding(false);
    }
  }

  async function handleDelete(pkg: RatePackage) {
    if (!window.confirm(`Delete the ${pkg.hours}h / ₱${pkg.price} package?`)) return;
    setDeletingId(pkg.packageId);
    try {
      await deleteRatePackage(pkg.packageId);
      toast.success("Rate package deleted.");
    } catch {
      toast.error("Couldn't delete the rate package — please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">Rate packages</h2>
          <p className="text-sm text-muted-foreground">
            These are the packages cashiers pick from at check-in.
          </p>
        </div>
        <div className="flex gap-2">
          {packages?.length === 0 && (
            <Button variant="outline" onClick={handleSeed} disabled={seeding}>
              {seeding && <Loader2Icon className="size-4 animate-spin" />}
              Seed default rates
            </Button>
          )}
          <Button onClick={() => setDialog("create")}>
            <PlusIcon className="size-4" />
            Add rate
          </Button>
        </div>
      </div>

      <div className="rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Hours</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {packages?.map((pkg) => (
                <tr key={pkg.packageId} className="border-t">
                  <td className="px-4 py-2 font-medium">{pkg.hours}h</td>
                  <td className="px-4 py-2">₱{pkg.price.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ pkg })}>
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(pkg)}
                        disabled={deletingId === pkg.packageId}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {packages?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    No rate packages yet — seed the defaults or add your own.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialog && (
        <RatePackageFormDialog
          key={dialog === "create" ? "create" : dialog.pkg.packageId}
          mode={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

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
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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

      <RatePackagesSection />
    </div>
  );
}

export default function ManageRoomsPage() {
  return (
    <ProtectedRoute allowedRoles={["owner", "admin", "superadmin", "supervisor"]}>
      <ManageRoomsContent />
    </ProtectedRoute>
  );
}
