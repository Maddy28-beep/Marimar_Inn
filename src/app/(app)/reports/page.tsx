"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { subscribeToRooms } from "@/lib/rooms";
import { subscribeToInventory } from "@/lib/inventory";
import {
  computeDailyReport,
  computeMonthlyReport,
  endOfDay,
  endOfMonth,
  fetchBookingsInRange,
  startOfDay,
  startOfMonth,
  type DailyReport,
  type MonthlyReport,
} from "@/lib/reports";
import { exportToExcel, formatReportDate, formatReportMonth } from "@/lib/export";
import { ROOM_TYPE_LABELS, type InventoryItem, type Room } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  const [dateValue, setDateValue] = useState(todayInputValue());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const date = new Date(`${dateValue}T00:00:00`);
      try {
        const [checkedIn, checkedOut] = await Promise.all([
          fetchBookingsInRange("checkInTime", startOfDay(date), endOfDay(date)),
          fetchBookingsInRange("checkOutTime", startOfDay(date), endOfDay(date)),
        ]);
        if (!cancelled) setReport(computeDailyReport(checkedIn, checkedOut.length));
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
  }, [dateValue]);

  const occupied = rooms?.filter((r) => r.status === "occupied").length ?? 0;
  const totalRooms = rooms?.length ?? 0;

  async function handleExport() {
    if (!report) return;
    await exportToExcel(`marimar-inn-daily-${dateValue}`, [
      {
        name: "Daily Report",
        title: "Daily Report",
        subtitle: formatReportDate(dateValue),
        tables: [
          {
            heading: "Summary",
            columns: [
              { header: "Metric", key: "metric", width: 28 },
              { header: "Value", key: "value", width: 22, format: "auto" },
            ],
            rows: [
              { metric: "Date", value: formatReportDate(dateValue) },
              { metric: "Check-ins", value: report.checkIns },
              { metric: "Check-outs", value: report.checkOuts },
              { metric: "Room revenue", value: report.roomRevenue },
              { metric: "Store items revenue", value: report.fbRevenue },
              { metric: "Total revenue", value: report.totalRevenue },
            ],
            emphasizeLastRow: true,
          },
          {
            heading: "Most ordered items",
            columns: [
              { header: "Item", key: "name", width: 28 },
              { header: "Quantity", key: "quantity", width: 14, format: "integer" },
              { header: "Revenue", key: "revenue", width: 18, format: "currency" },
            ],
            rows: report.mostOrderedItems.map((item) => ({
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
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
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
            <div className="text-sm text-muted-foreground">Daily Report — {formatReportDate(dateValue)}</div>
          </div>

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

function ReportsContent() {
  const [rooms, setRooms] = useState<Room[] | null>(null);

  useEffect(() => subscribeToRooms(setRooms), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Revenue, occupancy, and sales — daily, monthly, and inventory views.
        </p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <DailyReportTab rooms={rooms} />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyReportTab rooms={rooms} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <ReportsContent />
    </ProtectedRoute>
  );
}
