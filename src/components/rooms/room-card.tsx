"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { Booking, Room, RoomStatus } from "@/lib/types";
import { hoursElapsed } from "@/lib/bookings";
import { formatHours } from "@/lib/time";
import { useAuth } from "@/context/auth-context";
import { isOwnerLikeRole } from "@/lib/roles";
import { BedDoubleIcon, BroomIcon, CheckCircle2Icon, ClockIcon, WrenchIcon } from "lucide-react";

// One shared photo for every room (all rooms are Standard for now) —
// pre-resized/compressed to ~70KB (was a 2.3MB source) since it's loaded
// on every card and this app runs on a tablet over an occasionally slow
// connection.
const ROOM_PHOTO_SRC = "/logo/room.jpg";

// Every card is the exact same fixed height, not sized to its own content —
// a room with a guest, a balance due, and a countdown must look identical
// in size to an empty Available card, so the grid stays perfectly aligned
// no matter what's actually happening in each room. flex-col + the flex-1
// middle wrapper below (not this card growing) is what keeps the footer
// pinned to the same place across every status.
//
// Separate, smaller height below the sm breakpoint (< 640px, i.e. phones —
// matches room-grid.tsx's own 2-col/3-col breakpoint), not the desktop h-72
// reused everywhere: h-72 was originally measured against the busiest
// occupied case (guest name + In/Out + countdown + progress + balance) at
// desktop width, but that same fixed height on a phone — where every pixel
// of scroll matters — read as broken empty space for every less-busy
// status/booking, since content height doesn't scale with the card's own
// width. h-64 was re-measured (not guessed) against that exact busiest case
// with the smaller mobile photo below and still clears it with a few
// pixels to spare; see the justify-between/justify-center split further
// down for how what little slack remains gets distributed instead of
// dumped in one spot below the payment line.
//
// No separate action button anymore — the whole card is already a real
// <button> (native keyboard focus + Enter/Space activation, no extra work
// needed for that part). group is for the room-number hover/focus tint
// below; the visible focus-visible ring is the polished keyboard-only
// affordance the boxed button used to provide implicitly.
const CARD_SHELL =
  "group relative flex h-64 w-full flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-lg shadow-black/5 ring-1 ring-inset ring-white/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:shadow-black/20 dark:ring-white/10 sm:h-72";

const STATUS_STYLES: Record<
  RoomStatus,
  { label: string; border: string; badge: string; body: string; accent: string; ring: string; hint: string }
> = {
  available: {
    label: "Available",
    border: "border-emerald-500/30",
    badge: "bg-emerald-600 text-white",
    body: "bg-card",
    accent: "group-hover:text-emerald-700 dark:group-hover:text-emerald-400",
    ring: "focus-visible:ring-emerald-500",
    hint: "text-emerald-700 dark:text-emerald-400",
  },
  occupied: {
    label: "Occupied",
    border: "border-rose-500/30",
    badge: "bg-rose-600 text-white",
    body: "bg-rose-500/10",
    accent: "group-hover:text-rose-700 dark:group-hover:text-rose-400",
    ring: "focus-visible:ring-rose-500",
    hint: "text-rose-700 dark:text-rose-400",
  },
  cleaning: {
    label: "Cleaning",
    border: "border-amber-500/30",
    badge: "bg-amber-600 text-white",
    body: "bg-amber-500/10",
    accent: "group-hover:text-amber-700 dark:group-hover:text-amber-400",
    ring: "focus-visible:ring-amber-500",
    hint: "text-amber-800 dark:text-amber-300",
  },
  maintenance: {
    label: "Maintenance",
    border: "border-muted-foreground/25",
    badge: "bg-muted-foreground text-white",
    body: "bg-muted-foreground/10",
    accent: "group-hover:text-foreground",
    ring: "focus-visible:ring-muted-foreground",
    hint: "text-muted-foreground",
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
  const isAlert = isCritical || isOverdue;
  // "Expected out" is just checkInTime + hoursBooked — data we already
  // have, shown as a clock time instead of only a countdown, same as the
  // "Check-in" time next to it.
  const expectedOut =
    showBooking && !booking!.openEnded
      ? new Date(booking!.checkInTime.toDate().getTime() + booking!.hoursBooked * 60 * 60 * 1000)
      : null;
  const timeLabel = (d: Date) => d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  const hintText =
    room.status === "available"
      ? "Click room to check in →"
      : room.status === "occupied"
        ? "Click room to view →"
        : room.status === "cleaning"
          ? "Click room to mark ready →"
          : "Click room to update →";

  return (
    <button
      type="button"
      onClick={() => onSelect(room)}
      className={cn(
        CARD_SHELL,
        isAlert ? "border-red-700/60 focus-visible:ring-red-700 dark:border-red-600/70" : cn(style.border, style.ring)
      )}
    >
      {/* 1. Photo — fixed height, object-cover */}
      <div className="relative h-20 w-full shrink-0 overflow-hidden sm:h-28">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ROOM_PHOTO_SRC} alt="" className="h-full w-full object-cover" />
        <span
          className={cn(
            "absolute top-2 right-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase shadow",
            isAlert ? "bg-red-700 text-white" : style.badge
          )}
        >
          {style.label}
        </span>
        {showBooking && (
          <BedDoubleIcon
            className={cn(
              "absolute bottom-2 left-2 size-5 animate-bed-sway drop-shadow",
              isAlert ? "text-red-100" : "text-white"
            )}
          />
        )}
        {room.status === "cleaning" && (
          <BroomIcon className="absolute bottom-2 left-2 size-5 animate-broom-sweep text-white drop-shadow" />
        )}
        {room.status === "maintenance" && (
          <WrenchIcon className="absolute bottom-2 left-2 size-5 animate-wrench-turn text-white drop-shadow" />
        )}
      </div>

      {/* Everything below the photo fills the rest of the fixed card
          height exactly, every time. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 p-3",
          isAlert ? "bg-red-700/10" : style.body
        )}
      >
        {/* 2. Room number + guest — no room type shown here anymore (Owner:
            every room is Standard, so there's nothing to distinguish/compare
            against). */}
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span
            className={cn(
              "shrink-0 truncate font-heading text-base leading-tight font-bold tracking-wide uppercase transition-colors",
              style.accent,
              isAlert && "group-hover:text-red-700 dark:group-hover:text-red-400"
            )}
          >
            Room {room.roomNumber}
          </span>
          {showBooking && (
            <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
              {booking!.guestName}
            </span>
          )}
        </div>

        {/* 3+4. Time/status info. Each individual line is horizontally
            centered — left-aligning them left a one-sided blank strip on
            the right of the card (flagged by the Owner as looking
            unfinished), since these are short lines that don't reach the
            card's own edges. The progress bar stays full-width (it's a
            graphic meter, not text, so touching both edges reads as
            intentional). Centering via mx-auto/text-center rather than flex
            justify-center: justify-center on a flex row combined with a
            truncating child clips symmetrically from both sides with no
            visible ellipsis (see the countdown row and hint-text notes
            elsewhere in this file) — mx-auto on a w-fit/max-w-full box, or
            plain text-center on a non-flex block, doesn't have that
            problem.
            Vertically: a fixed-length booking (In/Out, countdown, progress,
            payment — 4 rows) has close to zero slack against the card's
            fixed height, so justify-between just quietly closes whatever
            sliver is left by spreading it across the gaps instead of
            dumping it all in one spot below the payment line. An
            open-ended booking only has 2 rows (no In/Out or progress bar,
            since there's no booked end time) — justify-between would yank
            those two far apart with one big gap in between, so it gets the
            same honest justify-center as the single-line quiet statuses
            (Available/Cleaning/Maintenance) instead. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-1 overflow-hidden",
            showBooking ? (booking!.openEnded ? "justify-center" : "justify-between") : "justify-center"
          )}
        >
          {showBooking ? (
            <>
              {expectedOut && (
                // Stacked, not side-by-side — side-by-side is what let the
                // bigger/bolder time values overflow their half of the row
                // on narrow phones (~355px and down). Each on its own full-
                // width line has room to be this size without truncating.
                <div className="shrink-0 text-center text-sm">
                  <div className="truncate">
                    <span className="text-muted-foreground">In </span>
                    <span className="font-bold">{timeLabel(booking!.checkInTime.toDate())}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-muted-foreground">Out </span>
                    <span className="font-bold">{timeLabel(expectedOut)}</span>
                  </div>
                </div>
              )}
              <div
                className={cn(
                  "mx-auto flex w-fit max-w-full items-center gap-1 text-base leading-tight font-bold",
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
                <ClockIcon className="size-4 shrink-0" />
                <span className="truncate">
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
                </span>
              </div>
              {!booking!.openEnded && (
                <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      isOverdue || isCritical ? "bg-red-700" : isRunningLow ? "bg-amber-500" : "bg-rose-400"
                    )}
                    style={{ width: `${Math.round(usedFrac * 100)}%` }}
                  />
                </div>
              )}
              {/* Real data either way — never fabricated: the amount due
                  when there's a balance, or the booking's own recorded
                  paymentStatus when it's already settled. */}
              {balance > 0 ? (
                <div className="mx-auto w-fit max-w-full truncate rounded-md bg-amber-500/25 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                  ₱{balance.toFixed(2)} due
                </div>
              ) : (
                booking!.paymentStatus === "paid" && (
                  <div className="mx-auto flex w-fit max-w-full items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2Icon className="size-3 shrink-0" />
                    Paid in full
                  </div>
                )
              )}
            </>
          ) : room.status === "available" ? (
            // truncate goes on the text span, not this flex row — on a flex
            // container, white-space:nowrap doesn't stop the icon+text from
            // wrapping, so the ellipsis never actually kicked in; a very
            // narrow phone (~320px) just clipped the word outright instead
            // of showing "...". Same fix applied to the two statuses below.
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2Icon className="size-4 shrink-0" />
              <span className="truncate">Ready for check-in</span>
            </div>
          ) : room.status === "cleaning" ? (
            <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
              <BroomIcon className="size-4 shrink-0" />
              <span className="truncate">Cleaning in progress</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <WrenchIcon className="size-4 shrink-0" />
              <span className="truncate">Room unavailable</span>
            </div>
          )}
        </div>

        {/* 5. Small context label instead of a boxed button — the card
            itself is the whole interaction target, this just spells out
            what tapping it does. Fixed height so it doesn't shift layout
            between statuses. Deliberately NOT a flex row with
            justify-center: centering a too-wide flex child clips it evenly
            from both sides with no visible "…", which is what a very
            narrow phone (~320px) actually did. Plain block + text-center
            gets a real trailing ellipsis when it overflows, and still
            reads centered the rest of the time. */}
        <div
          className={cn(
            "h-5 shrink-0 truncate text-center text-xs font-medium opacity-70 transition-opacity group-hover:opacity-100",
            isAlert ? "text-red-700 dark:text-red-400" : style.hint
          )}
        >
          {hintText}
        </div>
      </div>
    </button>
  );
});
