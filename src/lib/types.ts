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
export type PaymentMethod = "cash" | "gcash";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type BookingStatus = "active" | "checked_out" | "voided";

export interface Room {
  roomId: string;
  roomNumber: string;
  floor: number;
  type: RoomType;
  status: RoomStatus;
  lastUpdated: Timestamp;
}

export interface RatePackage {
  hours: number;
  price: number;
}

// Fixed rate card posted at the front desk — not a per-hour rate, so these
// are looked up by package rather than computed from a formula.
export const ROOM_RATE_PACKAGES: RatePackage[] = [
  { hours: 3, price: 200 },
  { hours: 4, price: 250 },
  { hours: 5, price: 300 },
  { hours: 6, price: 400 },
  { hours: 12, price: 800 },
];

export interface OrderItem {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
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
  // True once a stay has been converted to "open time" — no fixed end time,
  // billed as a final lump sum at checkout since there's no per-hour rate
  // set yet. The countdown/overdue UI and reminder alarm skip these rooms.
  openEnded?: boolean;
  totalRoomCharge: number;
  totalFbCharge: number;
  totalAmount: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  // GCash transaction reference number, so the Owner can cross-check the
  // payment later. Only collected when paymentMethod is "gcash".
  gcashReference?: string;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  items: OrderItem[];
  checkOutTime?: Timestamp;
  specialRequests?: string;
  cashierId: string;
  updatedAt: Timestamp;
}

export interface InventoryItem {
  itemId: string;
  name: string;
  category: string;
  sellingPrice: number;
  quantity: number;
  minStockLevel: number;
  lastUpdated: Timestamp;
}

export type NotificationType = "checkout_reminder" | "low_stock";

export interface AppNotification {
  notificationId: string;
  type: NotificationType;
  message: string;
  roomId?: string;
  roomNumber?: string;
  itemId?: string;
  itemName?: string;
  createdAt: Timestamp;
  resolved: boolean;
  readBy: string[];
}

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  standard: "Standard",
  deluxe: "Deluxe",
  suite: "Suite",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
};
