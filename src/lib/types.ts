import type { Timestamp } from "firebase/firestore";

export type UserRole = "owner" | "cashier";

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
}

export type RoomStatus = "available" | "occupied" | "cleaning" | "maintenance";
export type RoomType = "standard" | "deluxe" | "suite";
export type PaymentMethod = "cash" | "gcash" | "credit_card" | "bank_transfer";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type BookingStatus = "active" | "checked_out" | "voided";

export interface Room {
  roomId: string;
  roomNumber: string;
  floor: number;
  type: RoomType;
  ratePerHour: number;
  status: RoomStatus;
  lastUpdated: Timestamp;
}

export interface Booking {
  bookingId: string;
  roomId: string;
  roomNumber: string;
  guestName: string;
  guestPhone?: string;
  guestCount?: number;
  checkInTime: Timestamp;
  hoursBooked: number;
  totalRoomCharge: number;
  totalAmount: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  checkOutTime?: Timestamp;
  specialRequests?: string;
  cashierId: string;
  updatedAt: Timestamp;
}

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  standard: "Standard",
  deluxe: "Deluxe",
  suite: "Suite",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  credit_card: "Credit Card",
  bank_transfer: "Bank Transfer",
};
