"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { useAuth } from "@/context/auth-context";
import { subscribeToRooms } from "@/lib/rooms";
import { subscribeToInventory } from "@/lib/inventory";
import {
  computeDailyReport,
  computeDailySalesReport,
  computeMonthlyReport,
  computeOverdueHistory,
  computeRangeDailySeries,
  computeShiftCollectedTotals,
  endOfDay,
  endOfMonth,
  fetchActiveBookings,
  fetchBookingsInRange,
  startOfDay,
  startOfMonth,
  type DailyReport,
  type DailySalesReport,
  type MonthlyReport,
  type OverdueRecord,
  type RangeDayPoint,
  type ShiftCollectedTotals,
} from "@/lib/reports";
import { fetchStoreSalesInRange } from "@/lib/store-sales";
import { fetchTransactionsInRange } from "@/lib/transactions";
import { DailySalesTable } from "@/components/reports/daily-sales-table";
import { AddExpenseForm } from "@/components/expenses/add-expense-form";
import { OpenDrawerForm } from "@/components/cash-drawer-open";
import { exportToExcel, formatReportDate, formatReportMonth } from "@/lib/export";
import { isOwnerLikeRole } from "@/lib/roles";
import {
  deleteShiftExpense,
  fetchExpensesInRange,
  shiftLabelForTime,
  totalExpenses,
} from "@/lib/expenses";
import {
  PAYMENT_METHOD_LABELS,
  ROOM_TYPE_LABELS,
  type Booking,
  type InventoryItem,
  type Room,
  type ShiftExpense,
  type Transaction,
} from "@/lib/types";
import { formatHours } from "@/lib/time";
import { useNowTick } from "@/hooks/use-now-tick";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { ReceiptPreviewDialog } from "@/components/receipt-preview";
import { printDailySalesReceipt, previewDailySalesReceipt, printerErrorMessage, type DailySalesReceiptData } from "@/lib/receipt-printer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RevenueChart, SalesExpensesChart } from "@/components/reports/revenue-chart";
import { CalendarRangeIcon, DownloadIcon, EyeIcon, PrinterIcon } from "lucide-react";

function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function thisMonthInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function firstOfMonthInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type ShiftFilter = "fullDay" | "day" | "night";

const SHIFT_LABELS: Record<ShiftFilter, string> = {
  fullDay: "Full day",
  day: "Day shift (7 AM–7 PM)",
  night: "Night shift (7 PM–7 AM)",
};

// Duty time is locked to the shift's official start — not editable — so a
// cashier can't write in an earlier or later time than they actually clocked
// in for. "Full day" isn't a real shift, so it has no fixed start.
const SHIFT_START_TIME: Record<ShiftFilter, string> = {
  fullDay: "",
  day: "07:00",
  night: "19:00",
};

/**
 * Cashiers work two 12h shifts that don't line up with midnight: day is
 * 7am-7pm, night is 7pm-7am and crosses into the next calendar date. The
 * boundary is a half-open interval — a payment at 6:59:59am belongs to the
 * night shift that's still running, one at exactly 7:00:00am belongs to the
 * day shift that just started — so shifts never overlap or leave a gap.
 * `dateValue` is always the calendar date the shift *starts* on.
 */
function shiftRange(dateValue: string, shift: ShiftFilter): [Date, Date] {
  const [y, m, d] = dateValue.split("-").map(Number);
  if (shift === "day") {
    return [new Date(y, m - 1, d, 7, 0, 0, 0), new Date(y, m - 1, d, 18, 59, 59, 999)];
  }
  if (shift === "night") {
    return [new Date(y, m - 1, d, 19, 0, 0, 0), new Date(y, m - 1, d + 1, 6, 59, 59, 999)];
  }
  // "Full day" means the day shift plus the night shift that follows it —
  // 7am through 7am the next morning — not calendar midnight-to-midnight.
  // Those don't line up: a plain calendar-day range would cut off the
  // night shift's post-midnight hours (its whole reason for crossing into
  // the next date), silently dropping anything checked in between
  // midnight and 7am from the "full day" total even though the day+night
  // shift reports themselves both include it correctly.
  return [new Date(y, m - 1, d, 7, 0, 0, 0), new Date(y, m - 1, d + 1, 6, 59, 59, 999)];
}

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const TRANSACTION_TYPE_LABELS: Record<Transaction["type"], string> = {
  checkin: "Check-in",
  extend: "Extend",
  checkout: "Checkout",
};

// <input type="time"> gives 24h "HH:MM" — display it the way staff write it
// on the paper form ("7:00 AM").
function formatDutyTime(value: string): string {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function shiftTimeLabel(shift: ShiftFilter): string {
  if (shift === "fullDay") return "FULL DAY";
  return formatDutyTime(SHIFT_START_TIME[shift]);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function DailyReportTab({ rooms }: { rooms: Room[] | null }) {
  const printer = useReceiptPrinter();
  const { appUser } = useAuth();
  const [dateValue, setDateValue] = useState(todayInputValue());
  const [shift, setShift] = useState<ShiftFilter>("fullDay");
  const [report, setReport] = useState<DailyReport | null>(null);
  const [salesReport, setSalesReport] = useState<DailySalesReport | null>(null);
  const [collected, setCollected] = useState<ShiftCollectedTotals | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<ShiftExpense[]>([]);
  const [frontDesk, setFrontDesk] = useState("");
  const [housekeeping, setHousekeeping] = useState("");
  const [loading, setLoading] = useState(true);
  const [thermalPreviewOpen, setThermalPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [start, end] = shiftRange(dateValue, shift);
      try {
        const [checkedIn, checkedOut, shiftExpenses, storeSales, transactions] = await Promise.all([
          fetchBookingsInRange("checkInTime", start, end),
          fetchBookingsInRange("checkOutTime", start, end),
          fetchExpensesInRange(start, end),
          fetchStoreSalesInRange(start, end),
          fetchTransactionsInRange(start, end),
        ]);
        if (!cancelled) {
          const salesData = computeDailySalesReport(checkedIn, storeSales);
          setReport(computeDailyReport(checkedIn, checkedOut.length, storeSales));
          setSalesReport(salesData);
          // The transaction log only started recording once this feature
          // shipped — a date/shift from before that has real bookings but
          // zero logged transactions. Fall back to the old (check-in-shift)
          // approximation for those instead of wrongly showing ₱0 collected.
          const isPreTransactionLogPeriod = transactions.length === 0 && checkedIn.length > 0;
          setCollected(
            isPreTransactionLogPeriod
              ? {
                  cashCollected: salesData.totals.cashCollected,
                  gcashCollected: salesData.totals.gcashCollected,
                  qrphCollected: salesData.totals.qrphCollected,
                  totalCollected: salesData.totals.totalPaid,
                }
              : computeShiftCollectedTotals(transactions, storeSales)
          );
          setTransactions(
            [...transactions].sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis())
          );
          setExpenses(shiftExpenses);
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load the daily report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [dateValue, shift]);

  const occupied = rooms?.filter((r) => r.status === "occupied").length ?? 0;
  const totalRooms = rooms?.length ?? 0;
  const reportDate = formatReportDate(dateValue);
  const reportLabel =
    shift === "fullDay" ? `${reportDate} — FULL DAY` : `${reportDate} — ${SHIFT_LABELS[shift]}`;
  const reportTitle = shift === "fullDay" ? "Daily Sales Report — FULL DAY" : "Daily Sales Report";
  const timeLabel = shiftTimeLabel(shift);
  const expenseTotal = totalExpenses(expenses);
  // "Overall Sale" is the shift's headline total, shown in the same
  // Payment breakdown panel as Cash/GCash/QRPh/Total collected — it needs
  // to be on that same transaction-collected basis (not the row-level
  // revenue sum, which only counts bookings that *started* this shift) or
  // it silently contradicts "Total collected" sitting right above it, the
  // way it did when Room 9's extension money showed in Total collected but
  // not in Overall Sale.
  const overallSale = collected?.totalCollected ?? 0;
  const netCash = (collected?.cashCollected ?? 0) - expenseTotal;
  const netCollected = (collected?.totalCollected ?? 0) - expenseTotal;
  const netSales = overallSale - expenseTotal;
  const isOwnerLike = isOwnerLikeRole(appUser?.role);

  async function handleExport() {
    if (!report) return;
    // The sheet's subtitle already carries the date, so cells only need the
    // time — the full toLocaleString() (date + time + seconds) is too long
    // for a readable column width and gets visually clipped by Excel/Sheets.
    const time = (d: Date | null) =>
      d ? d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "";
    const filenameSuffix = shift === "fullDay" ? dateValue : `${dateValue}-${shift}`;
    await exportToExcel(`marimar-inn-daily-${filenameSuffix}`, [
      {
        name: "Daily Sales Report",
        title: reportTitle,
        subtitle: reportLabel,
        dutyInfo: `Front desk: ${frontDesk.trim() || "____________________________"}        Housekeeping: ${
          housekeeping.trim() || "____________________________"
        }        Time: ${timeLabel}`,
        tables: [
          {
            columns: [
              { header: "Room", key: "room", width: 6, bold: true },
              { header: "Ref #", key: "ref", width: 10 },
              { header: "Hrs", key: "hrs", width: 5, format: "integer" },
              { header: "Check-in", key: "checkIn", width: 10 },
              { header: "Checkout", key: "schedOut", width: 10 },
              { header: "Amount", key: "amount", width: 12, format: "currency" },
              { header: "Ext hrs", key: "extHrs", width: 9, format: "integer" },
              { header: "Ext amt", key: "extAmt", width: 12, format: "currency" },
              { header: "Extra/Request", key: "extra", width: 22 },
              { header: "Extra/Request amt", key: "extraAmt", width: 16, format: "currency" },
              { header: "Actual out", key: "actualOut", width: 10 },
              { header: "Room total", key: "roomTotal", width: 14, format: "currency" },
              { header: "Store total", key: "storeTotal", width: 14, format: "currency" },
              { header: "Paid", key: "paid", width: 12, format: "currency" },
              // Split-payment rows print e.g. "Cash ₱150.00 + GCash ₱170.00
              // (1234 567 890123)" — up to ~52 chars with a full GCash
              // reference, so this needs real room, not the old 22.
              { header: "Payment", key: "payment", width: 55 },
              { header: "Staff", key: "staff", width: 18 },
              { header: "Remarks", key: "remarks", width: 18 },
            ],
            rows: [
              ...(salesReport?.rows ?? []).map((row) => ({
                room: row.roomNumber,
                ref: row.refNumber,
                hrs: row.packageHours,
                checkIn: time(row.checkInTime),
                schedOut: time(row.scheduledCheckOutTime),
                amount: row.packageAmount,
                extHrs: row.extensionHours || "",
                extAmt: row.extensionAmount || "",
                extra: row.extrasLabel,
                extraAmt: row.extrasAmount || "",
                actualOut: time(row.actualCheckOutTime),
                roomTotal: row.totalRoomAmount,
                storeTotal: row.totalStoreAmount,
                paid: row.totalPaid,
                payment: (() => {
                  const cashPortion = row.splitCashAmount ?? 0;
                  const gcashPortion = row.splitGcashAmount ?? 0;
                  const qrphPortion = row.splitQrphAmount ?? 0;
                  const parts: string[] = [];
                  if (cashPortion > 0) parts.push(`Cash ${peso(cashPortion)}`);
                  if (gcashPortion > 0) parts.push(`GCash ${peso(gcashPortion)}`);
                  if (qrphPortion > 0) parts.push(`QRPh ${peso(qrphPortion)}`);
                  const base =
                    parts.length > 1 ? parts.join(" + ") : PAYMENT_METHOD_LABELS[row.paymentMethod];
                  const refs = [
                    row.gcashReference ? `GCash ${row.gcashReference}` : "",
                    row.qrphReference ? `QRPh ${row.qrphReference}` : "",
                  ].filter(Boolean);
                  return refs.length ? `${base} (${refs.join(", ")})` : base;
                })(),
                staff: row.cashierName ?? "",
                remarks: row.remarks ?? "",
              })),
              ...(salesReport && salesReport.rows.length > 0
                ? [
                    {
                      room: "Totals",
                      ref: "",
                      hrs: "",
                      checkIn: "",
                      schedOut: "",
                      amount: salesReport.totals.packageAmount,
                      extHrs: "",
                      extAmt: salesReport.totals.extensionAmount,
                      extra: "",
                      extraAmt: salesReport.totals.extrasAmount,
                      actualOut: "",
                      roomTotal: salesReport.totals.totalRoomAmount,
                      storeTotal: salesReport.totals.totalStoreAmount,
                      paid: salesReport.totals.totalPaid,
                      payment: "",
                      staff: "",
                      remarks: "",
                    },
                  ]
                : []),
            ],
            emphasizeLastRow: (salesReport?.rows.length ?? 0) > 0,
          },
          ...(transactions.length > 0
            ? [
                {
                  heading: "Transactions this shift",
                  startColOverride: 13,
                  columns: [
                    { header: "Time", key: "time", width: 12 },
                    { header: "Room", key: "room", width: 8, bold: true },
                    { header: "Type", key: "type", width: 12 },
                    { header: "Amount", key: "amount", width: 14, format: "currency" as const },
                    { header: "Payment", key: "payment", width: 30 },
                    { header: "Staff", key: "staff", width: 18 },
                  ],
                  rows: transactions.map((t) => {
                    const when = t.timestamp?.toDate?.() ?? null;
                    const parts: string[] = [];
                    if (t.cashAmount > 0) parts.push(`Cash ${peso(t.cashAmount)}`);
                    if (t.gcashAmount > 0) parts.push(`GCash ${peso(t.gcashAmount)}`);
                    if (t.qrphAmount > 0) parts.push(`QRPh ${peso(t.qrphAmount)}`);
                    return {
                      time: when
                        ? when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
                        : "",
                      room: t.roomNumber,
                      type: TRANSACTION_TYPE_LABELS[t.type],
                      amount: t.amount,
                      payment: parts.join(" + "),
                      staff: t.cashierName,
                    };
                  }),
                },
              ]
            : []),
          ...(expenses.length > 0
            ? [
                {
                  heading: "Expenses",
                  // Lands on the main table's already-wide "Store total"
                  // through "Remarks" columns instead of the automatic col1
                  // placement, which would force "Hrs" wide to fit "What for".
                  startColOverride: 13,
                  columns: [
                    { header: "Time", key: "time", width: 12 },
                    { header: "Shift", key: "shift", width: 10 },
                    { header: "What for", key: "description", width: 28 },
                    { header: "Staff", key: "staff", width: 18 },
                    { header: "Amount", key: "amount", width: 14, format: "currency" as const },
                  ],
                  rows: [
                    ...expenses.map((expense) => {
                      const when = expense.recordedAt?.toDate?.() ?? null;
                      return {
                        time: when
                          ? when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
                          : "",
                        shift: when ? shiftLabelForTime(when) : "",
                        description: expense.description,
                        staff: expense.cashierName,
                        amount: expense.amount,
                      };
                    }),
                    {
                      time: "Total",
                      shift: "",
                      description: "",
                      staff: "",
                      amount: expenseTotal,
                    },
                  ],
                  emphasizeLastRow: true,
                },
              ]
            : []),
          ...(salesReport
            ? [
                [
                  {
                    heading: "Payment breakdown",
                    // Same reasoning as Summary/Expenses/Signatures below —
                    // lands on "Extra/Request"/"Extra/Request amt" (already
                    // 22/16 wide) instead of "Room"/"Ref #".
                    startColOverride: 9,
                    columns: [
                      { header: "Metric", key: "metric", width: 24 },
                      { header: "Value", key: "value", width: 22, format: "currency" as const },
                    ],
                    rows: [
                      { metric: "Cash collected", value: collected?.cashCollected ?? 0 },
                      { metric: "Expenses", value: expenseTotal },
                      { metric: "Net cash", value: netCash },
                      { metric: "GCash collected", value: collected?.gcashCollected ?? 0 },
                      { metric: "QRPh collected", value: collected?.qrphCollected ?? 0 },
                      { metric: "Total collected", value: collected?.totalCollected ?? 0 },
                      { metric: "Net after expenses", value: netCollected },
                      { metric: "Overall Sale", value: overallSale },
                      { metric: "Net sales", value: netSales },
                    ],
                    emphasizeLastRow: true,
                  },
                  {
                    heading: "Summary",
                    // Lands on the main table's "Paid"/"Payment" columns
                    // (already 12/55 wide) instead of the automatic
                    // placement, which would land this table's wide Value
                    // column on "Check-in"/"Checkout" and force those wide
                    // too — Excel gives one width per column for the whole
                    // sheet, shared across every table stacked on it.
                    startColOverride: 14,
                    columns: [
                      { header: "Metric", key: "metric", width: 28 },
                      // Wide enough for the longest date label, e.g.
                      // "Saturday, August 15, 2026 — Night shift (7 PM–7 AM)"
                      // (~52 chars) — too narrow a column here visually clips
                      // centered text on both sides instead of just spilling
                      // rightward the way left-aligned overflow would.
                      { header: "Value", key: "value", width: 55, format: "auto" as const },
                    ],
                    rows: [
                      { metric: "Date", value: reportDate },
                      { metric: "Time", value: timeLabel },
                      { metric: "Check-ins", value: report.checkIns },
                      { metric: "Check-outs", value: report.checkOuts },
                      { metric: "Room revenue", value: report.roomRevenue },
                      { metric: "Store items revenue", value: report.fbRevenue },
                      { metric: "Total revenue", value: report.totalRevenue },
                      { metric: "Expenses", value: expenseTotal },
                      { metric: "Net sales", value: report.totalRevenue - expenseTotal },
                    ],
                    emphasizeLastRow: true,
                  },
                ],
                {
                  heading: "Signatures",
                  // Same reasoning as Expenses/Summary above — lands on the
                  // main table's already-wide trailing columns.
                  startColOverride: 13,
                  columns: [
                    { header: "", key: "label", width: 14 },
                    { header: "Prepared by", key: "prepared", width: 24 },
                    { header: "Checked by", key: "checked", width: 24 },
                    { header: "Noted by", key: "noted", width: 24 },
                  ],
                  rows: [
                    { label: "Signature", prepared: "", checked: "", noted: "" },
                    { label: "Printed name", prepared: "", checked: "", noted: "" },
                  ],
                },
              ]
            : []),
        ],
      },
    ]);
  }

  function dailySalesThermalData(): DailySalesReceiptData | null {
    if (!salesReport) return null;
    return {
      // A short format ("Aug 16, 2026") on purpose — the full weekday
      // format used elsewhere can run to 30 characters, right at the edge
      // of 58mm (32-char) paper.
      dateLabel:
        new Date(`${dateValue}T00:00:00`).toLocaleDateString("en-PH", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }) + (shift === "day" ? " (Day)" : shift === "night" ? " (Night)" : ""),
      frontDesk: frontDesk.trim() || undefined,
      housekeeping: housekeeping.trim() || undefined,
      dutyTime: timeLabel,
      rows: salesReport.rows.map((row) => ({
        roomNumber: row.roomNumber,
        refNumber: row.refNumber,
        packageHours: row.packageHours,
        extensionHours: row.extensionHours,
        extensionAmount: row.extensionAmount,
        extrasLabel: row.extrasLabel,
        extrasAmount: row.extrasAmount,
        totalRoomAmount: row.totalRoomAmount,
        totalStoreAmount: row.totalStoreAmount,
        totalPaid: row.totalPaid,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[row.paymentMethod],
        gcashReference: row.gcashReference,
        qrphReference: row.qrphReference,
      })),
      totals: salesReport.totals,
      expenses: expenses.map((expense) => {
        const when = expense.recordedAt?.toDate?.() ?? null;
        return {
          timeLabel: when
            ? when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
            : "",
          shiftLabel: when ? shiftLabelForTime(when) : "",
          description: expense.description,
          cashierName: expense.cashierName,
          amount: expense.amount,
        };
      }),
    };
  }

  async function handlePrintThermal() {
    const data = dailySalesThermalData();
    if (!data || !printer.connected) return;
    try {
      await printDailySalesReceipt(data);
    } catch (error) {
      toast.error(printerErrorMessage(error));
    }
  }

  async function reloadExpenses() {
    const [start, end] = shiftRange(dateValue, shift);
    setExpenses(await fetchExpensesInRange(start, end));
  }

  async function handleRemoveExpense(expenseId: string) {
    try {
      await deleteShiftExpense(expenseId);
      setExpenses((current) => current.filter((expense) => expense.expenseId !== expenseId));
      toast.success("Expense removed.");
    } catch {
      toast.error("Couldn't remove that expense.");
    }
  }

  const thermalPreviewLines = thermalPreviewOpen
    ? (() => {
        const data = dailySalesThermalData();
        return data ? previewDailySalesReceipt(data) : [];
      })()
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:flex xl:w-auto xl:flex-wrap xl:items-center">
          <Input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="w-full min-w-0 xl:w-44"
          />
          <Select value={shift} onValueChange={(v) => setShift(v as ShiftFilter)}>
            <SelectTrigger className="w-full min-w-0 xl:w-48">
              <SelectValue>{SHIFT_LABELS[shift]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fullDay">Full day</SelectItem>
              <SelectItem value="day">Day shift (7 AM–7 PM)</SelectItem>
              <SelectItem value="night">Night shift (7 PM–7 AM)</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Front desk"
            value={frontDesk}
            onChange={(e) => setFrontDesk(e.target.value)}
            className="w-full min-w-0 xl:w-36"
          />
          <Input
            placeholder="Housekeeping"
            value={housekeeping}
            onChange={(e) => setHousekeeping(e.target.value)}
            className="w-full min-w-0 xl:w-36"
          />
          <div
            className={
              shift === "fullDay"
                ? "flex h-9 w-full items-center rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-semibold tracking-wide min-[420px]:col-span-2 xl:w-auto xl:col-span-1"
                : "flex h-9 w-full items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground xl:w-32"
            }
            title={
              shift === "fullDay"
                ? "This report covers the entire calendar day."
                : "Locked to the shift's official start time — not editable, so no early or late clock-ins get written in."
            }
          >
            Time: {timeLabel}
          </div>
        </div>
        <div className="flex w-full flex-col items-stretch gap-1 sm:items-end xl:w-auto">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" className="font-semibold" onClick={handleExport} disabled={!report}>
              <DownloadIcon className="size-4" />
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="font-semibold"
              onClick={() => setThermalPreviewOpen(true)}
              disabled={!salesReport}
            >
              <EyeIcon className="size-4" />
              Preview (thermal)
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="font-semibold"
              onClick={handlePrintThermal}
              disabled={!salesReport || !printer.connected}
              title={!printer.connected ? "Connect a thermal printer first (printer icon, top right)" : undefined}
            >
              <PrinterIcon className="size-4" />
              Print (thermal)
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="font-semibold"
              onClick={() => window.print()}
              disabled={!report}
              title="Choose Landscape in the print dialog for the best fit"
            >
              <PrinterIcon className="size-4" />
              Print / PDF
            </Button>
          </div>
          {!printer.connected && (
            <p className="text-xs text-muted-foreground">
              Connect a thermal printer (printer icon, top right) to enable
            </p>
          )}
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Log expense</CardTitle>
          <CardDescription>
            Cash taken from the drawer. Add several items at once, then save.
            They are deducted from this shift&apos;s cash and net sales.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddExpenseForm onSaved={() => void reloadExpenses()} />
        </CardContent>
      </Card>

      {loading || !report ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="print-area flex flex-col gap-4">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo/icon.png"
              alt=""
              width={160}
              height={146}
              className="mx-auto mb-2 hidden h-14 w-auto object-contain print:block"
            />
            <div className="hidden font-heading text-lg font-semibold print:block">Marimar Inn - Davao</div>
            <div className="text-base font-semibold tracking-wide">{reportTitle}</div>
            <div className="mt-1 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Date: {reportDate}</span>
              <span>Time: {timeLabel}</span>
              {frontDesk && <span>Front desk: {frontDesk}</span>}
              {housekeeping && <span>Housekeeping: {housekeeping}</span>}
            </div>
          </div>

          {salesReport && (
            <DailySalesTable
              report={salesReport}
              collected={collected}
              transactions={transactions}
              expenses={expenses}
              canRemoveExpenses={isOwnerLike}
              onRemoveExpense={handleRemoveExpense}
            />
          )}

          {salesReport && (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>End of shift</CardTitle>
                <CardDescription>
                  Open the cash drawer with the PIN, count the cash against this
                  report, then print or export.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <span className="text-muted-foreground">Cash collected</span>
                    <div className="font-medium">{peso(collected?.cashCollected ?? 0)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expenses</span>
                    <div className="font-medium">{peso(expenseTotal)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Cash to count</span>
                    <div className="text-xl font-semibold">{peso(netCash)}</div>
                  </div>
                </div>
                <OpenDrawerForm />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            <StatCard label="Check-ins" value={String(report.checkIns)} />
            <StatCard label="Check-outs" value={String(report.checkOuts)} />
            <StatCard label="Room revenue" value={peso(report.roomRevenue)} />
            <StatCard label="Store items" value={peso(report.fbRevenue)} />
            <StatCard label="Expenses" value={peso(expenseTotal)} />
            <StatCard label="Net sales" value={peso(report.totalRevenue - expenseTotal)} />
            <StatCard label="Current occupancy" value={`${occupied}/${totalRooms}`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Total revenue</CardTitle>
              <CardDescription>
                {peso(report.totalRevenue)}
                {expenseTotal > 0 ? `  ·  Net ${peso(report.totalRevenue - expenseTotal)} after expenses` : ""}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Most ordered items</CardTitle>
            </CardHeader>
            <CardContent>
              {report.mostOrderedItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders that day.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Item</th>
                      <th className="py-1 font-medium">Qty</th>
                      <th className="py-1 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.mostOrderedItems.map((item) => (
                      <tr key={item.name} className="border-t">
                        <td className="py-1.5">{item.name}</td>
                        <td className="py-1.5">{item.quantity}</td>
                        <td className="py-1.5">{peso(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <ReceiptPreviewDialog
        open={thermalPreviewOpen}
        onOpenChange={setThermalPreviewOpen}
        lines={thermalPreviewLines}
        paperWidth={printer.paperWidth}
        title="Daily sales receipt preview"
        onPrint={printer.connected ? handlePrintThermal : undefined}
      />
    </div>
  );
}

function MonthlyReportTab({ rooms }: { rooms: Room[] | null }) {
  const [monthValue, setMonthValue] = useState(thisMonthInputValue());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rooms) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [year, month] = monthValue.split("-").map(Number);
      const monthDate = new Date(year, month - 1, 1);
      try {
        const [bookings, monthExpenses, storeSales] = await Promise.all([
          fetchBookingsInRange("checkInTime", startOfMonth(monthDate), endOfMonth(monthDate)),
          fetchExpensesInRange(startOfMonth(monthDate), endOfMonth(monthDate)),
          fetchStoreSalesInRange(startOfMonth(monthDate), endOfMonth(monthDate)),
        ]);
        if (!cancelled) {
          setReport(computeMonthlyReport(bookings, rooms ?? [], monthDate, storeSales));
          setExpenseTotal(totalExpenses(monthExpenses));
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load the monthly report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [monthValue, rooms]);

  async function handleExport() {
    if (!report) return;
    await exportToExcel(`marimar-inn-monthly-${monthValue}`, [
      {
        name: "Summary",
        title: "Monthly Report",
        subtitle: formatReportMonth(monthValue),
        tables: [
          {
            heading: "Overview",
            columns: [
              { header: "Metric", key: "metric", width: 28 },
              { header: "Value", key: "value", width: 22, format: "auto" },
            ],
            rows: [
              { metric: "Month", value: formatReportMonth(monthValue) },
              { metric: "Check-ins", value: report.totalCheckIns },
              { metric: "Occupancy", value: report.occupancyPercent },
              { metric: "Room revenue", value: report.roomRevenue },
              { metric: "Store items revenue", value: report.fbRevenue },
              { metric: "Total revenue", value: report.totalRevenue },
              { metric: "Expenses", value: expenseTotal },
              { metric: "Net sales", value: report.totalRevenue - expenseTotal },
            ],
            emphasizeLastRow: true,
          },
        ],
      },
      {
        name: "Daily revenue",
        title: "Daily revenue",
        subtitle: formatReportMonth(monthValue),
        tables: [
          {
            columns: [
              { header: "Date", key: "date", width: 16 },
              { header: "Check-ins", key: "checkIns", width: 14, format: "integer" },
              { header: "Room revenue", key: "roomRevenue", width: 18, format: "currency" },
              { header: "Store items", key: "fbRevenue", width: 18, format: "currency" },
              { header: "Total", key: "total", width: 16, format: "currency" },
            ],
            rows: [
              ...report.dailySeries.map((day) => ({
                date: day.date,
                checkIns: day.checkIns,
                roomRevenue: day.roomRevenue,
                fbRevenue: day.fbRevenue,
                total: day.total,
              })),
              {
                date: "Month total",
                checkIns: report.totalCheckIns,
                roomRevenue: report.roomRevenue,
                fbRevenue: report.fbRevenue,
                total: report.totalRevenue,
              },
            ],
            emphasizeLastRow: true,
          },
        ],
      },
      {
        name: "Room types",
        title: "Revenue by room type",
        subtitle: formatReportMonth(monthValue),
        tables: [
          {
            columns: [
              { header: "Room type", key: "type", width: 18 },
              { header: "Bookings", key: "bookings", width: 14, format: "integer" },
              { header: "Revenue", key: "revenue", width: 18, format: "currency" },
            ],
            rows: report.revenueByRoomType.map((row) => ({
              type: ROOM_TYPE_LABELS[row.type],
              bookings: row.bookings,
              revenue: row.revenue,
            })),
          },
        ],
      },
      {
        name: "Store items",
        title: "Top store items",
        subtitle: formatReportMonth(monthValue),
        tables: [
          {
            columns: [
              { header: "Item", key: "name", width: 28 },
              { header: "Quantity", key: "quantity", width: 14, format: "integer" },
              { header: "Revenue", key: "revenue", width: 18, format: "currency" },
            ],
            rows: report.topItemsByRevenue.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              revenue: item.revenue,
            })),
          },
        ],
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className="w-44"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="font-semibold" onClick={handleExport} disabled={!report}>
            <DownloadIcon className="size-4" />
            Export Excel
          </Button>
          <Button variant="outline" size="lg" className="font-semibold" onClick={() => window.print()} disabled={!report}>
            <PrinterIcon className="size-3.5" />
            Print / PDF
          </Button>
        </div>
      </div>

      {loading || !report ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="print-area flex flex-col gap-4">
          <div className="hidden text-center print:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo/icon.png"
              alt=""
              width={160}
              height={146}
              className="mx-auto mb-2 h-14 w-auto object-contain"
            />
            <div className="font-heading text-lg font-semibold">Marimar Inn</div>
            <div className="text-sm text-muted-foreground">Monthly Report — {monthValue}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total revenue" value={peso(report.totalRevenue)} />
            <StatCard label="Room revenue" value={peso(report.roomRevenue)} />
            <StatCard label="Store items" value={peso(report.fbRevenue)} />
            <StatCard label="Expenses" value={peso(expenseTotal)} />
            <StatCard label="Net sales" value={peso(report.totalRevenue - expenseTotal)} />
            <StatCard label="Occupancy" value={`${report.occupancyPercent.toFixed(1)}%`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue trend</CardTitle>
              <CardDescription>{report.totalCheckIns} check-ins this month</CardDescription>
            </CardHeader>
            <CardContent>
              <RevenueChart data={report.dailySeries} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue by room type</CardTitle>
            </CardHeader>
            <CardContent>
              {report.revenueByRoomType.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Type</th>
                      <th className="py-1 font-medium">Bookings</th>
                      <th className="py-1 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.revenueByRoomType.map((r) => (
                      <tr key={r.type} className="border-t">
                        <td className="py-1.5">{ROOM_TYPE_LABELS[r.type]}</td>
                        <td className="py-1.5">{r.bookings}</td>
                        <td className="py-1.5">{peso(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top store items</CardTitle>
            </CardHeader>
            <CardContent>
              {report.topItemsByRevenue.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Item</th>
                      <th className="py-1 font-medium">Qty</th>
                      <th className="py-1 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItemsByRevenue.map((item) => (
                      <tr key={item.name} className="border-t">
                        <td className="py-1.5">{item.name}</td>
                        <td className="py-1.5">{item.quantity}</td>
                        <td className="py-1.5">{peso(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RangeReportTab() {
  const [fromValue, setFromValue] = useState(firstOfMonthInputValue);
  const [toValue, setToValue] = useState(todayInputValue);
  const [days, setDays] = useState<RangeDayPoint[]>([]);
  const [salesReport, setSalesReport] = useState<DailySalesReport | null>(null);
  const [expenses, setExpenses] = useState<ShiftExpense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const from = fromValue <= toValue ? fromValue : toValue;
      const to = fromValue <= toValue ? toValue : fromValue;
      const start = startOfDay(new Date(`${from}T00:00:00`));
      const end = endOfDay(new Date(`${to}T00:00:00`));
      const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (spanDays > 366) {
        toast.error("Pick a range of 1 year or less.");
        return;
      }
      setLoading(true);
      try {
        const [bookings, rangeExpenses, storeSales] = await Promise.all([
          fetchBookingsInRange("checkInTime", start, end),
          fetchExpensesInRange(start, end),
          fetchStoreSalesInRange(start, end),
        ]);
        if (!cancelled) {
          setDays(computeRangeDailySeries(start, end, bookings, rangeExpenses, storeSales));
          setSalesReport(computeDailySalesReport(bookings, storeSales));
          setExpenses(rangeExpenses);
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load that date range.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fromValue, toValue]);

  const from = fromValue <= toValue ? fromValue : toValue;
  const to = fromValue <= toValue ? toValue : fromValue;
  const rangeLabel = `${formatReportDate(from)} — ${formatReportDate(to)}`;
  const expenseTotal = totalExpenses(expenses);
  const salesTotal = days.reduce((sum, day) => sum + day.sales, 0);
  const roomTotal = days.reduce((sum, day) => sum + day.roomRevenue, 0);
  const storeTotal = days.reduce((sum, day) => sum + day.storeRevenue, 0);
  const checkIns = days.reduce((sum, day) => sum + day.checkIns, 0);
  const netSales = salesTotal - expenseTotal;

  async function handleExport() {
    await exportToExcel(`marimar-inn-range-${from}-to-${to}`, [
      {
        name: "Overview",
        title: "Custom range report",
        subtitle: rangeLabel,
        tables: [
          {
            heading: "Overall",
            columns: [
              { header: "Metric", key: "metric", width: 28 },
              { header: "Value", key: "value", width: 22, format: "auto" },
            ],
            rows: [
              { metric: "From", value: formatReportDate(from) },
              { metric: "To", value: formatReportDate(to) },
              { metric: "Check-ins", value: checkIns },
              { metric: "Room revenue", value: roomTotal },
              { metric: "Store items revenue", value: storeTotal },
              { metric: "Total sales", value: salesTotal },
              { metric: "Cash collected", value: salesReport?.totals.cashCollected ?? 0 },
              { metric: "GCash collected", value: salesReport?.totals.gcashCollected ?? 0 },
              { metric: "QRPh collected", value: salesReport?.totals.qrphCollected ?? 0 },
              { metric: "Expenses", value: expenseTotal },
              { metric: "Net sales", value: netSales },
            ],
            emphasizeLastRow: true,
          },
        ],
      },
      {
        name: "By day",
        title: "Sales and expenses by day",
        subtitle: rangeLabel,
        tables: [
          {
            columns: [
              { header: "Date", key: "date", width: 16 },
              { header: "Check-ins", key: "checkIns", width: 12, format: "integer" },
              { header: "Room", key: "room", width: 14, format: "currency" },
              { header: "Store", key: "store", width: 14, format: "currency" },
              { header: "Sales", key: "sales", width: 14, format: "currency" },
              { header: "Expenses", key: "expenses", width: 14, format: "currency" },
              { header: "Net", key: "net", width: 14, format: "currency" },
            ],
            rows: [
              ...days.map((day) => ({
                date: day.date,
                checkIns: day.checkIns,
                room: day.roomRevenue,
                store: day.storeRevenue,
                sales: day.sales,
                expenses: day.expenses,
                net: day.net,
              })),
              {
                date: "Total",
                checkIns,
                room: roomTotal,
                store: storeTotal,
                sales: salesTotal,
                expenses: expenseTotal,
                net: netSales,
              },
            ],
            emphasizeLastRow: true,
          },
        ],
      },
      {
        name: "Expenses",
        title: "Expenses",
        subtitle: rangeLabel,
        tables: [
          {
            columns: [
              { header: "Date", key: "date", width: 16 },
              { header: "Time", key: "time", width: 12 },
              { header: "Shift", key: "shift", width: 10 },
              { header: "What for", key: "description", width: 28 },
              { header: "Staff", key: "staff", width: 18 },
              { header: "Amount", key: "amount", width: 14, format: "currency" as const },
            ],
            rows:
              expenses.length === 0
                ? [{ date: "No expenses in this range.", time: "", shift: "", description: "", staff: "", amount: "" }]
                : [
                    ...expenses.map((expense) => {
                      const when = expense.recordedAt?.toDate?.() ?? null;
                      return {
                        date: when
                          ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`
                          : "",
                        time: when
                          ? when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
                          : "",
                        shift: when ? shiftLabelForTime(when) : "",
                        description: expense.description,
                        staff: expense.cashierName,
                        amount: expense.amount,
                      };
                    }),
                    {
                      date: "Total",
                      time: "",
                      shift: "",
                      description: "",
                      staff: "",
                      amount: expenseTotal,
                    },
                  ],
            emphasizeLastRow: expenses.length > 0,
          },
        ],
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input type="date" value={fromValue} onChange={(e) => setFromValue(e.target.value)} className="w-44" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input type="date" value={toValue} onChange={(e) => setToValue(e.target.value)} className="w-44" />
          </label>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="font-semibold" onClick={handleExport} disabled={loading}>
            <DownloadIcon className="size-4" />
            Export Excel
          </Button>
          <Button variant="outline" size="lg" className="font-semibold" onClick={() => window.print()} disabled={loading}>
            <PrinterIcon className="size-4" />
            Print / PDF
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="print-area flex flex-col gap-4">
          <div className="hidden text-center print:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo/icon.png"
              alt=""
              width={160}
              height={146}
              className="mx-auto mb-2 h-14 w-auto object-contain"
            />
            <div className="font-heading text-lg font-semibold">Marimar Inn - Davao</div>
            <div className="text-sm">Custom range report</div>
            <div className="text-xs text-muted-foreground">{rangeLabel}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Check-ins" value={String(checkIns)} />
            <StatCard label="Room revenue" value={peso(roomTotal)} />
            <StatCard label="Store items" value={peso(storeTotal)} />
            <StatCard label="Total sales" value={peso(salesTotal)} />
            <StatCard label="Expenses" value={peso(expenseTotal)} />
            <StatCard label="Net sales" value={peso(netSales)} />
          </div>

          {salesReport && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-muted/50 p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Cash collected</span>{" "}
                <span className="font-medium">{peso(salesReport.totals.cashCollected)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">GCash collected</span>{" "}
                <span className="font-medium">{peso(salesReport.totals.gcashCollected)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">QRPh collected</span>{" "}
                <span className="font-medium">{peso(salesReport.totals.qrphCollected)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total collected</span>{" "}
                <span className="font-medium">{peso(salesReport.totals.totalPaid)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Net after expenses</span>{" "}
                <span className="font-medium">{peso(salesReport.totals.totalPaid - expenseTotal)}</span>
              </div>
            </div>
          )}

          {days.length <= 62 && (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>Sales vs expenses</CardTitle>
                <CardDescription>{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <SalesExpensesChart data={days} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>By day</CardTitle>
              <CardDescription>Sales, expenses, and net for each date in the range.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Date</th>
                      <th className="py-1 font-medium">Check-ins</th>
                      <th className="py-1 font-medium text-right">Room</th>
                      <th className="py-1 font-medium text-right">Store</th>
                      <th className="py-1 font-medium text-right">Sales</th>
                      <th className="py-1 font-medium text-right">Expenses</th>
                      <th className="py-1 font-medium text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day.date} className="border-t">
                        <td className="py-1.5 whitespace-nowrap">{day.date}</td>
                        <td className="py-1.5">{day.checkIns}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">{peso(day.roomRevenue)}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">{peso(day.storeRevenue)}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">{peso(day.sales)}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">{peso(day.expenses)}</td>
                        <td className="py-1.5 text-right whitespace-nowrap font-medium">{peso(day.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted font-medium">
                      <td className="py-1.5">Total</td>
                      <td className="py-1.5">{checkIns}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{peso(roomTotal)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{peso(storeTotal)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{peso(salesTotal)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{peso(expenseTotal)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{peso(netSales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>
                {expenses.length === 0
                  ? "No expenses in this range."
                  : `${expenses.length} ${expenses.length === 1 ? "entry" : "entries"} · ${peso(expenseTotal)}`}
              </CardDescription>
            </CardHeader>
            {expenses.length > 0 && (
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">Date</th>
                        <th className="py-1 font-medium">Time</th>
                        <th className="py-1 font-medium">Shift</th>
                        <th className="py-1 font-medium">What for</th>
                        <th className="py-1 font-medium">Staff</th>
                        <th className="py-1 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((expense) => {
                        const when = expense.recordedAt?.toDate?.() ?? null;
                        return (
                          <tr key={expense.expenseId} className="border-t">
                            <td className="py-1.5 whitespace-nowrap">
                              {when
                                ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`
                                : "—"}
                            </td>
                            <td className="py-1.5 whitespace-nowrap">
                              {when
                                ? when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
                                : "—"}
                            </td>
                            <td className="py-1.5">{when ? shiftLabelForTime(when) : "—"}</td>
                            <td className="py-1.5">{expense.description}</td>
                            <td className="py-1.5 whitespace-nowrap">{expense.cashierName}</td>
                            <td className="py-1.5 text-right whitespace-nowrap">{peso(expense.amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted font-medium">
                        <td className="py-1.5" colSpan={5}>
                          Total expenses
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">{peso(expenseTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function InventoryReportTab() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [monthValue, setMonthValue] = useState(thisMonthInputValue());
  const [topConsumed, setTopConsumed] = useState<MonthlyReport["topItemsByQuantity"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => subscribeToInventory(setItems), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [year, month] = monthValue.split("-").map(Number);
      const monthDate = new Date(year, month - 1, 1);
      try {
        const [bookings, storeSales] = await Promise.all([
          fetchBookingsInRange(
            "checkInTime",
            startOfMonth(monthDate),
            endOfMonth(monthDate)
          ),
          fetchStoreSalesInRange(startOfMonth(monthDate), endOfMonth(monthDate)),
        ]);
        if (!cancelled) {
          setTopConsumed(computeMonthlyReport(bookings, [], monthDate, storeSales).topItemsByQuantity);
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load consumption data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [monthValue]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Current stock levels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 font-medium">Category</th>
                  <th className="py-1 font-medium">Stock</th>
                </tr>
              </thead>
              <tbody>
                {items?.map((item) => {
                  const low = item.quantity <= item.minStockLevel;
                  return (
                    <tr key={item.itemId} className="border-t">
                      <td className="py-1.5">{item.name}</td>
                      <td className="py-1.5 text-muted-foreground">{item.category}</td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-2">
                          {item.quantity}
                          {low && (
                            <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">
                              Low stock
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Most consumed</CardTitle>
            <Input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
              className="w-40"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : topConsumed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders that month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 font-medium">Qty consumed</th>
                </tr>
              </thead>
              <tbody>
                {topConsumed.map((item) => (
                  <tr key={item.name} className="border-t">
                    <td className="py-1.5">{item.name}</td>
                    <td className="py-1.5">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OverdueReportTab() {
  const now = useNowTick(30_000);
  // Monthly, not per-day — checking overdue history one day at a time meant
  // clicking through the calendar day by day to spot a pattern; a month at a
  // glance is what an Owner actually wants to review.
  const [monthValue, setMonthValue] = useState(thisMonthInputValue());
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [year, month] = monthValue.split("-").map(Number);
      const monthDate = new Date(year, month - 1, 1);
      try {
        // Merge the selected month's check-ins (for resolved history) with
        // every currently-active booking (so a room that's overdue *right
        // now* always shows up, even if its guest checked in in a different
        // month than the one currently picked).
        const [monthBookings, activeBookings] = await Promise.all([
          fetchBookingsInRange("checkInTime", startOfMonth(monthDate), endOfMonth(monthDate)),
          fetchActiveBookings(),
        ]);
        const merged = new Map<string, Booking>();
        for (const booking of monthBookings) merged.set(booking.bookingId, booking);
        for (const booking of activeBookings) merged.set(booking.bookingId, booking);
        if (!cancelled) setBookings(Array.from(merged.values()));
      } catch {
        if (!cancelled) toast.error("Couldn't load overdue history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [monthValue]);

  // Recomputed on every render from the fetched bookings — cheap, and it
  // means "still ongoing" durations keep counting up live off the same
  // 30s tick that drives the room grid, no separate refetch needed.
  const records: OverdueRecord[] | null = bookings ? computeOverdueHistory(bookings, now) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className="w-44"
        />
      </div>

      {loading || records === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No overdue rooms that month.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Overdue rooms — {formatReportMonth(monthValue)}</CardTitle>
            <CardDescription>
              Every room that ran past its booked time, worst first — including ones already
              checked out, so this stays useful even if you weren&apos;t watching live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Room</th>
                    <th className="py-1 font-medium">Guest</th>
                    <th className="py-1 font-medium">Check-in</th>
                    <th className="py-1 font-medium">Booked until</th>
                    <th className="py-1 font-medium">Checked out</th>
                    <th className="py-1 font-medium">Overdue by</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records
                    .slice()
                    .sort((a, b) => b.overdueByHours - a.overdueByHours)
                    .map((record) => (
                      <tr key={record.bookingId} className="border-t">
                        <td className="py-1.5 font-medium">{record.roomNumber}</td>
                        <td className="py-1.5">{record.guestName}</td>
                        <td className="py-1.5">{record.checkInTime.toLocaleTimeString("en-PH")}</td>
                        <td className="py-1.5">{record.bookedUntil.toLocaleTimeString("en-PH")}</td>
                        <td className="py-1.5">
                          {record.actualCheckOutTime
                            ? record.actualCheckOutTime.toLocaleTimeString("en-PH")
                            : "—"}
                        </td>
                        <td className="py-1.5 font-semibold text-rose-600 dark:text-rose-400">
                          {formatHours(record.overdueByHours)}
                        </td>
                        <td className="py-1.5">
                          {record.stillOngoing ? (
                            <Badge variant="secondary" className="text-rose-600 dark:text-rose-400">
                              Still ongoing
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-muted-foreground">
                              Resolved
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportsContent() {
  const { appUser } = useAuth();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const isOwnerLike = isOwnerLikeRole(appUser?.role);

  useEffect(() => subscribeToRooms(setRooms), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {isOwnerLike
            ? "Revenue, occupancy, sales, and overdue tracking — daily, custom range, monthly, and inventory views."
            : "Today's sales — print or export to hand off at end of shift."}
        </p>
      </div>

      {isOwnerLike ? (
        <Tabs defaultValue="daily">
          <TabsList className="flex h-auto min-h-10 w-full flex-wrap justify-start gap-1 p-1 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="daily" className="h-8 flex-none px-3 py-1.5 text-foreground">
              Daily
            </TabsTrigger>
            <TabsTrigger value="range" className="h-8 flex-none px-3 py-1.5 text-foreground">
              <CalendarRangeIcon className="hidden size-4 sm:block" />
              <span className="sm:hidden">Range</span>
              <span className="hidden sm:inline">Custom range</span>
            </TabsTrigger>
            <TabsTrigger value="monthly" className="h-8 flex-none px-3 py-1.5 text-foreground">
              Monthly
            </TabsTrigger>
            <TabsTrigger value="overdue" className="h-8 flex-none px-3 py-1.5 text-foreground">
              Overdue
            </TabsTrigger>
            <TabsTrigger value="inventory" className="h-8 flex-none px-3 py-1.5 text-foreground">
              Inventory
            </TabsTrigger>
          </TabsList>
          <TabsContent value="daily" className="min-w-0 pt-3">
            <DailyReportTab rooms={rooms} />
          </TabsContent>
          <TabsContent value="range" className="min-w-0 pt-3">
            <RangeReportTab />
          </TabsContent>
          <TabsContent value="monthly" className="min-w-0 pt-3">
            <MonthlyReportTab rooms={rooms} />
          </TabsContent>
          <TabsContent value="overdue" className="min-w-0 pt-3">
            <OverdueReportTab />
          </TabsContent>
          <TabsContent value="inventory" className="min-w-0 pt-3">
            <InventoryReportTab />
          </TabsContent>
        </Tabs>
      ) : (
        // Cashiers only get the Daily Sales Report — Monthly trends and
        // inventory consumption analytics stay Owner-only.
        <DailyReportTab rooms={rooms} />
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <ProtectedRoute allowedRoles={["owner", "admin", "superadmin", "supervisor", "cashier"]}>
      <ReportsContent />
    </ProtectedRoute>
  );
}
