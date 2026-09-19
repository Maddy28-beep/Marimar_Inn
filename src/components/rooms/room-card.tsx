"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { ROOM_TYPE_LABELS, type Booking, type Room, type RoomStatus } from "@/lib/types";
import { hoursElapsed } from "@/lib/bookings";
import { formatHours } from "@/lib/time";
import { useAuth } from "@/context/auth-context";
import { isOwnerLikeRole } from "@/lib/roles";
import { BedDoubleIcon, BroomIcon, UserIcon, WrenchIcon } from "lucide-react";

// The card is a bed seen from above, at the same fixed size as before
// (h-36 — the front desk needs every room on one screen, so the bed shape
// has to be built out of the space the content already used, never added
// on top of it):
//   - headboard: the darker top band, holding two pillows side by side —
//     the room number on one, the status icon + dot on the other
//   - folded-down sheet: the lighter band under it, holding the status
//     pill and room type
//   - blanket: everything below, tinted with the status color, holding the
//     guest / countdown / balance / tap hint
//   - footboard: the progress bar along the very bottom edge
//
// Glassmorphism shell kept from before (backdrop-blur + soft inset ring +
// hover lift) so the bed still reads as one translucent object.
//
// The <button> is display:block and CARD_INNER does the flex-col: WebKit
// (iPhone) doesn't lay out a flex <button>'s children like Blink does — it
// shrink-wraps them instead of stretching, which broke row widths on a real
// iPhone. An explicit w-full on a real <div> child sidesteps that.
const CARD_INNER = "flex h-full w-full flex-col";
const CARD_SHELL =
  "relative block h-36 w-full overflow-hidden rounded-2xl border text-left shadow-lg shadow-black/5 backdrop-blur-md backdrop-saturate-150 ring-1 ring-inset ring-white/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:shadow-black/20 dark:ring-white/10";

const PILLOW =
  "flex h-6 flex-1 items-center justify-center gap-1 rounded-xl bg-white/85 shadow-sm ring-1 ring-black/5 dark:bg-white/15 dark:ring-white/10";

const STATUS_STYLES: Record<
  RoomStatus,
  { label: string; card: string; head: string; dot: string; pill: string }
> = {
  available: {
    label: "Available",
    card: "border-emerald-500/30 bg-emerald-500/10",
    head: "border-emerald-500/30 bg-emerald-600/25",
    dot: "bg-emerald-500",
    pill: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
  },
  occupied: {
    label: "Occupied",
    card: "border-rose-500/30 bg-rose-500/10",
    head: "border-rose-500/30 bg-rose-600/25",
    dot: "bg-rose-500",
    pill: "bg-rose-600/15 text-rose-800 dark:text-rose-300",
  },
  cleaning: {
    label: "Cleaning",
    card: "border-amber-500/30 bg-amber-500/10",
    head: "border-amber-500/30 bg-amber-600/25",
    dot: "bg-amber-500",
    pill: "bg-amber-600/15 text-amber-800 dark:text-amber-300",
  },
  maintenance: {
    label: "Maintenance",
    // Was a fully opaque bg-muted — translucent now so it picks up the
    // same backdrop-blur glass effect as every other status.
    card: "border-muted-foreground/25 bg-muted-foreground/10",
    head: "border-muted-foreground/25 bg-muted-foreground/25",
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
  const isAlert = isCritical || isOverdue;
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
        isAlert
          ? "border-red-700/60 bg-red-700/20 hover:bg-red-700/25 dark:border-red-600/70 dark:bg-red-600/25 dark:hover:bg-red-600/30"
          : style.card
      )}
    >
      <div className={CARD_INNER}>
        {/* Headboard with two pillows */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 border-b px-2 py-1",
            isAlert ? "border-red-700/40 bg-red-700/30 dark:bg-red-600/35" : style.head
          )}
        >
          <div className={PILLOW}>
            <span className="font-heading text-lg leading-none font-semibold tracking-tight">
              {room.roomNumber}
            </span>
          </div>
          <div className={PILLOW}>
            {showBooking && (
              <BedDoubleIcon
                className={cn(
                  "size-4 shrink-0 animate-bed-sway",
                  isAlert ? "text-red-700 dark:text-red-400" : "text-rose-500/80 dark:text-rose-400/80"
                )}
              />
            )}
            {room.status === "available" && (
              <BedDoubleIcon className="size-3.5 shrink-0 text-emerald-600/80 dark:text-emerald-400/80" />
            )}
            {room.status === "cleaning" && (
              <BroomIcon className="size-4 shrink-0 animate-broom-sweep text-amber-600/80 dark:text-amber-400/80" />
            )}
            {room.status === "maintenance" && (
              <WrenchIcon className="size-4 shrink-0 animate-wrench-turn text-muted-foreground/80" />
            )}
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                isAlert ? "bg-red-700 ring-2 ring-red-700/30 dark:bg-red-500" : style.dot
              )}
            />
          </div>
        </div>

        {/* Folded-down sheet. gap-0.5 + px-1 on the pill, and the room type
            matched down to the pill's own text-[10px] — on an iPad-Mini-width
            card (~111px inside the padding) "Standard" next to the actual
            deployed Geist font still didn't fit at text-xs (12px): measured
            -5px short even with a milder gap-1 tightening tried first.
            Confirmed against the real font file from the build output, not a
            generic system font, before landing here — ~2.8px of real margin
            on the tightest row ("AVAILABLE", the widest status label), not
            an exact-fit knife edge. */}
        <div className="flex shrink-0 items-center gap-0.5 border-b border-white/50 bg-white/40 px-3 py-0.5 dark:border-white/10 dark:bg-white/5">
          <span
            className={cn(
              "rounded-full px-1 py-0.5 text-[10px] font-bold tracking-wide uppercase",
              isAlert ? "bg-red-700/20 text-red-800 dark:text-red-300" : style.pill
            )}
          >
            {style.label}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">{ROOM_TYPE_LABELS[room.type]}</span>
        </div>

        {/* Blanket */}
        {showBooking ? (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 pt-1 pb-2">
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
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-end px-3 pt-1 pb-2">
            {room.status === "available" ? (
              <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                <BedDoubleIcon className="size-4 shrink-0" />
                Tap to check in
              </div>
            ) : room.status === "cleaning" ? (
              <div className="text-sm font-medium text-amber-800 dark:text-amber-300">Tap when ready</div>
            ) : (
              <div className="text-sm font-medium text-muted-foreground">Tap to update</div>
            )}
          </div>
        )}
      </div>

      {/* Footboard */}
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
