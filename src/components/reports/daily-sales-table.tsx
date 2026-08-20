"use client";

import { PAYMENT_METHOD_LABELS, type ShiftExpense } from "@/lib/types";
import { shiftLabelForTime, totalExpenses } from "@/lib/expenses";
import type { DailySalesReport, DailySalesRow } from "@/lib/reports";

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// A booking can mix methods across check-in/extend/checkout, so its final
// paymentMethod label alone can be misleading — show the real cash/GCash
// breakdown whenever both portions are actually nonzero.
function paymentLabel(row: DailySalesRow): string {
  const cash = row.splitCashAmount ?? 0;
  const gcash = row.splitGcashAmount ?? 0;
  const qrph = row.splitQrphAmount ?? 0;
  const parts: string[] = [];
  if (cash > 0) parts.push(`Cash ${peso(cash)}`);
  if (gcash > 0) parts.push(`GCash ${peso(gcash)}`);
  if (qrph > 0) parts.push(`QRPh ${peso(qrph)}`);
  if (parts.length > 1) return parts.join(" + ");
  return PAYMENT_METHOD_LABELS[row.paymentMethod];
}

function time(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

const HEADERS = [
  "Room",
  "Ref #",
  "Hrs",
  "Check-in",
  "Checkout",
  "Amount",
  "Ext hrs",
  "Ext amt",
  "Actual out",
  "Room total",
  "Store total",
  "Paid",
  "Payment",
  "Others",
  "Remarks",
];

export function DailySalesTable({
  report,
  expenses = [],
  canRemoveExpenses = false,
  onRemoveExpense,
}: {
  report: DailySalesReport;
  expenses?: ShiftExpense[];
  canRemoveExpenses?: boolean;
  onRemoveExpense?: (expenseId: string) => void;
}) {
  const { rows, totals } = report;
  const expenseTotal = totalExpenses(expenses);
  const overallSale = totals.totalRoomAmount + totals.totalStoreAmount;
  const netCash = totals.cashCollected - expenseTotal;
  const netCollected = totals.totalPaid - expenseTotal;
  const netSales = overallSale - expenseTotal;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[960px] border-collapse text-[11px] print:text-[8px]">
          <thead>
            <tr className="bg-muted">
              {HEADERS.map((h, i) => (
                <th
                  key={h}
                  className={
                    "border p-1 text-left font-medium whitespace-nowrap" +
                    (i >= 5 && i !== 6 && i !== 8 && i !== 12 && i !== 13 && i !== 14
                      ? " text-right"
                      : "")
                  }
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={HEADERS.length} className="border p-3 text-center text-muted-foreground">
                  No check-ins that day.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.bookingId}>
                  <td className="border p-1 whitespace-nowrap">{row.roomNumber}</td>
                  <td className="border p-1 whitespace-nowrap">{row.refNumber}</td>
                  <td className="border p-1">{row.packageHours}</td>
                  <td className="border p-1 whitespace-nowrap">{time(row.checkInTime)}</td>
                  <td className="border p-1 whitespace-nowrap">{time(row.scheduledCheckOutTime)}</td>
                  <td className="border p-1 text-right whitespace-nowrap">{peso(row.packageAmount)}</td>
                  <td className="border p-1">{row.extensionHours > 0 ? row.extensionHours : ""}</td>
                  <td className="border p-1 text-right whitespace-nowrap">
                    {row.extensionAmount > 0 ? peso(row.extensionAmount) : ""}
                  </td>
                  <td className="border p-1 whitespace-nowrap">{time(row.actualCheckOutTime)}</td>
                  <td className="border p-1 text-right whitespace-nowrap">{peso(row.totalRoomAmount)}</td>
                  <td className="border p-1 text-right whitespace-nowrap">
                    {row.totalStoreAmount > 0 ? peso(row.totalStoreAmount) : ""}
                  </td>
                  <td className="border p-1 text-right whitespace-nowrap">{peso(row.totalPaid)}</td>
                  <td className="border p-1 whitespace-nowrap">
                    {paymentLabel(row)}
                    {row.gcashReference ? ` (GCash ${row.gcashReference})` : ""}
                    {row.qrphReference ? ` (QRPh ${row.qrphReference})` : ""}
                  </td>
                  <td className="border p-1" />
                  <td className="border p-1" />
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted font-medium">
                <td className="border p-1" colSpan={5}>
                  Totals
                </td>
                <td className="border p-1 text-right whitespace-nowrap">{peso(totals.packageAmount)}</td>
                <td className="border p-1" />
                <td className="border p-1 text-right whitespace-nowrap">{peso(totals.extensionAmount)}</td>
                <td className="border p-1" />
                <td className="border p-1 text-right whitespace-nowrap">{peso(totals.totalRoomAmount)}</td>
                <td className="border p-1 text-right whitespace-nowrap">{peso(totals.totalStoreAmount)}</td>
                <td className="border p-1 text-right whitespace-nowrap">{peso(totals.totalPaid)}</td>
                <td className="border p-1" colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {expenses.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-[11px] print:text-[8px]">
            <thead>
              <tr className="bg-muted">
                <th className="border p-1 text-left font-medium" colSpan={canRemoveExpenses ? 6 : 5}>
                  Expenses
                </th>
              </tr>
              <tr className="bg-muted">
                <th className="border p-1 text-left font-medium">Time</th>
                <th className="border p-1 text-left font-medium">Shift</th>
                <th className="border p-1 text-left font-medium">What for</th>
                <th className="border p-1 text-left font-medium">Staff</th>
                <th className="border p-1 text-right font-medium">Amount</th>
                {canRemoveExpenses && <th className="border p-1 print:hidden" />}
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => {
                const when = expense.recordedAt?.toDate?.() ?? null;
                return (
                  <tr key={expense.expenseId}>
                    <td className="border p-1 whitespace-nowrap">{time(when)}</td>
                    <td className="border p-1 whitespace-nowrap">{when ? shiftLabelForTime(when) : "—"}</td>
                    <td className="border p-1">{expense.description}</td>
                    <td className="border p-1 whitespace-nowrap">{expense.cashierName}</td>
                    <td className="border p-1 text-right whitespace-nowrap">{peso(expense.amount)}</td>
                    {canRemoveExpenses && (
                      <td className="border p-1 print:hidden">
                        <button
                          type="button"
                          className="text-xs text-destructive underline"
                          onClick={() => onRemoveExpense?.(expense.expenseId)}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted font-medium">
                <td className="border p-1" colSpan={4}>
                  Total expenses
                </td>
                <td className="border p-1 text-right whitespace-nowrap">{peso(expenseTotal)}</td>
                {canRemoveExpenses && <td className="border p-1 print:hidden" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-muted/50 p-3 text-sm">
        <div>
          <span className="text-muted-foreground">Cash collected</span>{" "}
          <span className="font-medium">{peso(totals.cashCollected)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Expenses</span>{" "}
          <span className="font-medium">{peso(expenseTotal)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Net cash</span>{" "}
          <span className="font-medium">{peso(netCash)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">GCash collected</span>{" "}
          <span className="font-medium">{peso(totals.gcashCollected)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">QRPh collected</span>{" "}
          <span className="font-medium">{peso(totals.qrphCollected)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Total collected</span>{" "}
          <span className="font-medium">{peso(totals.totalPaid)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Net after expenses</span>{" "}
          <span className="font-medium">{peso(netCollected)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border-2 border-foreground/20 bg-muted p-4">
        <div>
          <div className="text-base font-semibold">Overall Sale</div>
          {expenseTotal > 0 && (
            <div className="text-xs text-muted-foreground">
              Expenses {peso(expenseTotal)} deducted
            </div>
          )}
        </div>
        <div className="text-right">
          {expenseTotal > 0 && (
            <div className="text-sm text-muted-foreground line-through">{peso(overallSale)}</div>
          )}
          <span className="text-2xl font-bold">{peso(netSales)}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-8 text-xs">
        {["Prepared by", "Checked by", "Noted by"].map((label) => (
          <div key={label} className="flex flex-col items-center">
            <div className="h-14 w-full" />
            <div className="w-full border-t pt-1 text-center">&nbsp;</div>
            <div className="pt-1 text-center text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
