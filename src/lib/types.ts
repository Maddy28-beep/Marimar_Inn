import type { Timestamp } from "firebase/firestore";

export type UserRole = "owner" | "admin" | "superadmin" | "cashier";

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
}

export type RoomStatus = "available" | "occupied" | "cleaning" | "maintenance";
export type RoomType = "standard" | "deluxe" | "suite";
export type PaymentMethod = "cash" | "gcash" | "qrph" | "split";
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

// Fixed rate card posted at the front desk — not a per-hour rate, so these
// are looked up by package rather than computed from a formula. Owner-
// editable via Manage Rooms; DEFAULT_RATE_PACKAGES below only seeds the
// initial list.
export interface RatePackage {
  packageId: string;
  hours: number;
  price: number;
}

export const DEFAULT_RATE_PACKAGES: Omit<RatePackage, "packageId">[] = [
  { hours: 3, price: 200 },
  { hours: 4, price: 250 },
  { hours: 5, price: 300 },
  { hours: 6, price: 400 },
  { hours: 12, price: 800 },
  { hours: 24, price: 1600 },
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
  // Snapshot of the rate package chosen at check-in, kept immutable even
  // after extendStay()/settleOpenTimeCharge() change hoursBooked and
  // totalRoomCharge — lets the Daily Sales Report show "package" vs
  // "extension" the way the front desk's paper log does. Bookings from
  // before this field existed fall back to treating the current totals as
  // the package amount (no extension shown).
  originalPackageHours?: number;
  originalPackagePrice?: number;
  // True once a stay has been converted to "open time" — no fixed end time,
  // billed as a final lump sum at checkout since there's no per-hour rate
  // set yet. The countdown/overdue UI and reminder alarm skip these rooms.
  openEnded?: boolean;
  extraPersonCount?: number;
  towelCount?: number;
  blanketCount?: number;
  totalRoomCharge: number;
  totalFbCharge: number;
  totalAmount: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  // Digital-wallet transaction references so the Owner can cross-check later.
  gcashReference?: string;
  qrphReference?: string;
  // Running cash / GCash / QRPh totals across check-in, extend, and checkout
  // — reports attribute each peso to the right method instead of guessing
  // from the latest paymentMethod label.
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  items: OrderItem[];
  checkOutTime?: Timestamp;
  specialRequests?: string;
  cashierId: string;
  updatedAt: Timestamp;
}

export interface InventoryCategory {
  categoryId: string;
  name: string;
  createdAt: Timestamp;
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
  qrph: "QRPh",
  split: "Split",
};

export const EXTRA_PERSON_FEE = 100;
export const TOWEL_FEE = 20;
export const BLANKET_FEE = 20;
export const AMENITY_TOWEL_ID = "amenity-towel";
export const AMENITY_BLANKET_ID = "amenity-blanket";

// Cash taken out of the drawer during a shift (supplies, fare, etc.).
// Timestamped so daily/shift reports can deduct it from that period's cash.
export interface ShiftExpense {
  expenseId: string;
  amount: number;
  description: string;
  recordedAt: Timestamp;
  cashierId: string;
  cashierName: string;
}

export interface StoreSale {
  saleId: string;
  soldAt: Timestamp;
  guestName: string;
  items: OrderItem[];
  totalAmount: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  gcashReference?: string;
  qrphReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
  cashierId: string;
  cashierName: string;
}
