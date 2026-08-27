import type { Timestamp } from "firebase/firestore";

export type UserRole = "owner" | "admin" | "superadmin" | "supervisor" | "cashier";

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  // Absent/true = active. Deactivating keeps the account and its role
  // intact (unlike delete) but blocks sign-in until reactivated.
  active?: boolean;
}

export type RoomStatus = "available" | "occupied" | "cleaning" | "maintenance";
export type RoomType = "standard" | "deluxe" | "suite";
export type PaymentMethod = "cash" | "gcash" | "qrph" | "split";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type BookingStatus = "active" | "checked_out" | "voided";

export type VoidRequestStatus = "pending" | "approved" | "denied";

// "booking" (the original) cancels the whole room booking. "order_item"
// removes one already-paid-for store item a cashier added by mistake —
// same request/approve flow, but scoped to a single line item instead of
// the whole stay. Absent on older docs means "booking" (see the `?? "booking"`
// fallbacks wherever this is read).
export type VoidRequestTarget = "booking" | "order_item";

// A cashier-filed request past the self-serve window — durable audit
// trail, resolved exactly once by an owner/admin. Amounts/names are
// snapshotted at request time so the review UI and the audit trail don't
// depend on the (possibly since-changed or gone) booking.
export interface VoidRequest {
  voidRequestId: string;
  bookingId: string;
  roomId: string;
  roomNumber: string;
  guestName: string;
  target?: VoidRequestTarget;
  totalAmount: number;
  amountPaid: number;
  checkInTime: Timestamp;
  // order_item only — the specific line item this request wants removed.
  itemId?: string;
  itemName?: string;
  itemQuantity?: number;
  itemSubtotal?: number;
  reason: string;
  status: VoidRequestStatus;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Timestamp;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: Timestamp;
  resolutionNote?: string;
}

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
  // Snapshot of who checked the guest in and their role at that time — lets
  // the Owner tell who transacted a booking (Owner/Admin/Supervisor/
  // Cashier) without joining against the users collection, which can change
  // later. Bookings from before this field existed just won't show a name.
  cashierName?: string;
  cashierRole?: UserRole;
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
  // For a genuinely unlimited resource (e.g. hot water) — never counted as
  // low stock, never decremented when ordered, and quantity/minStockLevel
  // are ignored everywhere this is true.
  unlimited?: boolean;
  lastUpdated: Timestamp;
}

export type NotificationType = "checkout_reminder" | "low_stock" | "void_request";

export interface AppNotification {
  notificationId: string;
  type: NotificationType;
  message: string;
  roomId?: string;
  roomNumber?: string;
  itemId?: string;
  itemName?: string;
  bookingId?: string;
  voidRequestId?: string;
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

export type TransactionType = "checkin" | "extend" | "checkout" | "order" | "payment";

// One record per money-collecting event on a booking (check-in payment,
// extend payment, checkout payment) — a booking's own checkInTime never
// moves when it's later extended, so shift cash-reconciliation can't rely
// on it alone: a booking that started in the day shift can still collect
// real cash from the night shift's cashier at extend/checkout time. This
// log is what shift reports use to attribute each peso to the shift it was
// actually collected in.
export interface Transaction {
  transactionId: string;
  type: TransactionType;
  bookingId: string;
  roomNumber: string;
  amount: number;
  cashAmount: number;
  gcashAmount: number;
  qrphAmount: number;
  cashierId: string;
  cashierName: string;
  timestamp: Timestamp;
}
