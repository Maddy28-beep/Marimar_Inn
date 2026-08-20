"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyRevenuePoint } from "@/lib/reports";

interface RevenueChartProps {
  data: DailyRevenuePoint[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  const chartData = data.map((point) => ({
    day: point.date.slice(-2),
    "Room": point.roomRevenue,
    "Store items": point.fbRevenue,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--popover)",
              borderColor: "var(--border)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            formatter={(value) => `₱${Number(value).toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Room" stackId="revenue" fill="var(--chart-1)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Store items" stackId="revenue" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SalesExpensesChart({
  data,
}: {
  data: { date: string; sales: number; expenses: number }[];
}) {
  const chartData = data.map((point) => ({
    day: point.date.slice(5),
    Sales: point.sales,
    Expenses: point.expenses,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--popover)",
              borderColor: "var(--border)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            formatter={(value) => `₱${Number(value).toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Sales" fill="var(--chart-1)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="Expenses" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
