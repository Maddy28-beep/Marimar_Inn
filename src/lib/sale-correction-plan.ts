import type { Booking, BookingSaleSnapshot, PaymentMethod, Transaction } from "@/lib/types";
import { bookingExtras, isAmenityItem } from "@/lib/booking-extras";
import { paymentBreakdown, type PaymentPortions } from "@/lib/bookings";

const METHODS = ["cash", "gcash", "qrph"] as const;
const PAYMENT_TYPES = new Set(["checkin", "extend", "checkout", "order", "payment"]);
export const roundMoney = (value: number) => Math.round(value * 100) / 100;
const total = (split: PaymentPortions) => roundMoney(split.cash + split.gcash + split.qrph);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

export interface SaleCorrectionInput {
  action: "extension" | "room" | "products" | "duplicate";
  productIndexes?: number[];
  extensionHours: number;
  extensionAmount: number;
  removePayment: PaymentPortions;
  reason: string;
  // Optimistic lock against another owner correcting the same record.
  expectedUpdatedAt: number;
  expectedCorrectionCount: number;
  restoreStock?: boolean;
}

export function canCorrectSale(role: string | null | undefined) {
  return role === "owner" || role === "admin" || role === "superadmin";
}

export function extensionDetails(booking: Booking) {
  if (booking.status === "voided") return null;
  if (booking.originalPackageHours === undefined || booking.originalPackagePrice === undefined) return null;
  return {
    hours: Math.max(0, booking.hoursBooked - booking.originalPackageHours),
    amount: roundMoney(Math.max(0, booking.totalRoomCharge - booking.originalPackagePrice - bookingExtras(booking).extraPersonAmount)),
  };
}

/** Current payment events, including earlier method changes and sale corrections. */
export function effectivePaymentEvents(transactions: Transaction[]) {
  return transactions.filter(t => PAYMENT_TYPES.has(t.type) && t.amount > 0).map(t => {
    const split: PaymentPortions = { cash: t.cashAmount ?? 0, gcash: t.gcashAmount ?? 0, qrph: t.qrphAmount ?? 0 };
    for (const adjustment of transactions) {
      if ((adjustment.type === "method_change" || adjustment.type === "sale_correction") && adjustment.correctsTransactionId === t.transactionId) {
        split.cash += adjustment.cashAmount ?? 0;
        split.gcash += adjustment.gcashAmount ?? 0;
        split.qrph += adjustment.qrphAmount ?? 0;
      }
    }
    METHODS.forEach(method => { split[method] = roundMoney(split[method]); });
    return { transactionId: t.transactionId, type: t.type, timestamp: t.timestamp, split, amount: total(split) };
  }).sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());
}

/** Suggest only identifiable extension payments; never guess a split from the whole stay. */
export function suggestExtensionRemoval(booking: Booking, transactions: Transaction[], reduction: number): PaymentPortions | null {
  if (!Number.isFinite(reduction) || reduction < 0) return null;
  const extensionPayments = effectivePaymentEvents(transactions).filter(event => event.type === "extend");
  const split = extensionPayments.reduce<PaymentPortions>((sum, event) => {
    METHODS.forEach(method => { sum[method] = roundMoney(sum[method] + event.split[method]); });
    return sum;
  }, { cash: 0, gcash: 0, qrph: 0 });
  const amount = total(split);
  if (near(amount, reduction)) return split;
  if (amount < reduction) {
    // A later checkout may include extension money. Ask for details if the
    // identifiable extension payments don't explain the recorded overpayment.
    const excess = roundMoney(Math.max(0, booking.amountPaid - (booking.totalAmount - reduction)));
    return excess <= amount + 0.004 ? split : null;
  }
  const used = METHODS.filter(method => split[method] > 0);
  if (used.length !== 1) return null;
  return { cash: 0, gcash: 0, qrph: 0, [used[0]]: reduction };
}

/** A void means the selected charge was not paid; reverse only identifiable records. */
export function suggestVoidPaymentRemoval(booking: Booking, transactions: Transaction[], action: SaleCorrectionInput["action"], reduction: number): PaymentPortions | null {
  if (!Number.isFinite(reduction) || reduction < 0) return null;
  if (action === "extension") return suggestExtensionRemoval(booking, transactions, reduction);
  const split = paymentBreakdown(booking);
  if (action === "duplicate") return split;
  if (booking.amountPaid === 0) return { cash: 0, gcash: 0, qrph: 0 };
  const methods = METHODS.filter(method => split[method] > 0);
  if (near(booking.amountPaid, booking.totalAmount) && methods.length === 1 && reduction <= booking.amountPaid) {
    return { cash: 0, gcash: 0, qrph: 0, [methods[0]]: roundMoney(reduction) };
  }
  return null;
}

export function saleSnapshot(booking: Booking): BookingSaleSnapshot {
  const split = paymentBreakdown(booking);
  return {
    status: booking.status, hoursBooked: booking.hoursBooked,
    totalRoomCharge: booking.status === "voided" ? 0 : booking.totalRoomCharge, totalFbCharge: booking.totalFbCharge,
    totalAmount: booking.status === "voided" ? booking.totalFbCharge : booking.totalAmount, amountPaid: booking.amountPaid,
    ...split, items: booking.items ?? [],
  };
}

export function planSaleCorrection(booking: Booking, transactions: Transaction[], input: SaleCorrectionInput) {
  if (booking.status !== "checked_out" && booking.status !== "voided") throw new Error("Use the front-desk controls for an active booking. This action corrects completed sales.");
  if (booking.voidReason === "duplicate") throw new Error("This booking has already been removed as a duplicate.");
  if (input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("Enter a correction reason (5–500 characters).");
  if (booking.updatedAt.toMillis() !== input.expectedUpdatedAt) throw new Error("This booking changed. Close this dialog and reopen it before correcting it.");
  if ((booking.saleCorrectionCount ?? 0) !== input.expectedCorrectionCount) throw new Error("Another correction was already saved. Close this dialog and reopen it.");
  const before = saleSnapshot(booking);
  const after = { ...before };
  let remove = { ...input.removePayment };
  if (input.action === "duplicate") {
    remove = { cash: before.cash, gcash: before.gcash, qrph: before.qrph };
    Object.assign(after, { status: "voided", totalRoomCharge: 0, totalFbCharge: 0, totalAmount: 0, amountPaid: 0, cash: 0, gcash: 0, qrph: 0, items: [] });
  } else if (input.action === "room" || input.action === "products") {
    let reduction = 0;
    if (input.action === "room") {
      if (booking.status === "voided" || before.totalRoomCharge <= 0) throw new Error("This room booking is already voided or has no room charge.");
      reduction = before.totalRoomCharge;
      after.status = "voided";
      after.totalRoomCharge = 0;
    } else {
      const indexes = input.productIndexes ?? [];
      if (!indexes.length || new Set(indexes).size !== indexes.length || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= before.items.length || isAmenityItem(before.items[index]))) throw new Error("Choose the store products to void.");
      reduction = roundMoney(indexes.reduce((sum, index) => sum + before.items[index].subtotal, 0));
      if (reduction <= 0 || reduction > before.totalFbCharge + 0.004) throw new Error("These products do not match the recorded store charge.");
      after.items = before.items.filter((_, index) => !indexes.includes(index));
      after.totalFbCharge = roundMoney(before.totalFbCharge - reduction);
    }
    if (total(remove) > reduction + 0.004) throw new Error("The removed payment cannot exceed the charge being voided.");
    after.totalAmount = roundMoney(after.totalRoomCharge + after.totalFbCharge);
    METHODS.forEach(method => { after[method] = roundMoney(before[method] - remove[method]); });
    after.amountPaid = roundMoney(before.amountPaid - total(remove));
  } else if (input.action === "extension") {
    if (booking.status === "voided" || booking.openEnded) throw new Error("Only a completed fixed-package stay can have its extension corrected.");
    const extension = extensionDetails(booking);
    if (!extension) throw new Error("This older booking has no original package snapshot; its extension cannot be safely separated.");
    if (!Number.isFinite(input.extensionHours) || input.extensionHours < 0 || input.extensionHours > extension.hours) throw new Error("Corrected extension hours must be between zero and the currently recorded hours.");
    if (!Number.isFinite(input.extensionAmount) || input.extensionAmount < 0 || input.extensionAmount > extension.amount || !near(input.extensionAmount, roundMoney(input.extensionAmount))) throw new Error("Enter a valid corrected extension charge, no higher than the current charge.");
    if (input.extensionHours === 0 && input.extensionAmount !== 0) throw new Error("An extension with zero hours must have a zero charge.");
    const reduction = roundMoney(extension.amount - input.extensionAmount);
    if (near(reduction, 0) && near(input.extensionHours, extension.hours)) throw new Error("Nothing has changed.");
    if (total(remove) > reduction + 0.004) throw new Error("The removed payment cannot exceed the removed extension charge.");
    after.hoursBooked = booking.originalPackageHours! + input.extensionHours;
    after.totalRoomCharge = roundMoney(before.totalRoomCharge - reduction);
    after.totalAmount = roundMoney(after.totalRoomCharge + before.totalFbCharge);
    METHODS.forEach(method => { after[method] = roundMoney(before[method] - remove[method]); });
    after.amountPaid = roundMoney(before.amountPaid - total(remove));
  } else throw new Error("Choose what to void.");
  for (const method of METHODS) {
    if (!Number.isFinite(remove[method]) || remove[method] < 0 || !near(remove[method], roundMoney(remove[method])) || remove[method] > before[method] + 0.004) {
      throw new Error(`The removed ${method} amount must be nonnegative and no higher than what was recorded.`);
    }
  }

  const events = effectivePaymentEvents(transactions);
  const recorded = events.reduce<PaymentPortions>((sum, event) => {
    METHODS.forEach(method => { sum[method] = roundMoney(sum[method] + event.split[method]); });
    return sum;
  }, { cash: 0, gcash: 0, qrph: 0 });
  if (events.some(event => METHODS.some(method => event.split[method] < -0.004)) || METHODS.some(method => !near(recorded[method], before[method])) || !near(total(recorded), before.amountPaid)) {
    throw new Error("The payment history does not match this booking's paid totals. No changes were saved; reconcile the payment history first.");
  }

  // Prefer extension payments, then later collections. The preview shows the
  // exact original dates and methods to be removed before the owner confirms.
  const preferred = (type: string) => input.action === "products" ? type === "order" : input.action === "room" ? type === "checkin" || type === "extend" : type === "extend";
  const ordered = [...events].sort((a, b) => Number(preferred(b.type)) - Number(preferred(a.type)) || b.timestamp.toMillis() - a.timestamp.toMillis());
  const remaining = { ...remove };
  const removedPayments = ordered.flatMap(event => {
    const split = { cash: 0, gcash: 0, qrph: 0 };
    METHODS.forEach(method => {
      split[method] = roundMoney(Math.min(remaining[method], Math.max(0, event.split[method])));
      remaining[method] = roundMoney(remaining[method] - split[method]);
    });
    return total(split) > 0 ? [{ transactionId: event.transactionId, timestamp: event.timestamp, ...split }] : [];
  });
  if (total(remaining) > 0.004) throw new Error("The removed amount could not be matched to recorded payments.");
  const used = METHODS.filter(method => after[method] > 0.004);
  const paymentMethod: PaymentMethod = used.length > 1 ? "split" : (used[0] ?? "cash");
  return {
    before, after, removedPayments,
    updates: {
      hoursBooked: after.hoursBooked, totalRoomCharge: after.totalRoomCharge,
      totalFbCharge: after.totalFbCharge, totalAmount: after.totalAmount,
      amountPaid: after.amountPaid, splitCashAmount: after.cash,
      splitGcashAmount: after.gcash, splitQrphAmount: after.qrph,
      paymentMethod, paymentStatus: after.amountPaid >= after.totalAmount ? "paid" : after.amountPaid > 0 ? "partial" : "unpaid",
      ...(input.action === "products" ? { items: after.items } : {}),
      ...(input.action === "room" ? { status: "voided", voidReason: "room_only", extraPersonCount: 0 } : {}),
      ...(input.action === "room" || (input.action === "products" && booking.status === "voided") ? {
        voidKeptCash: Math.max(0, (input.action === "room" || booking.voidReason === "room_only" ? before.cash : booking.voidKeptCash ?? before.cash) - remove.cash),
        voidKeptGcash: Math.max(0, (input.action === "room" || booking.voidReason === "room_only" ? before.gcash : booking.voidKeptGcash ?? before.gcash) - remove.gcash),
        voidKeptQrph: Math.max(0, (input.action === "room" || booking.voidReason === "room_only" ? before.qrph : booking.voidKeptQrph ?? before.qrph) - remove.qrph),
      } : {}),
      ...(input.action === "duplicate" ? { status: "voided", voidReason: "duplicate", reversedAmount: before.amountPaid, items: [], extraPersonCount: 0, towelCount: 0, blanketCount: 0, voidKeptCash: 0, voidKeptGcash: 0, voidKeptQrph: 0 } : {}),
    },
  };
}
