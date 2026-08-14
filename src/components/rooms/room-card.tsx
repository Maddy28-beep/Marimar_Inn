"use client";

import { cn } from "@/lib/utils";
import { ROOM_TYPE_LABELS, type Booking, type Room, type RoomStatus } from "@/lib/types";
import { hoursElapsed } from "@/lib/bookings";
import { UserIcon } from "lucide-react";

const STATUS_STYLES: Record<RoomStatus, { label: string; card: string; dot: string }> = {
  available: {
    label: "Available",
    card: "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15",
    dot: "bg-emerald-500",
  },
  occupied: {
    label: "Occupied",
    card: "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/15",
    dot: "bg-rose-500",
  },
  cleaning: {
    label: "Cleaning",
    card: "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15",
    dot: "bg-amber-500",
  },
  maintenance: {
    label: "Maintenance",
    card: "border-muted-foreground/30 bg-muted hover:bg-muted/80",
    dot: "bg-muted-foreground",
  },
};

function formatHours(hours: number): string {
  const sign = hours < 0 ? "-" : "";
  // Round to whole minutes first, then split — rounding h and m separately
  // can independently round m up to 60 (e.g. 2.999h -> "2h 60m").
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${sign}${h}h ${m}m`;
}

interface RoomCardProps {
  room: Room;
  booking?: Booking;
  now: Date;
  onClick: () => void;
}

export function RoomCard({ room, booking, now, onClick }: RoomCardProps) {
  const style = STATUS_STYLES[room.status];
  const remaining = booking
    ? booking.hoursBooked - hoursElapsed(booking.checkInTime, now)
    : null;
  const isRunningLow = remaining !== null && remaining <= 0.5 && remaining > 0;
  const isOverdue = remaining !== null && remaining <= 0;
  const balance = booking ? Math.max(booking.totalAmount - booking.amountPaid, 0) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Fixed height so occupied cards (guest + countdown + balance) match empty ones.
        "flex h-36 w-full flex-col gap-0.5 overflow-hidden rounded-xl border p-2.5 text-left transition-colors",
        style.card
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-xl leading-none font-semibold">{room.roomNumber}</span>
        <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", style.dot)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {ROOM_TYPE_LABELS[room.type]} · {style.label}
      </div>

      {booking && (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1 truncate text-sm font-medium">
            <UserIcon className="size-3.5 shrink-0" />
            <span className="truncate">{booking.guestName}</span>
          </div>
          <div
            className={cn(
              "text-xl leading-tight font-bold",
              isOverdue
                ? "text-rose-600 dark:text-rose-400"
                : isRunningLow
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground"
            )}
          >
            {isOverdue ? "Overdue" : `${formatHours(remaining!)} left`}
          </div>
          {balance > 0 && (
            <div className="mt-auto w-fit rounded-md bg-amber-500/25 px-2 py-1 text-sm font-bold text-amber-800 dark:text-amber-300">
              ₱{balance.toFixed(2)} due
            </div>
          )}
        </div>
      )}
    </button>
  );
}
