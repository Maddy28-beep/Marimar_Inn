"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBranch } from "@/context/branch-context";
import { BRANCHES } from "@/lib/branches";
import { totalExpenses, fetchExpensesInRange } from "@/lib/expenses";
import {
  computeDailySalesReport,
  computeShiftCollectedTotals,
  endOfDay,
  endOfMonth,
  fetchBookingsInRange,
  startOfDay,
  startOfMonth,
} from "@/lib/reports";
import { fetchStoreSalesInRange } from "@/lib/store-sales";
import { fetchTransactionsInRange } from "@/lib/transactions";
import { Loader2Icon } from "lucide-react";

interface BranchSummary {
  id: string;
  name: string;
  checkIns: number;
  roomSales: number;
  storeSales: number;
  cash: number;
  gcash: number;
  qrph: number;
  collected: number;
  expenses: number;
  netCash: number;
}

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

async function summarizeBranch(
  id: string,
  name: string,
  start: Date,
  end: Date
): Promise<BranchSummary> {
  const [bookings, expenses, storeSales, transactions] = await Promise.all([
    fetchBookingsInRange("checkInTime", start, end, id),
    fetchExpensesInRange(start, end, id),
    fetchStoreSalesInRange(start, end, id),
    fetchTransactionsInRange(start, end, id),
  ]);
  const sales = computeDailySalesReport(bookings, storeSales);
  const collected = computeShiftCollectedTotals(transactions, storeSales, bookings);
  const spent = totalExpenses(expenses);
  return {
    id,
    name,
    checkIns: bookings.filter((b) => b.status !== "voided").length,
    roomSales: sales.totals.totalRoomAmount + sales.totals.amenityAmount,
    storeSales: sales.totals.totalStoreAmount,
    cash: collected.cashCollected,
    gcash: collected.gcashCollected,
    qrph: collected.qrphCollected,
    collected: collected.totalCollected,
    expenses: spent,
    netCash: collected.cashCollected - spent,
  };
}

interface Column {
  label: string;
  pick: (r: BranchSummary) => number;
  money?: boolean;
  bold?: boolean;
}

const COLUMNS: Column[] = [
  { label: "Check-ins", pick: (r) => r.checkIns },
  { label: "Room sales", pick: (r) => r.roomSales, money: true },
  { label: "Store sales", pick: (r) => r.storeSales, money: true },
  { label: "Cash", pick: (r) => r.cash, money: true },
  { label: "GCash", pick: (r) => r.gcash, money: true },
  { label: "QRPh", pick: (r) => r.qrph, money: true },
  { label: "Total collected", pick: (r) => r.collected, money: true, bold: true },
  { label: "Expenses", pick: (r) => r.expenses, money: true },
  { label: "Net cash", pick: (r) => r.netCash, money: true, bold: true },
];

function AllBranchesContent() {
  const router = useRouter();
  const { switchBranch } = useBranch();
  const [from, setFrom] = useState(() => toInputValue(new Date()));
  const [to, setTo] = useState(() => toInputValue(new Date()));
  const [result, setResult] = useState<{ key: string; rows: BranchSummary[] | null } | null>(null);
  const key = `${from}|${to}`;

  useEffect(() => {
    let cancelled = false;
    const start = startOfDay(parseInput(from));
    const end = endOfDay(parseInput(to));
    Promise.all(BRANCHES.map((b) => summarizeBranch(b.id, b.name, start, end)))
      .then((rows) => {
        if (!cancelled) setResult({ key, rows });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, key]);

  function setRange(start: Date, end: Date) {
    setFrom(toInputValue(start));
    setTo(toInputValue(end));
  }

  const current = result && result.key === key ? result : null;
  const rows = current?.rows ?? null;
  const failed = current !== null && current.rows === null;

  const sum = (pick: (r: BranchSummary) => number) =>
    (rows ?? []).reduce((acc, r) => acc + pick(r), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">All Branches</h1>
        <p className="text-sm text-muted-foreground">
          Combined sales and expenses across every branch. Net cash = cash collected minus
          expenses.
          Click a branch to open its own reports with the full transactions.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="from">
            From
          </label>
          <Input
            id="from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="to">
            To
          </label>
          <Input
            id="to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="w-40"
          />
        </div>
        <Button variant="outline" onClick={() => setRange(new Date(), new Date())}>
          Today
        </Button>
        <Button
          variant="outline"
          onClick={() => setRange(startOfMonth(new Date()), endOfMonth(new Date()))}
        >
          This month
        </Button>
      </div>

      {failed ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load the branch totals — please try again.
        </p>
      ) : !rows ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Loading all branches…
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Branch</th>
                  {COLUMNS.map((c) => (
                    <th key={c.label} className="px-3 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        title={`Open ${r.name} reports with full transactions`}
                        onClick={() => {
                          switchBranch(r.id);
                          router.push("/reports");
                        }}
                      >
                        {r.name}
                      </button>
                    </td>
                    {COLUMNS.map((c) => (
                      <td
                        key={c.label}
                        className={`px-3 py-2 text-right tabular-nums ${c.bold ? "font-semibold" : ""}`}
                      >
                        {c.money ? peso(c.pick(r)) : c.pick(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-2">All branches</td>
                  {COLUMNS.map((c) => (
                    <td key={c.label} className="px-3 py-2 text-right tabular-nums">
                      {c.money ? peso(sum(c.pick)) : sum(c.pick)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AllBranchesPage() {
  return (
    <ProtectedRoute allowedRoles={["owner", "admin", "superadmin"]}>
      <AllBranchesContent />
    </ProtectedRoute>
  );
}
