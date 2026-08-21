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

const CARD_SHELL =
  "relative flex h-36 w-full flex-col gap-1 overflow-hidden rounded-2xl border p-3 pl-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md before:absolute before:inset-y-0 before:left-0 before:w-1.5";

const STATUS_STYLES: Record<
  RoomStatus,
  { label: string; card: string; dot: string; pill: string; icon: LucideIcon; iconTint: string }
> = {
  available: {
    label: "Available",
    card: "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/16 before:bg-emerald-500",
    dot: "bg-emerald-500",
    pill: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
    icon: BedDoubleIcon,
    iconTint: "text-emerald-600/70 dark:text-emerald-400/60",
  },
  occupied: {
    label: "Occupied",
    card: "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/16 before:bg-rose-500",
    dot: "bg-rose-500",
    pill: "bg-rose-600/15 text-rose-800 dark:text-rose-300",
    icon: DoorClosedIcon,
    iconTint: "text-rose-600/70 dark:text-rose-400/60",
  },
  cleaning: {
    label: "Cleaning",
    card: "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/16 before:bg-amber-500",
    dot: "bg-amber-500",
    pill: "bg-amber-600/15 text-amber-800 dark:text-amber-300",
    icon: SparklesIcon,
    iconTint: "text-amber-600/70 dark:text-amber-400/60",
  },
  maintenance: {
    label: "Maintenance",
    card: "border-muted-foreground/25 bg-muted hover:bg-muted/80 before:bg-muted-foreground/70",
    dot: "bg-muted-foreground",
    pill: "bg-muted-foreground/15 text-muted-foreground",
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
  // 15 minutes left is its own, more urgent tier than the general "running
  // low" 30-minute one — "running low" now only covers 15–30 minutes so the
  // two don't overlap.
  const isCritical = remaining !== null && remaining <= 0.25 && remaining > 0;
  const isRunningLow = remaining !== null && remaining <= 0.5 && remaining > 0.25;
  const isOverdue = remaining !== null && remaining <= 0;
  const balance = booking ? Math.max(booking.totalAmount - booking.amountPaid, 0) : 0;
  const usedFrac =
    booking && !booking.openEnded && booking.hoursBooked > 0
      ? Math.min(1, Math.max(0, elapsed / booking.hoursBooked))
      : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CARD_SHELL,
        // 15 minutes left or overdue gets a dark-red card, not just the
        // usual light "occupied" rose — a glance at the grid should make
        // these rooms impossible to miss.
        isCritical || isOverdue
          ? "border-red-700/60 bg-red-700/20 hover:bg-red-700/25 before:bg-red-700 dark:border-red-600/70 dark:bg-red-600/25 dark:hover:bg-red-600/30 dark:before:bg-red-500"
          : style.card
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
        <span className="font-heading text-xl leading-none font-semibold tracking-tight">
          {room.roomNumber}
        </span>
        <span
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full",
            isCritical || isOverdue ? "bg-red-700 ring-2 ring-red-700/30 animate-pulse dark:bg-red-500" : style.dot
          )}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
            isCritical || isOverdue
              ? "bg-red-700/20 text-red-800 dark:text-red-300"
              : style.pill
          )}
        >
          {style.label}
        </span>
        <span className="truncate text-xs text-muted-foreground">{ROOM_TYPE_LABELS[room.type]}</span>
      </div>

      {booking ? (
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
                  ? "text-red-700 dark:text-red-400"
                  : isCritical
                    ? "text-red-700 dark:text-red-400"
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
            <div className="mt-auto w-fit rounded-md bg-amber-500/25 px-2 py-0.5 text-sm font-bold text-amber-800 dark:text-amber-300">
              ₱{balance.toFixed(2)} due
            </div>
          )}
        </div>
      ) : room.status === "available" ? (
        <div className="mt-auto text-sm font-medium text-emerald-800 dark:text-emerald-300">Tap to check in</div>
      ) : room.status === "cleaning" ? (
        <div className="mt-auto text-sm font-medium text-amber-800 dark:text-amber-300">Tap when ready</div>
      ) : (
        <div className="mt-auto text-sm font-medium text-muted-foreground">Tap to update</div>
      )}

      {booking && !booking.openEnded && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/5 dark:bg-white/10">
          <div
            className={cn(
              "h-full",
              isOverdue || isCritical ? "bg-red-700" : isRunningLow ? "bg-amber-500" : "bg-rose-400"
            )}
            style={{ width: `${Math.round(usedFrac * 100)}%` }}
          />
        </div>
      )}
    </button>
  );
}
