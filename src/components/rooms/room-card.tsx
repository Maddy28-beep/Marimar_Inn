"use client";

import { cn } from "@/lib/utils";
import { ROOM_TYPE_LABELS, type Booking, type Room, type RoomStatus } from "@/lib/types";
import { hoursElapsed } from "@/lib/bookings";
import { formatHours } from "@/lib/time";
import { useAuth } from "@/context/auth-context";
import {
  BedDoubleIcon,
  DoorClosedIcon,
  SparklesIcon,
  UserIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

const STATUS_STYLES: Record<
  RoomStatus,
  { label: string; card: string; dot: string; icon: LucideIcon; iconTint: string }
> = {
  available: {
    label: "Available",
    card: "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15",
    dot: "bg-emerald-500",
    icon: BedDoubleIcon,
    iconTint: "text-emerald-600/70 dark:text-emerald-400/60",
  },
  occupied: {
    label: "Occupied",
    card: "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/15",
    dot: "bg-rose-500",
    icon: DoorClosedIcon,
    iconTint: "text-rose-600/70 dark:text-rose-400/60",
  },
  cleaning: {
    label: "Cleaning",
    card: "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15",
    dot: "bg-amber-500",
    icon: SparklesIcon,
    iconTint: "text-amber-600/70 dark:text-amber-400/60",
  },
  maintenance: {
    label: "Maintenance",
    card: "border-muted-foreground/30 bg-muted hover:bg-muted/80",
    dot: "bg-muted-foreground",
    icon: WrenchIcon,
    iconTint: "text-muted-foreground/70",
  },
};


interface RoomCardProps {
  room: Room;
  booking?: Booking;
  now: Date;
  onClick: () => void;
}

export function RoomCard({ room, booking, now, onClick }: RoomCardProps) {
  const { appUser } = useAuth();
  const isOwner = appUser?.role === "owner";
  const style = STATUS_STYLES[room.status];
  const elapsed = booking ? hoursElapsed(booking.checkInTime, now) : 0;
  const remaining = booking && !booking.openEnded ? booking.hoursBooked - elapsed : null;
  const isRunningLow = remaining !== null && remaining <= 0.5 && remaining > 0;
  const isOverdue = remaining !== null && remaining <= 0;
  const balance = booking ? Math.max(booking.totalAmount - booking.amountPaid, 0) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Fixed height so occupied cards (guest + countdown + balance) match empty ones.
        "relative flex h-36 w-full flex-col gap-0.5 overflow-hidden rounded-xl border p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        style.card
      )}
    >
      {!booking && (
        <style.icon
          className={cn(
            "pointer-events-none absolute -right-3 -bottom-3 size-20 rotate-[-8deg] opacity-[0.12]",
            style.iconTint
          )}
          strokeWidth={1.5}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-xl leading-none font-semibold">{room.roomNumber}</span>
        <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", style.dot)} />
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <style.icon className={cn("size-3 shrink-0", style.iconTint)} strokeWidth={2} />
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
              booking.openEnded
                ? "text-sky-600 dark:text-sky-400"
                : isOverdue
                  ? "text-rose-600 dark:text-rose-400"
                  : isRunningLow
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground"
            )}
          >
            {booking.openEnded
              ? `Open · ${formatHours(elapsed)}`
              : isOverdue
                ? // Owner sees the exact overdue duration right on the card;
                  // cashiers only see "Overdue" (no number) so they can't game
                  // how late they report a checkout — the Owner can still spot
                  // the real duration here or in Reports > Overdue.
                  isOwner
                  ? `Overdue ${formatHours(-remaining!)}`
                  : "Overdue"
                : `${formatHours(remaining!)} left`}
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
