"use client";

import { PAYMENT_METHOD_LABELS } from "@/lib/types";
import type { DailySalesReport } from "@/lib/reports";

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

export function DailySalesTable({ report }: { report: DailySalesReport }) {
  const { rows, totals } = report;

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
                    {row.paymentMethod === "split"
                      ? `Cash ${peso(row.splitCashAmount ?? 0)} + GCash ${peso(row.splitGcashAmount ?? 0)}`
                      : PAYMENT_METHOD_LABELS[row.paymentMethod]}
                    {row.gcashReference ? ` (${row.gcashReference})` : ""}
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

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-muted/50 p-3 text-sm">
        <div>
          <span className="text-muted-foreground">Cash collected</span>{" "}
          <span className="font-medium">{peso(totals.cashCollected)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">GCash collected</span>{" "}
          <span className="font-medium">{peso(totals.gcashCollected)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Total collected</span>{" "}
          <span className="font-medium">{peso(totals.totalPaid)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border-2 border-foreground/20 bg-muted p-4">
        <span className="text-base font-semibold">Overall Sale</span>
        <span className="text-2xl font-bold">
          {peso(totals.totalRoomAmount + totals.totalStoreAmount)}
        </span>
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
