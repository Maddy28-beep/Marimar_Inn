"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { subscribeToActiveBookings } from "@/lib/bookings";
import { subscribeToRooms } from "@/lib/rooms";
import type { Booking, Room } from "@/lib/types";

interface FrontDeskValue {
  rooms: Room[] | null;
  bookingsByRoom: Map<string, Booking>;
  roomsLoaded: boolean;
}

const FrontDeskContext = createContext<FrontDeskValue | null>(null);

export function FrontDeskProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [bookingsByRoom, setBookingsByRoom] = useState<Map<string, Booking>>(() => new Map());

  useEffect(() => subscribeToRooms(setRooms), []);
  useEffect(() => subscribeToActiveBookings(setBookingsByRoom), []);

  const value = useMemo<FrontDeskValue>(
    () => ({
      rooms,
      bookingsByRoom,
      roomsLoaded: rooms !== null,
    }),
    [rooms, bookingsByRoom]
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
