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
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
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

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
        style.card
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-heading text-lg font-semibold">{room.roomNumber}</span>
        <span className={cn("size-2.5 rounded-full", style.dot)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {ROOM_TYPE_LABELS[room.type]} · {style.label}
      </div>

      {booking && (
        <div className="mt-1 flex flex-col gap-1 border-t pt-2 text-xs">
          <div className="flex items-center gap-1 truncate font-medium">
            <UserIcon className="size-3 shrink-0" />
            <span className="truncate">{booking.guestName}</span>
          </div>
          <div
            className={cn(
              "font-medium",
              isOverdue
                ? "text-rose-600 dark:text-rose-400"
                : isRunningLow
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
            )}
          >
            {isOverdue ? "Overdue" : `${formatHours(remaining!)} left`}
          </div>
        </div>
      )}
    </button>
  );
}
