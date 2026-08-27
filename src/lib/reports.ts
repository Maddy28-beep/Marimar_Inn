import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { amenityOnlyLabel, bookingExtras } from "@/lib/booking-extras";
import { referenceNumberFor } from "@/lib/receipt-printer";
import { paymentBreakdown, type PaymentPortions } from "@/lib/bookings";
import type { Booking, PaymentMethod, Room, RoomType, ShiftExpense, StoreSale, Transaction } from "@/lib/types";

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
 * A voided booking with no store items drops out of the Daily Sales Report
 * table entirely (see computeDailySalesReport's row filter below).
 */
function isVoidedWithNoItems(booking: Booking): boolean {
  return booking.status === "voided" && (booking.totalFbCharge ?? 0) <= 0;
}

/**
 * voidBooking() zeroes out room revenue but never reverses the payment
 * already collected — items/amenities still count (see
 * computeDailySalesReport's isVoided branch), so a voided booking's row
 * (or its total absence, if it had no items) only ever explains the
 * item/amenity portion of amountPaid. This is the leftover room-charge
 * portion that's real cash in the drawer but has nothing on screen
 * accounting for it — split across cash/gcash/qrph the same way the
 * booking's own running total already is, so computeShiftCollectedTotals
 * can subtract exactly that, no more and no less. (A payment collected
 * together at check-in for both room and items is one lump sum in the
 * transaction log — there's no per-method "room vs item" split to read
 * off directly, hence deriving it from the booking's own totals instead.)
 */
function voidedRoomPortionCollected(booking: Booking): PaymentPortions {
  if (booking.status !== "voided" || !booking.amountPaid) {
    return { cash: 0, gcash: 0, qrph: 0 };
  }
  const reportedPaid = booking.totalFbCharge ?? 0; // matches the row's totalPaid for a voided booking
  const excludeAmount = Math.max(0, booking.amountPaid - reportedPaid);
  if (excludeAmount <= 0) return { cash: 0, gcash: 0, qrph: 0 };
  const fraction = excludeAmount / booking.amountPaid;
  const portions = paymentBreakdown(booking);
  return {
    cash: portions.cash * fraction,
    gcash: portions.gcash * fraction,
    qrph: portions.qrph * fraction,
  };
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

function tallyItems(records: { items?: { itemId: string; name: string; quantity: number; subtotal: number }[] }[]): Map<string, ItemTally> {
  const map = new Map<string, ItemTally>();
  for (const record of records) {
    for (const item of record.items ?? []) {
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

export function computeDailyReport(
  checkedInToday: Booking[],
  checkOutsToday: number,
  storeSales: StoreSale[] = []
): DailyReport {
  checkedInToday = checkedInToday.filter((b) => b.status !== "voided");

  const roomRevenue = checkedInToday.reduce((sum, b) => sum + (b.totalRoomCharge ?? 0), 0);
  const fbRevenue =
    checkedInToday.reduce((sum, b) => sum + (b.totalFbCharge ?? 0), 0) +
    storeSales.reduce((sum, sale) => sum + (sale.totalAmount ?? 0), 0);
  const mostOrderedItems = Array.from(tallyItems([...checkedInToday, ...storeSales]).values())
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
  extrasLabel: string;
  extrasAmount: number;
  amenityAmount: number;
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
  cashierName?: string;
  remarks?: string;
}

export interface DailySalesTotals {
  packageAmount: number;
  extensionAmount: number;
  extrasAmount: number;
  amenityAmount: number;
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
export function computeDailySalesReport(
  bookings: Booking[],
  storeSales: StoreSale[] = []
): DailySalesReport {
  const rows: DailySalesRow[] = bookings
    // Voiding only cancels the room — items/products bought are never
    // reversed (see voidBooking()), so a voided booking that had items on
    // it still needs to show up here (room revenue excluded below, see
    // isVoided). Drop voided bookings that never had any items — nothing
    // left to report once the room itself doesn't count.
    .filter((b) => !isVoidedWithNoItems(b))
    .sort((a, b) => b.checkInTime.toMillis() - a.checkInTime.toMillis())
    .map((booking) => {
      const isVoided = booking.status === "voided";
      const extras = bookingExtras(booking);
      const packageHours = booking.originalPackageHours ?? booking.hoursBooked;
      // Voiding cancels the room only — the room charge (package, extension,
      // extra-person fee) never happened as far as the report is concerned.
      // Items/products bought (cart items, towels, blankets) are never
      // reversed by voidBooking(), so they still count as real revenue.
      const packageAmount = isVoided ? 0 : (booking.originalPackagePrice ?? booking.totalRoomCharge ?? 0);
      const totalRoomAmount = isVoided ? 0 : (booking.totalRoomCharge ?? 0);
      const leftoverRoom = Math.max(0, totalRoomAmount - packageAmount);
      const extensionHours = isVoided ? 0 : Math.max(0, (booking.hoursBooked ?? packageHours) - packageHours);
      const totalStoreAmount = Math.max(0, (booking.totalFbCharge ?? 0) - extras.amenityAmount);
      // Extra person is billed on the room, not as stay hours. Without this
      // split it lands in "Ext amt" with a blank Ext hrs column.
      let extrasAmount = isVoided ? extras.amenityAmount : extras.extrasAmount;
      let extrasLabel = isVoided ? amenityOnlyLabel(extras) : extras.extrasLabel;
      let extensionAmount = isVoided ? 0 : Math.max(0, leftoverRoom - extras.extraPersonAmount);
      if (!isVoided && extras.extraPersonAmount === 0 && extensionHours === 0 && leftoverRoom > 0) {
        extrasAmount += leftoverRoom;
        extrasLabel = extrasLabel || "Extra/Request";
        extensionAmount = 0;
      }
      // What's still owed for a voided booking is only the items/amenities
      // — the room portion of amountPaid isn't tracked separately, so this
      // is what "recorded revenue" means once the room itself is voided.
      const totalPaid = isVoided ? totalStoreAmount + extras.amenityAmount : booking.amountPaid ?? 0;
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
        extensionHours,
        extensionAmount,
        extrasLabel,
        extrasAmount,
        amenityAmount: extras.amenityAmount,
        actualCheckOutTime: booking.checkOutTime ? booking.checkOutTime.toDate() : null,
        totalRoomAmount,
        totalStoreAmount,
        totalPaid,
        paymentMethod: booking.paymentMethod,
        gcashReference: booking.gcashReference,
        qrphReference: booking.qrphReference,
        // Voided rows fall back to the single-method totalPaid above
        // instead of the booking's running split totals, which still
        // include the (now-excluded) room portion.
        splitCashAmount: isVoided ? undefined : booking.splitCashAmount,
        splitGcashAmount: isVoided ? undefined : booking.splitGcashAmount,
        splitQrphAmount: isVoided ? undefined : booking.splitQrphAmount,
        cashierName: booking.cashierName,
        remarks: isVoided ? "Voided (room only)" : undefined,
      };
    });

  for (const sale of storeSales) {
    const when = sale.soldAt?.toDate?.() ?? new Date();
    rows.push({
      bookingId: sale.saleId,
      roomNumber: "Store",
      refNumber: referenceNumberFor(sale.saleId),
      guestName: sale.guestName || "Walk-in",
      packageHours: 0,
      checkInTime: when,
      scheduledCheckOutTime: when,
      packageAmount: 0,
      extensionHours: 0,
      extensionAmount: 0,
      extrasLabel: "",
      extrasAmount: 0,
      amenityAmount: 0,
      actualCheckOutTime: when,
      totalRoomAmount: 0,
      totalStoreAmount: sale.totalAmount ?? 0,
      totalPaid: sale.amountPaid ?? 0,
      paymentMethod: sale.paymentMethod,
      gcashReference: sale.gcashReference,
      qrphReference: sale.qrphReference,
      splitCashAmount: sale.splitCashAmount,
      splitGcashAmount: sale.splitGcashAmount,
      splitQrphAmount: sale.splitQrphAmount,
      cashierName: sale.cashierName,
    });
  }

  // Latest check-in first — so the most recent transaction is visible
  // without scrolling, matching the order staff actually want to review in.
  rows.sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime());

  const totals = rows.reduce<DailySalesTotals>(
    (acc, row) => {
      acc.packageAmount += row.packageAmount;
      acc.extensionAmount += row.extensionAmount;
      acc.extrasAmount += row.extrasAmount;
      acc.amenityAmount += row.amenityAmount;
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
      extrasAmount: 0,
      amenityAmount: 0,
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

export interface ShiftCollectedTotals {
  cashCollected: number;
  gcashCollected: number;
  qrphCollected: number;
  totalCollected: number;
}

/**
 * How much cash/GCash/QRPh was actually collected during a shift's time
 * window — distinct from DailySalesTotals.totalPaid, which sums each row's
 * full running total attributed to whichever shift the booking *started*
 * in. A booking that checks in during the day shift but gets extended
 * during the night shift collects real cash from whichever cashier is on
 * duty at that later moment; that cash belongs in the night shift's
 * reconciliation, not the day shift's, even though the booking's own row
 * still (correctly) shows under the day shift it started in. Transactions
 * already carry the timestamp of when money actually changed hands, so
 * this only needs the ones already fetched for the shift's range — no
 * cross-shift bleed the way summing bookings by checkInTime would cause.
 * Store sales are single-event (no extend/checkout to split across a
 * shift boundary), so their own soldAt-based fetch already attributes them
 * correctly — they're included here via the same paymentBreakdown() used
 * for a booking's own split.
 *
 * `bookings` is whatever was fetched for this same shift by checkInTime
 * (i.e. computeDailySalesReport's input) — used only to subtract the
 * unreported room-charge portion of any voided booking's collected
 * payment (see voidedRoomPortionCollected).
 */
export function computeShiftCollectedTotals(
  transactions: Transaction[],
  storeSales: StoreSale[],
  bookings: Booking[] = []
): ShiftCollectedTotals {
  let cashCollected = 0;
  let gcashCollected = 0;
  let qrphCollected = 0;

  for (const t of transactions) {
    cashCollected += t.cashAmount;
    gcashCollected += t.gcashAmount;
    qrphCollected += t.qrphAmount;
  }
  for (const sale of storeSales) {
    const portions = paymentBreakdown(sale);
    cashCollected += portions.cash;
    gcashCollected += portions.gcash;
    qrphCollected += portions.qrph;
  }
  for (const booking of bookings) {
    const excluded = voidedRoomPortionCollected(booking);
    cashCollected -= excluded.cash;
    gcashCollected -= excluded.gcash;
    qrphCollected -= excluded.qrph;
  }

  return {
    cashCollected,
    gcashCollected,
    qrphCollected,
    totalCollected: cashCollected + gcashCollected + qrphCollected,
  };
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
  expenses: ShiftExpense[],
  storeSales: StoreSale[] = []
): RangeDayPoint[] {
  // Same reasoning as computeDailySalesReport: voiding cancels the room
  // only — items/products bought are never reversed, so a voided booking
  // that had items still needs to count (room revenue excluded below).
  bookings = bookings.filter((b) => b.status !== "voided" || (b.totalFbCharge ?? 0) > 0);

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
    const room = booking.status === "voided" ? 0 : booking.totalRoomCharge ?? 0;
    const store = booking.totalFbCharge ?? 0;
    point.checkIns += 1;
    point.roomRevenue += room;
    point.storeRevenue += store;
    point.sales += room + store;
  }

  for (const sale of storeSales) {
    const when = sale.soldAt?.toDate?.();
    if (!when) continue;
    const point = map.get(dateKey(when));
    if (!point) continue;
    const amount = sale.totalAmount ?? 0;
    point.storeRevenue += amount;
    point.sales += amount;
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
  monthDate: Date,
  storeSales: StoreSale[] = []
): MonthlyReport {
  // Same reasoning as computeDailySalesReport: voiding cancels the room
  // only — items/products bought are never reversed, so a voided booking
  // that had items still needs to count (room revenue excluded below).
  bookings = bookings.filter((b) => b.status !== "voided" || (b.totalFbCharge ?? 0) > 0);

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
    // A voided booking's room charge and hours don't count — the room
    // itself was cancelled — but its items/products still do.
    const isVoided = booking.status === "voided";
    const bookingRoomCharge = isVoided ? 0 : booking.totalRoomCharge ?? 0;
    const bookingFbCharge = booking.totalFbCharge ?? 0;
    roomRevenue += bookingRoomCharge;
    fbRevenue += bookingFbCharge;
    totalHoursBooked += isVoided ? 0 : booking.hoursBooked ?? 0;

    const point = dailyMap.get(dateKey(booking.checkInTime.toDate()));
    if (point) {
      point.roomRevenue += bookingRoomCharge;
      point.fbRevenue += bookingFbCharge;
      // Recomputed from the (possibly-zeroed) room + item charges above,
      // not booking.totalAmount — that field still includes the room
      // charge for a voided booking since voidBooking() never touches it.
      point.total += bookingRoomCharge + bookingFbCharge;
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

  for (const sale of storeSales) {
    const amount = sale.totalAmount ?? 0;
    fbRevenue += amount;
    const when = sale.soldAt?.toDate?.();
    if (!when) continue;
    const point = dailyMap.get(dateKey(when));
    if (point) {
      point.fbRevenue += amount;
      point.total += amount;
    }
  }

  const totalRoomHoursAvailable = rooms.length * numDays * 24;
  const occupancyPercent =
    totalRoomHoursAvailable > 0 ? (totalHoursBooked / totalRoomHoursAvailable) * 100 : 0;

  const items = Array.from(tallyItems([...bookings, ...storeSales]).values());

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
