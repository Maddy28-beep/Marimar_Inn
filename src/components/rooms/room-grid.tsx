"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { subscribeToRooms } from "@/lib/rooms";
import { subscribeToActiveBookings, hoursElapsed, EXTEND_OVERDUE_CUTOFF_HOURS, EXTEND_OVERDUE_CUTOFF_MINUTES } from "@/lib/bookings";
import { formatHours } from "@/lib/time";
import type { Booking, Room, RoomStatus, RoomType } from "@/lib/types";
import { ROOM_TYPE_LABELS } from "@/lib/types";
import { useNowTick } from "@/hooks/use-now-tick";
import { RoomCard } from "@/components/rooms/room-card";
import { CheckInDialog } from "@/components/rooms/check-in-dialog";
import { RoomDetailDialog } from "@/components/rooms/room-detail-dialog";
import { CheckoutDialog } from "@/components/rooms/checkout-dialog";
import { RoomStatusDialog } from "@/components/rooms/room-status-dialog";
import { StoreCard } from "@/components/store/store-card";
import { WalkInSaleDialog } from "@/components/store/walk-in-sale-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangleIcon, SearchIcon } from "lucide-react";

type StatusFilter = "all" | RoomStatus;
type TypeFilter = "all" | RoomType;

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All statuses",
  available: "Available",
  occupied: "Occupied",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
};
type DialogState =
  | { kind: "check-in"; room: Room }
  // "detail" intentionally holds no booking snapshot — it's looked up live
  // from bookingsByRoom on every render so adding/removing order items while
  // the dialog is open reflects immediately instead of a frozen click-time copy.
  | { kind: "detail"; room: Room }
  | { kind: "checkout"; room: Room; booking: Booking }
  | { kind: "status"; room: Room }
  | { kind: "store" }
  | null;

export function RoomGrid() {
  const { appUser } = useAuth();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [bookingsByRoom, setBookingsByRoom] = useState<Map<string, Booking>>(new Map());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dialog, setDialog] = useState<DialogState>(null);
  const now = useNowTick(30_000);

  useEffect(() => {
    const unsubscribe = subscribeToRooms(setRooms);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToActiveBookings(setBookingsByRoom);
    return unsubscribe;
  }, []);

  // Owner-facing oversight: cashiers sometimes let a guest stay past their
  // booked time (or extend informally) without logging it in the system, so
  // a room card alone is easy to miss. This surfaces every currently
  // overdue room in one place, worst-first, so the Owner can call the
  // cashier or check CCTV instead of relying on staff to flag it themselves.
  // A short grace period keeps this from firing the instant time is up —
  // the guest may just be packing up.
  const overdueRooms = useMemo(() => {
    if (!rooms) return [];
    const list: { room: Room; booking: Booking; overdueBy: number }[] = [];
    for (const room of rooms) {
      const booking = bookingsByRoom.get(room.roomId);
      if (!booking || booking.openEnded) continue;
      const remaining = booking.hoursBooked - hoursElapsed(booking.checkInTime, now);
      if (remaining <= -EXTEND_OVERDUE_CUTOFF_HOURS) {
        list.push({ room, booking, overdueBy: -remaining });
      }
    }
    list.sort((a, b) => b.overdueBy - a.overdueBy);
    return list;
  }, [rooms, bookingsByRoom, now]);

  const filteredRooms = useMemo(() => {
    if (!rooms) return [];
    return rooms.filter((room) => {
      if (statusFilter !== "all" && room.status !== statusFilter) return false;
      if (typeFilter !== "all" && room.type !== typeFilter) return false;
      if (search && !room.roomNumber.includes(search.trim())) return false;
      return true;
    });
  }, [rooms, statusFilter, typeFilter, search]);

  function handleRoomClick(room: Room) {
    if (room.status === "available") {
      setDialog({ kind: "check-in", room });
      return;
    }
    if (room.status === "occupied") {
      if (!bookingsByRoom.get(room.roomId)) return;
      setDialog({ kind: "detail", room });
      return;
    }
    setDialog({ kind: "status", room });
  }

  if (rooms === null) {
    return (
      <div className="grid auto-rows-[9rem] grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {appUser?.role === "owner"
          ? "No rooms yet — head to Manage Rooms to seed the initial 17 rooms."
          : "No rooms have been set up yet. Ask the Owner to seed the room list."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {appUser?.role === "owner" && overdueRooms.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-400">
            <AlertTriangleIcon className="size-4" />
            {overdueRooms.length} room{overdueRooms.length > 1 ? "s" : ""} overdue more than{" "}
            {EXTEND_OVERDUE_CUTOFF_MINUTES} minutes — cannot extend, start a new booking
          </div>
          <div className="flex flex-col gap-1">
            {overdueRooms.map(({ room, booking, overdueBy }) => (
              <button
                key={room.roomId}
                type="button"
                onClick={() => handleRoomClick(room)}
                className="flex items-center justify-between rounded-lg bg-background/70 px-3 py-2 text-left text-sm hover:bg-background"
              >
                <span>
                  <span className="font-medium">Room {room.roomNumber}</span>
                  <span className="text-muted-foreground"> — {booking.guestName}</span>
                </span>
                <span className="font-semibold text-rose-700 dark:text-rose-400">
                  Overdue {formatHours(overdueBy)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-40">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Room #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue>{STATUS_FILTER_LABELS[statusFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="occupied">Occupied</SelectItem>
            <SelectItem value="cleaning">Cleaning</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue>
              {typeFilter === "all" ? "All types" : ROOM_TYPE_LABELS[typeFilter]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(ROOM_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid auto-rows-[9rem] grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {(!search.trim() || "store".includes(search.trim().toLowerCase())) &&
          statusFilter === "all" &&
          typeFilter === "all" && <StoreCard onClick={() => setDialog({ kind: "store" })} />}
        {filteredRooms.map((room) => (
          <RoomCard
            key={room.roomId}
            room={room}
            booking={bookingsByRoom.get(room.roomId)}
            now={now}
            onClick={() => handleRoomClick(room)}
          />
        ))}
      </div>

      {dialog?.kind === "check-in" && appUser && (
        <CheckInDialog
          key={dialog.room.roomId}
          room={dialog.room}
          cashierId={appUser.uid}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "detail" &&
        (() => {
          const liveBooking = bookingsByRoom.get(dialog.room.roomId);
          if (!liveBooking) return null;
          return (
            <RoomDetailDialog
              room={dialog.room}
              booking={liveBooking}
              onClose={() => setDialog(null)}
              onRequestCheckout={() =>
                setDialog({ kind: "checkout", room: dialog.room, booking: liveBooking })
              }
            />
          );
        })()}

      {dialog?.kind === "checkout" && appUser && (
        <CheckoutDialog
          room={dialog.room}
          booking={dialog.booking}
          staffName={appUser.displayName ?? appUser.email ?? "Staff"}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "store" && appUser && (
        <WalkInSaleDialog onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === "status" && (
        <RoomStatusDialog room={dialog.room} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
