"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { useBranch } from "@/context/branch-context";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchSaleCorrections } from "@/lib/sale-corrections";
import { referenceNumberFor } from "@/lib/receipt-printer";
import { visibleStaffName } from "@/lib/roles";
import type { SaleCorrection } from "@/lib/types";

export function SaleCorrectionHistoryDialog({ start, end, onClose }: { start: Date; end: Date; onClose: () => void }) {
  const { branchId, branchLabel } = useBranch();
  const [entries, setEntries] = useState<SaleCorrection[] | null>(null);
  const [error, setError] = useState("");
  const from = start.getTime();
  const to = end.getTime();
  useEffect(() => {
    let cancelled = false;
    fetchSaleCorrections(new Date(from), new Date(to), branchId).then(result => { if (!cancelled) setEntries(result); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load correction history."); });
    return () => { cancelled = true; };
  }, [from, to, branchId]);
  const peso = (amount: number) => `₱${amount.toFixed(2)}`;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Sale correction history</DialogTitle><DialogDescription>{branchLabel} · Bookings checked in during the selected report period. Removed duplicates remain recorded here.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!entries && !error && <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading correction history…</p>}
    {entries?.length === 0 && <p className="py-4 text-sm text-muted-foreground">No corrections for these bookings.</p>}
    {entries?.map(entry => <article key={entry.correctionId} className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>Room {entry.roomNumber} · {referenceNumberFor(entry.bookingId)}</strong><span className="text-xs text-muted-foreground">{entry.recordedAt.toDate().toLocaleString("en-PH")}</span></div>
      <p className="mt-2 font-medium">{entry.action === "duplicate" ? "Whole duplicate removed" : "Extension corrected"}</p>
      <p className="mt-1">Hours: {entry.before.hoursBooked} → {entry.after.hoursBooked} · Sale: {peso(entry.before.totalAmount)} → {peso(entry.after.totalAmount)} · Paid: {peso(entry.before.amountPaid)} → {peso(entry.after.amountPaid)}</p>
      <p className="mt-2 whitespace-pre-wrap">{entry.reason}</p>
      <p className="mt-2 text-xs text-muted-foreground">{visibleStaffName(entry.correctedByName, entry.correctedByRole) || "Authorized owner correction"}</p>
      {entry.removedPayments.map((payment, index) => <p key={index} className="mt-1 text-xs text-muted-foreground">Original collection: {payment.timestamp.toDate().toLocaleString("en-PH")} · Cash −{peso(payment.cash)} · GCash −{peso(payment.gcash)} · QRPh −{peso(payment.qrph)}</p>)}
      {entry.restockedItems.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Stock returned: {entry.restockedItems.reduce((sum, item) => sum + item.quantity, 0)} units across {entry.restockedItems.length} products.</p>}
    </article>)}
  </DialogContent></Dialog>;
}
