"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { ROOM_TYPE_LABELS, type Booking, type Room, type RoomStatus } from "@/lib/types";
import { hoursElapsed } from "@/lib/bookings";
import { formatHours } from "@/lib/time";
import { useAuth } from "@/context/auth-context";
import { isOwnerLikeRole } from "@/lib/roles";
import { UserIcon } from "lucide-react";

const CARD_SHELL =
  "relative flex h-36 w-full flex-col gap-1 overflow-hidden rounded-2xl border p-3 pl-3.5 text-left shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1.5";

const STATUS_STYLES: Record<RoomStatus, { label: string; card: string; dot: string; pill: string }> = {
  available: {
    label: "Available",
    card: "border-emerald-500/30 bg-emerald-500/10 before:bg-emerald-500",
    dot: "bg-emerald-500",
    pill: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
  },
  occupied: {
    label: "Occupied",
    card: "border-rose-500/30 bg-rose-500/10 before:bg-rose-500",
    dot: "bg-rose-500",
    pill: "bg-rose-600/15 text-rose-800 dark:text-rose-300",
  },
  cleaning: {
    label: "Cleaning",
    card: "border-amber-500/30 bg-amber-500/10 before:bg-amber-500",
    dot: "bg-amber-500",
    pill: "bg-amber-600/15 text-amber-800 dark:text-amber-300",
  },
  maintenance: {
    label: "Maintenance",
    card: "border-muted-foreground/25 bg-muted before:bg-muted-foreground/70",
    dot: "bg-muted-foreground",
    pill: "bg-muted-foreground/15 text-muted-foreground",
  },
};

interface RoomCardProps {
  room: Room;
  booking?: Booking;
  now: Date;
  onSelect: (room: Room) => void;
}

export const RoomCard = memo(function RoomCard({ room, booking, now, onSelect }: RoomCardProps) {
  const { appUser } = useAuth();
  const isOwnerLike = isOwnerLikeRole(appUser?.role);
  const style = STATUS_STYLES[room.status];
  // Rooms and bookings are two independent Firestore listeners — a void
  // approval (or checkout) updates both docs in one transaction, but the
  // two listeners can still deliver their snapshots a beat apart. Trusting
  // `booking` alone here means that momentary lag shows a guest/countdown
  // on a room the system already knows is free. room.status is the
  // authoritative signal for what this card should show.
  const showBooking = Boolean(booking) && room.status === "occupied";
  const elapsed = showBooking ? hoursElapsed(booking!.checkInTime, now) : 0;
  const remaining = showBooking && !booking!.openEnded ? booking!.hoursBooked - elapsed : null;
  // 15 minutes left is its own, more urgent tier than the general "running
  // low" 30-minute one — "running low" now only covers 15–30 minutes so the
  // two don't overlap.
  const isCritical = remaining !== null && remaining <= 0.25 && remaining > 0;
  const isRunningLow = remaining !== null && remaining <= 0.5 && remaining > 0.25;
  const isOverdue = remaining !== null && remaining <= 0;
  const balance = showBooking ? Math.max(booking!.totalAmount - booking!.amountPaid, 0) : 0;
  const usedFrac =
    showBooking && !booking!.openEnded && booking!.hoursBooked > 0
      ? Math.min(1, Math.max(0, elapsed / booking!.hoursBooked))
      : 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(room)}
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
      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-xl leading-none font-semibold tracking-tight">
          {room.roomNumber}
        </span>
        <span
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full",
            isCritical || isOverdue ? "bg-red-700 ring-2 ring-red-700/30 dark:bg-red-500" : style.dot
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

      {showBooking ? (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1 truncate text-sm font-medium">
            <UserIcon className="size-3.5 shrink-0" />
            <span className="truncate">{booking!.guestName}</span>
          </div>
          <div
            className={cn(
              "text-xl leading-tight font-bold",
              booking!.openEnded
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
            {booking!.openEnded
              ? `Open · ${formatHours(elapsed)}`
              : isOverdue
                ? // Owner sees the exact overdue duration right on the card;
                  // cashiers only see "Overdue" (no number) so they can't game
                  // how late they report a checkout — the Owner can still spot
                  // the real duration here or in Reports > Overdue.
                  isOwnerLike
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

      {showBooking && !booking!.openEnded && (
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
});
