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
} from "@/lib/reports";
import { DailySalesTable } from "@/components/reports/daily-sales-table";
import { exportToExcel, formatReportDate, formatReportMonth } from "@/lib/export";
import {
  PAYMENT_METHOD_LABELS,
  ROOM_TYPE_LABELS,
  type Booking,
  type InventoryItem,
  type Room,
} from "@/lib/types";
import { formatHours } from "@/lib/time";
import { useNowTick } from "@/hooks/use-now-tick";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { printDailySalesReceipt } from "@/lib/receipt-printer";
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
import { RevenueChart } from "@/components/reports/revenue-chart";
import { DownloadIcon, PrinterIcon } from "lucide-react";

function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function thisMonthInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type ShiftFilter = "fullDay" | "day" | "night";

const SHIFT_LABELS: Record<ShiftFilter, string> = {
  fullDay: "Full day",
  day: "Day shift (7 AM–7 PM)",
  night: "Night shift (7 PM–7 AM)",
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
  return [new Date(y, m - 1, d, 0, 0, 0, 0), new Date(y, m - 1, d, 23, 59, 59, 999)];
}

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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
  const [dateValue, setDateValue] = useState(todayInputValue());
  const [shift, setShift] = useState<ShiftFilter>("fullDay");
  const [report, setReport] = useState<DailyReport | null>(null);
  const [salesReport, setSalesReport] = useState<DailySalesReport | null>(null);
  const [frontDesk, setFrontDesk] = useState("");
  const [housekeeping, setHousekeeping] = useState("");
  const [dutyTime, setDutyTime] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [start, end] = shiftRange(dateValue, shift);
      try {
        const [checkedIn, checkedOut] = await Promise.all([
          fetchBookingsInRange("checkInTime", start, end),
          fetchBookingsInRange("checkOutTime", start, end),
        ]);
        if (!cancelled) {
          setReport(computeDailyReport(checkedIn, checkedOut.length));
          setSalesReport(computeDailySalesReport(checkedIn));
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

  const reportLabel =
    shift === "fullDay" ? formatReportDate(dateValue) : `${formatReportDate(dateValue)} — ${SHIFT_LABELS[shift]}`;

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
        title: "Daily Sales Report",
        subtitle: reportLabel,
        dutyInfo: `Front desk: ${frontDesk.trim() || "____________________________"}        Housekeeping: ${
          housekeeping.trim() || "____________________________"
        }        Time: ${dutyTime ? formatDutyTime(dutyTime) : "______________"}`,
        tables: [
          {
            columns: [
              { header: "Room", key: "room", width: 6 },
              { header: "Ref #", key: "ref", width: 10 },
              { header: "Hrs", key: "hrs", width: 5, format: "integer" },
              { header: "Check-in", key: "checkIn", width: 14 },
              { header: "Checkout", key: "schedOut", width: 14 },
              { header: "Amount", key: "amount", width: 12, format: "currency" },
              { header: "Ext hrs", key: "extHrs", width: 9, format: "integer" },
              { header: "Ext amt", key: "extAmt", width: 12, format: "currency" },
              { header: "Actual out", key: "actualOut", width: 14 },
              { header: "Room total", key: "roomTotal", width: 14, format: "currency" },
              { header: "Store total", key: "storeTotal", width: 14, format: "currency" },
              { header: "Paid", key: "paid", width: 12, format: "currency" },
              { header: "Payment", key: "payment", width: 22 },
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
                actualOut: time(row.actualCheckOutTime),
                roomTotal: row.totalRoomAmount,
                storeTotal: row.totalStoreAmount,
                paid: row.totalPaid,
                payment: row.gcashReference
                  ? `${PAYMENT_METHOD_LABELS[row.paymentMethod]} (${row.gcashReference})`
                  : PAYMENT_METHOD_LABELS[row.paymentMethod],
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
                      actualOut: "",
                      roomTotal: salesReport.totals.totalRoomAmount,
                      storeTotal: salesReport.totals.totalStoreAmount,
                      paid: salesReport.totals.totalPaid,
                      payment: "",
                    },
                  ]
                : []),
            ],
            emphasizeLastRow: (salesReport?.rows.length ?? 0) > 0,
          },
          ...(salesReport
            ? [
                [
                  {
                    heading: "Payment breakdown",
                    columns: [
                      { header: "Metric", key: "metric", width: 24 },
                      { header: "Value", key: "value", width: 22, format: "currency" as const },
                    ],
                    rows: [
                      { metric: "Cash collected", value: salesReport.totals.cashCollected },
                      { metric: "GCash collected", value: salesReport.totals.gcashCollected },
                      { metric: "Total collected", value: salesReport.totals.totalPaid },
                      {
                        metric: "Overall Sale",
                        value: salesReport.totals.totalRoomAmount + salesReport.totals.totalStoreAmount,
                      },
                    ],
                    emphasizeLastRow: true,
                  },
                  {
                    heading: "Summary",
                    columns: [
                      { header: "Metric", key: "metric", width: 28 },
                      { header: "Value", key: "value", width: 22, format: "auto" as const },
                    ],
                    rows: [
                      { metric: "Date", value: reportLabel },
                      { metric: "Check-ins", value: report.checkIns },
                      { metric: "Check-outs", value: report.checkOuts },
                      { metric: "Room revenue", value: report.roomRevenue },
                      { metric: "Store items revenue", value: report.fbRevenue },
                      { metric: "Total revenue", value: report.totalRevenue },
                    ],
                    emphasizeLastRow: true,
                  },
                ],
                {
                  heading: "Signatures",
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

  function handlePrintThermal() {
    if (!salesReport || !printer.connected) return;
    try {
      printDailySalesReceipt({
        // A short format ("Aug 16, 2026") on purpose — the full weekday
        // format used elsewhere can run to 30 characters, right at the edge
        // of 58mm (32-char) paper.
        dateLabel:
          new Date(`${dateValue}T00:00:00`).toLocaleDateString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }) + (shift !== "fullDay" ? ` (${shift === "day" ? "Day" : "Night"})` : ""),
        frontDesk: frontDesk.trim() || undefined,
        housekeeping: housekeeping.trim() || undefined,
        dutyTime: dutyTime ? formatDutyTime(dutyTime) : undefined,
        rows: salesReport.rows.map((row) => ({
          roomNumber: row.roomNumber,
          refNumber: row.refNumber,
          packageHours: row.packageHours,
          extensionHours: row.extensionHours,
          extensionAmount: row.extensionAmount,
          totalRoomAmount: row.totalRoomAmount,
          totalStoreAmount: row.totalStoreAmount,
          totalPaid: row.totalPaid,
          paymentMethodLabel: PAYMENT_METHOD_LABELS[row.paymentMethod],
          gcashReference: row.gcashReference,
        })),
        totals: salesReport.totals,
      });
    } catch {
      toast.error("Couldn't print to the thermal printer.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="w-44"
          />
          <Select value={shift} onValueChange={(v) => setShift(v as ShiftFilter)}>
            <SelectTrigger className="w-48">
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
            className="w-36"
          />
          <Input
            placeholder="Housekeeping"
            value={housekeeping}
            onChange={(e) => setHousekeeping(e.target.value)}
            className="w-36"
          />
          <Input
            type="time"
            aria-label="Duty start time"
            value={dutyTime}
            onChange={(e) => setDutyTime(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!report}>
              <DownloadIcon className="size-3.5" />
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintThermal}
              disabled={!salesReport || !printer.connected}
              title={!printer.connected ? "Connect a thermal printer first (printer icon, top right)" : undefined}
            >
              <PrinterIcon className="size-3.5" />
              Print (thermal)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              disabled={!report}
              title="Choose Landscape in the print dialog for the best fit"
            >
              <PrinterIcon className="size-3.5" />
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

      {loading || !report ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="print-area flex flex-col gap-4">
          <div className="hidden text-center print:block">
            <div className="font-heading text-lg font-semibold">Marimar Inn - Davao</div>
            <div className="text-sm">Daily Sales Report</div>
            <div className="mt-1 flex justify-center gap-6 text-xs text-muted-foreground">
              <span>Date: {reportLabel}</span>
              {frontDesk && <span>Front desk: {frontDesk}</span>}
              {housekeeping && <span>Housekeeping: {housekeeping}</span>}
              {dutyTime && <span>Time: {formatDutyTime(dutyTime)}</span>}
            </div>
          </div>

          {salesReport && <DailySalesTable report={salesReport} />}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            <StatCard label="Check-ins" value={String(report.checkIns)} />
            <StatCard label="Check-outs" value={String(report.checkOuts)} />
            <StatCard label="Room revenue" value={peso(report.roomRevenue)} />
            <StatCard label="Store items" value={peso(report.fbRevenue)} />
            <StatCard label="Current occupancy" value={`${occupied}/${totalRooms}`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Total revenue</CardTitle>
              <CardDescription>{peso(report.totalRevenue)}</CardDescription>
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
    </div>
  );
}

function MonthlyReportTab({ rooms }: { rooms: Room[] | null }) {
  const [monthValue, setMonthValue] = useState(thisMonthInputValue());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rooms) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [year, month] = monthValue.split("-").map(Number);
      const monthDate = new Date(year, month - 1, 1);
      try {
        const bookings = await fetchBookingsInRange(
          "checkInTime",
          startOfMonth(monthDate),
          endOfMonth(monthDate)
        );
        if (!cancelled) setReport(computeMonthlyReport(bookings, rooms ?? [], monthDate));
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
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!report}>
            <DownloadIcon className="size-3.5" />
            Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!report}>
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
            <div className="font-heading text-lg font-semibold">Marimar Inn</div>
            <div className="text-sm text-muted-foreground">Monthly Report — {monthValue}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total revenue" value={peso(report.totalRevenue)} />
            <StatCard label="Room revenue" value={peso(report.roomRevenue)} />
            <StatCard label="Store items" value={peso(report.fbRevenue)} />
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
        const bookings = await fetchBookingsInRange(
          "checkInTime",
          startOfMonth(monthDate),
          endOfMonth(monthDate)
        );
        if (!cancelled) {
          setTopConsumed(computeMonthlyReport(bookings, [], monthDate).topItemsByQuantity);
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
  const [dateValue, setDateValue] = useState(todayInputValue());
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const date = new Date(`${dateValue}T00:00:00`);
      try {
        // Merge the selected day's check-ins (for resolved history) with
        // every currently-active booking (so a room that's overdue *right
        // now* always shows up, even if its guest checked in on a different
        // day than the one currently picked).
        const [dayBookings, activeBookings] = await Promise.all([
          fetchBookingsInRange("checkInTime", startOfDay(date), endOfDay(date)),
          fetchActiveBookings(),
        ]);
        const merged = new Map<string, Booking>();
        for (const booking of dayBookings) merged.set(booking.bookingId, booking);
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
  }, [dateValue]);

  // Recomputed on every render from the fetched bookings — cheap, and it
  // means "still ongoing" durations keep counting up live off the same
  // 30s tick that drives the room grid, no separate refetch needed.
  const records: OverdueRecord[] | null = bookings ? computeOverdueHistory(bookings, now) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Input
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          className="w-44"
        />
      </div>

      {loading || records === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No overdue rooms that day.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Overdue rooms — {formatReportDate(dateValue)}</CardTitle>
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
  const isOwner = appUser?.role === "owner";

  useEffect(() => subscribeToRooms(setRooms), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "Revenue, occupancy, sales, and overdue tracking — daily, monthly, and inventory views."
            : "Today's sales — print or export to hand off at end of shift."}
        </p>
      </div>

      {isOwner ? (
        <Tabs defaultValue="daily">
          <TabsList>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
          </TabsList>
          <TabsContent value="daily">
            <DailyReportTab rooms={rooms} />
          </TabsContent>
          <TabsContent value="monthly">
            <MonthlyReportTab rooms={rooms} />
          </TabsContent>
          <TabsContent value="overdue">
            <OverdueReportTab />
          </TabsContent>
          <TabsContent value="inventory">
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
    <ProtectedRoute allowedRoles={["owner", "cashier"]}>
      <ReportsContent />
    </ProtectedRoute>
  );
}
