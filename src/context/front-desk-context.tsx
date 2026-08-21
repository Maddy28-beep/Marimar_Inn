"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { subscribeToActiveBookings } from "@/lib/bookings";
import { subscribeToRooms } from "@/lib/rooms";
import { useNowTick } from "@/hooks/use-now-tick";
import type { Booking, Room } from "@/lib/types";

interface FrontDeskValue {
  rooms: Room[] | null;
  bookingsByRoom: Map<string, Booking>;
  roomsLoaded: boolean;
  now: Date;
}

const FrontDeskContext = createContext<FrontDeskValue | null>(null);

export function FrontDeskProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [bookingsByRoom, setBookingsByRoom] = useState<Map<string, Booking>>(() => new Map());
  const now = useNowTick(30_000);

  useEffect(() => subscribeToRooms(setRooms), []);
  useEffect(() => subscribeToActiveBookings(setBookingsByRoom), []);

  const value = useMemo<FrontDeskValue>(
    () => ({
      rooms,
      bookingsByRoom,
      roomsLoaded: rooms !== null,
      now,
    }),
    [rooms, bookingsByRoom, now]
  );

  return <FrontDeskContext.Provider value={value}>{children}</FrontDeskContext.Provider>;
}

export function useFrontDesk(): FrontDeskValue {
  const value = useContext(FrontDeskContext);
  if (!value) {
    throw new Error("useFrontDesk must be used inside FrontDeskProvider.");
  }
  return value;
}
