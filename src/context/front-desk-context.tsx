"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { subscribeToActiveBookings } from "@/lib/bookings";
import { subscribeToRooms } from "@/lib/rooms";
import { subscribeToPendingVoidRequests } from "@/lib/void-requests";
import { subscribeToPendingStockRequests } from "@/lib/stock-requests";
import type { Booking, Room, StockRequest, VoidRequest } from "@/lib/types";

interface FrontDeskValue {
  rooms: Room[] | null;
  bookingsByRoom: Map<string, Booking>;
  roomsLoaded: boolean;
  pendingVoidRequestsByBookingId: Map<string, VoidRequest[]>;
  pendingStockRequests: StockRequest[];
}

const FrontDeskContext = createContext<FrontDeskValue | null>(null);

export function FrontDeskProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [bookingsByRoom, setBookingsByRoom] = useState<Map<string, Booking>>(() => new Map());
  const [pendingVoidRequestsByBookingId, setPendingVoidRequestsByBookingId] = useState<
    Map<string, VoidRequest[]>
  >(() => new Map());
  const [pendingStockRequests, setPendingStockRequests] = useState<StockRequest[]>([]);

  useEffect(() => subscribeToRooms(setRooms), []);
  useEffect(() => subscribeToActiveBookings(setBookingsByRoom), []);
  useEffect(() => subscribeToPendingVoidRequests(setPendingVoidRequestsByBookingId), []);
  useEffect(() => subscribeToPendingStockRequests(setPendingStockRequests), []);

  const value = useMemo<FrontDeskValue>(
    () => ({
      rooms,
      bookingsByRoom,
      roomsLoaded: rooms !== null,
      pendingVoidRequestsByBookingId,
      pendingStockRequests,
    }),
    [rooms, bookingsByRoom, pendingVoidRequestsByBookingId, pendingStockRequests]
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
