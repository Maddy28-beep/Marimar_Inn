import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { referenceNumberFor } from "@/lib/receipt-printer";
import type { Booking, PaymentMethod, Room, RoomType, ShiftExpense } from "@/lib/types";

function requireDb() {
  if (!db) throw new Error("Firebase isn't configured.");
  return db;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A single range filter on one field never needs a manual composite index —
 * Firestore auto-indexes every field individually. Deliberately avoiding
 * combining this with an extra `where`/`orderBy` on a different field, since
 * that's exactly what forces a console trip to create a composite index.
 */
export async function fetchBookingsInRange(
  field: "checkInTime" | "checkOutTime",
  start: Date,
  end: Date
): Promise<Booking[]> {
  const firestore = requireDb();
  const q = query(
    collection(firestore, "bookings"),
    where(field, ">=", Timestamp.fromDate(start)),
    where(field, "<=", Timestamp.fromDate(end))
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Booking);
}

/**
 * Every currently-active booking, regardless of check-in date. A room can be
 * overdue right now while its guest checked in on a *previous* calendar day
 * (long stays, or a check-in shortly before midnight) — scoping the overdue
 * report purely by the selected day's check-ins would silently miss it, so
 * this is merged in on top of that day-scoped query no matter which date is
 * picked.
 */
export async function fetchActiveBookings(): Promise<Booking[]> {
  const firestore = requireDb();
  const q = query(collection(firestore, "bookings"), where("status", "==", "active"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Booking);
}

interface ItemTally {
  name: string;
  quantity: number;
  revenue: number;
}

function tallyItems(bookings: Booking[]): Map<string, ItemTally> {
  const map = new Map<string, ItemTally>();
  for (const booking of bookings) {
    for (const item of booking.items ?? []) {
      const existing = map.get(item.itemId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += item.subtotal;
      } else {
        map.set(item.itemId, { name: item.name, quantity: item.quantity, revenue: item.subtotal });
      }
    }
  }
  return map;
}

export interface DailyReport {
  checkIns: number;
  checkOuts: number;
  roomRevenue: number;
  fbRevenue: number;
  totalRevenue: number;
  mostOrderedItems: ItemTally[];
}

export function computeDailyReport(checkedInToday: Booking[], checkOutsToday: number): DailyReport {
  // A voided booking never happened as a sale — it must never inflate
  // check-in counts, revenue, or item tallies just because a room was
  // briefly assigned to it before the front desk cancelled it.
  checkedInToday = checkedInToday.filter((b) => b.status !== "voided");

  // Bookings created before Phase 3 predate totalFbCharge/items — treat
  // missing numeric fields as 0 rather than letting `undefined` poison the
  // sum into NaN.
  const roomRevenue = checkedInToday.reduce((sum, b) => sum + (b.totalRoomCharge ?? 0), 0);
  const fbRevenue = checkedInToday.reduce((sum, b) => sum + (b.totalFbCharge ?? 0), 0);
  const mostOrderedItems = Array.from(tallyItems(checkedInToday).values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  return {
    checkIns: checkedInToday.length,
    checkOuts: checkOutsToday,
    roomRevenue,
    fbRevenue,
    totalRevenue: roomRevenue + fbRevenue,
    mostOrderedItems,
  };
}

export interface DailySalesRow {
  bookingId: string;
  roomNumber: string;
  refNumber: string;
  guestName: string;
  packageHours: number;
  checkInTime: Date;
  scheduledCheckOutTime: Date;
  packageAmount: number;
  extensionHours: number;
  extensionAmount: number;
  actualCheckOutTime: Date | null;
  totalRoomAmount: number;
  totalStoreAmount: number;
  totalPaid: number;
  paymentMethod: PaymentMethod;
  gcashReference?: string;
  qrphReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
}

export interface DailySalesTotals {
  packageAmount: number;
  extensionAmount: number;
  totalRoomAmount: number;
  totalStoreAmount: number;
  totalPaid: number;
  cashCollected: number;
  gcashCollected: number;
  qrphCollected: number;
}

export interface DailySalesReport {
  rows: DailySalesRow[];
  totals: DailySalesTotals;
}

/**
 * Mirrors the front desk's paper "Daily Sales Report" — one row per booking
 * checked in that day, split into package vs. extension amounts using the
 * originalPackageHours/Price snapshot taken at check-in.
 */
export function computeDailySalesReport(bookings: Booking[]): DailySalesReport {
  const rows: DailySalesRow[] = bookings
    .filter((b) => b.status !== "voided")
    .sort((a, b) => a.checkInTime.toMillis() - b.checkInTime.toMillis())
    .map((booking) => {
      const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
      const packageAmount = booking.originalPackagePrice ?? booking.totalRoomCharge ?? 0;
      const totalRoomAmount = booking.totalRoomCharge ?? 0;
      const checkInDate = booking.checkInTime.toDate();
      return {
        bookingId: booking.bookingId,
        roomNumber: booking.roomNumber,
        refNumber: referenceNumberFor(booking.bookingId),
        guestName: booking.guestName,
        packageHours,
        checkInTime: checkInDate,
        scheduledCheckOutTime: new Date(checkInDate.getTime() + packageHours * 60 * 60 * 1000),
        packageAmount,
        extensionHours: Math.max(0, (booking.hoursBooked ?? packageHours) - packageHours),
        extensionAmount: Math.max(0, totalRoomAmount - packageAmount),
        actualCheckOutTime: booking.checkOutTime ? booking.checkOutTime.toDate() : null,
        totalRoomAmount,
        totalStoreAmount: booking.totalFbCharge ?? 0,
        totalPaid: booking.amountPaid ?? 0,
        paymentMethod: booking.paymentMethod,
        gcashReference: booking.gcashReference,
        qrphReference: booking.qrphReference,
        splitCashAmount: booking.splitCashAmount,
        splitGcashAmount: booking.splitGcashAmount,
        splitQrphAmount: booking.splitQrphAmount,
      };
    });

  const totals = rows.reduce<DailySalesTotals>(
    (acc, row) => {
      acc.packageAmount += row.packageAmount;
      acc.extensionAmount += row.extensionAmount;
      acc.totalRoomAmount += row.totalRoomAmount;
      acc.totalStoreAmount += row.totalStoreAmount;
      acc.totalPaid += row.totalPaid;
      // splitCashAmount/splitGcashAmount track the running cash/GCash total
      // across every transaction on the booking (check-in, extend,
      // checkout), so they're the source of truth whenever present — a
      // booking can end up with a non-"split" final paymentMethod even
      // after mixing methods across transactions. Only bookings from
      // before this tracking existed fall back to the single-method guess.
      if (
        row.splitCashAmount !== undefined ||
        row.splitGcashAmount !== undefined ||
        row.splitQrphAmount !== undefined
      ) {
        acc.cashCollected += row.splitCashAmount ?? 0;
        acc.gcashCollected += row.splitGcashAmount ?? 0;
        acc.qrphCollected += row.splitQrphAmount ?? 0;
      } else if (row.paymentMethod === "cash") {
        acc.cashCollected += row.totalPaid;
      } else if (row.paymentMethod === "qrph") {
        acc.qrphCollected += row.totalPaid;
      } else {
        acc.gcashCollected += row.totalPaid;
      }
      return acc;
    },
    {
      packageAmount: 0,
      extensionAmount: 0,
      totalRoomAmount: 0,
      totalStoreAmount: 0,
      totalPaid: 0,
      cashCollected: 0,
      gcashCollected: 0,
      qrphCollected: 0,
    }
  );

  return { rows, totals };
}

export interface OverdueRecord {
  bookingId: string;
  roomNumber: string;
  guestName: string;
  checkInTime: Date;
  bookedUntil: Date;
  actualCheckOutTime: Date | null;
  overdueByHours: number;
  stillOngoing: boolean;
}

/**
 * Works for both live and historical review from the same data: an active
 * booking's overdue duration is measured against "now" (so it grows as you
 * watch), while a checked-out booking's is measured against its actual
 * checkOutTime and then frozen forever — this is what lets the Owner check
 * "who was overdue" days later, not just while the room card is on screen.
 * Voided bookings and open-time stays (no fixed end time) are excluded.
 */
export function computeOverdueHistory(bookings: Booking[], now: Date): OverdueRecord[] {
  const records: OverdueRecord[] = [];

  for (const booking of bookings) {
    if (booking.openEnded || booking.status === "voided") continue;

    const checkInDate = booking.checkInTime.toDate();
    const bookedUntil = new Date(checkInDate.getTime() + (booking.hoursBooked ?? 0) * 60 * 60 * 1000);
    const actualCheckOutTime = booking.checkOutTime ? booking.checkOutTime.toDate() : null;
    const referenceEnd = actualCheckOutTime ?? now;
    const overdueByHours = Math.max(0, (referenceEnd.getTime() - bookedUntil.getTime()) / (1000 * 60 * 60));

    if (overdueByHours <= 0) continue;

    records.push({
      bookingId: booking.bookingId,
      roomNumber: booking.roomNumber,
      guestName: booking.guestName,
      checkInTime: checkInDate,
      bookedUntil,
      actualCheckOutTime,
      overdueByHours,
      stillOngoing: booking.status === "active",
    });
  }

  records.sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime());
  return records;
}

export interface DailyRevenuePoint {
  date: string;
  roomRevenue: number;
  fbRevenue: number;
  total: number;
  checkIns: number;
}

export interface RangeDayPoint {
  date: string;
  checkIns: number;
  roomRevenue: number;
  storeRevenue: number;
  sales: number;
  expenses: number;
  net: number;
}

/**
 * One row per calendar day in [from, to], inclusive. Sales follow check-in
 * date (same as the daily report); expenses follow recordedAt so a fare
 * logged at 1 AM lands on that calendar day.
 */
export function computeRangeDailySeries(
  from: Date,
  to: Date,
  bookings: Booking[],
  expenses: ShiftExpense[]
): RangeDayPoint[] {
  bookings = bookings.filter((b) => b.status !== "voided");

  const map = new Map<string, RangeDayPoint>();
  const cursor = startOfDay(from);
  const last = startOfDay(to);
  while (cursor.getTime() <= last.getTime()) {
    const key = dateKey(cursor);
    map.set(key, {
      date: key,
      checkIns: 0,
      roomRevenue: 0,
      storeRevenue: 0,
      sales: 0,
      expenses: 0,
      net: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const booking of bookings) {
    const point = map.get(dateKey(booking.checkInTime.toDate()));
    if (!point) continue;
    const room = booking.totalRoomCharge ?? 0;
    const store = booking.totalFbCharge ?? 0;
    point.checkIns += 1;
    point.roomRevenue += room;
    point.storeRevenue += store;
    point.sales += room + store;
  }

  for (const expense of expenses) {
    const when = expense.recordedAt?.toDate?.();
    if (!when) continue;
    const point = map.get(dateKey(when));
    if (!point) continue;
    point.expenses += expense.amount ?? 0;
  }

  for (const point of map.values()) {
    point.net = point.sales - point.expenses;
  }

  return Array.from(map.values());
}

export interface RoomTypeRevenue {
  type: RoomType;
  revenue: number;
  bookings: number;
}

export interface MonthlyReport {
  totalRevenue: number;
  roomRevenue: number;
  fbRevenue: number;
  totalCheckIns: number;
  occupancyPercent: number;
  dailySeries: DailyRevenuePoint[];
  revenueByRoomType: RoomTypeRevenue[];
  topItemsByQuantity: ItemTally[];
  topItemsByRevenue: ItemTally[];
}

export function computeMonthlyReport(
  bookings: Booking[],
  rooms: Room[],
  monthDate: Date
): MonthlyReport {
  bookings = bookings.filter((b) => b.status !== "voided");

  const roomTypeById = new Map(rooms.map((r) => [r.roomId, r.type]));
  const numDays = daysInMonth(monthDate);

  const dailyMap = new Map<string, DailyRevenuePoint>();
  for (let day = 1; day <= numDays; day++) {
    const key = dateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
    dailyMap.set(key, { date: key, roomRevenue: 0, fbRevenue: 0, total: 0, checkIns: 0 });
  }

  let roomRevenue = 0;
  let fbRevenue = 0;
  let totalHoursBooked = 0;
  const roomTypeRevenue = new Map<RoomType, { revenue: number; bookings: number }>();

  for (const booking of bookings) {
    // Same defensive-default reasoning as computeDailyReport: bookings from
    // before Phase 3/4 may be missing totalFbCharge, or (rarer) totalAmount.
    const bookingRoomCharge = booking.totalRoomCharge ?? 0;
    const bookingFbCharge = booking.totalFbCharge ?? 0;
    roomRevenue += bookingRoomCharge;
    fbRevenue += bookingFbCharge;
    totalHoursBooked += booking.hoursBooked ?? 0;

    const point = dailyMap.get(dateKey(booking.checkInTime.toDate()));
    if (point) {
      point.roomRevenue += bookingRoomCharge;
      point.fbRevenue += bookingFbCharge;
      point.total += booking.totalAmount ?? bookingRoomCharge + bookingFbCharge;
      point.checkIns += 1;
    }

    const type = roomTypeById.get(booking.roomId);
    if (type) {
      const existing = roomTypeRevenue.get(type) ?? { revenue: 0, bookings: 0 };
      existing.revenue += bookingRoomCharge;
      existing.bookings += 1;
      roomTypeRevenue.set(type, existing);
    }
  }

  const totalRoomHoursAvailable = rooms.length * numDays * 24;
  const occupancyPercent =
    totalRoomHoursAvailable > 0 ? (totalHoursBooked / totalRoomHoursAvailable) * 100 : 0;

  const items = Array.from(tallyItems(bookings).values());

  return {
    totalRevenue: roomRevenue + fbRevenue,
    roomRevenue,
    fbRevenue,
    totalCheckIns: bookings.length,
    occupancyPercent,
    dailySeries: Array.from(dailyMap.values()),
    revenueByRoomType: Array.from(roomTypeRevenue.entries()).map(([type, v]) => ({ type, ...v })),
    topItemsByQuantity: [...items].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    topItemsByRevenue: [...items].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}
