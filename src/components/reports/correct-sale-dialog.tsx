"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useBranch } from "@/context/branch-context";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canCorrectSale, extensionDetails, planSaleCorrection, roundMoney, type SaleCorrectionInput } from "@/lib/sale-correction-plan";
import { correctHistoricalSale, loadSaleCorrection } from "@/lib/sale-corrections";
import { paymentBreakdown } from "@/lib/bookings";
import type { DailySalesRow } from "@/lib/reports";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHODS = ["cash", "gcash", "qrph"] as const;
const LABELS = { cash: "Cash", gcash: "GCash", qrph: "QRPh" };
type LoadedSale = Awaited<ReturnType<typeof loadSaleCorrection>>;

export function CorrectSaleDialog({ row, onClose, onDone }: { row: DailySalesRow; onClose: () => void; onDone: () => void }) {
  const { appUser } = useAuth();
  const { branchId, branchLabel } = useBranch();
  const [sale, setSale] = useState<LoadedSale | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<SaleCorrectionInput["action"]>(row.voided ? "duplicate" : "extension");
  const [hours, setHours] = useState("0");
  const [charge, setCharge] = useState("0");
  const [remove, setRemove] = useState({ cash: "0", gcash: "0", qrph: "0" });
  const [reason, setReason] = useState("");
  const [restoreStock, setRestoreStock] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const { submitting, guard } = useSubmitGuard();

  useEffect(() => {
    let cancelled = false;
    loadSaleCorrection(row.bookingId, branchId).then(loaded => {
      if (cancelled) return;
      setSale(loaded);
      const extension = extensionDetails(loaded.booking);
      const paid = paymentBreakdown(loaded.booking);
      const used = METHODS.filter(method => paid[method] > 0);
      if (extension && used.length === 1) {
        const method = used[0];
        setRemove({ cash: "0", gcash: "0", qrph: "0", [method]: String(roundMoney(Math.min(extension.amount, paid[method]))) });
      }
      if (loaded.booking.status === "voided" || !extension || (extension.hours === 0 && extension.amount === 0)) setAction("duplicate");
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this sale. Check your internet connection."); });
    return () => { cancelled = true; };
  }, [row.bookingId, branchId]);

  const extension = sale ? extensionDetails(sale.booking) : null;
  const input: SaleCorrectionInput | null = sale ? {
    action, extensionHours: Number(hours), extensionAmount: Number(charge),
    removePayment: { cash: Number(remove.cash), gcash: Number(remove.gcash), qrph: Number(remove.qrph) },
    // Preview financial effects while the owner is still entering the reason.
    reason: reason.trim() || "Preview correction", expectedUpdatedAt: sale.booking.updatedAt.toMillis(),
    expectedCorrectionCount: sale.booking.saleCorrectionCount ?? 0, restoreStock,
  } : null;
  let preview: ReturnType<typeof planSaleCorrection> | null = null;
  let previewError = "";
  if (sale && input) {
    try { preview = planSaleCorrection(sale.booking, sale.transactions, input); }
    catch (cause) { previewError = cause instanceof Error ? cause.message : "Check the corrected values."; }
  }
  const allowed = canCorrectSale(appUser?.role);
  function change() { setConfirmed(false); }
  async function save() {
    if (!input || !preview || !allowed || !confirmed) return;
    await guard(async () => {
      try {
        await correctHistoricalSale(row.bookingId, { ...input, reason: reason.trim() }, branchId);
        toast.success("Sale corrected. The original shift's sales and payment totals have been updated.");
        onDone();
        onClose();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Correction failed. No changes were saved.");
      }
    });
  }

  return <Dialog open onOpenChange={open => { if (!open && !submitting) onClose(); }}>
    <DialogContent className="sm:max-w-2xl" showCloseButton={!submitting}>
      <DialogHeader>
        <DialogTitle>Correct sale · {row.refNumber}</DialogTitle>
        <DialogDescription>{branchLabel} · Room {row.roomNumber} · {row.checkInTime.toLocaleString("en-PH")}. Corrections are allowed after the shift ends and are permanently recorded.</DialogDescription>
      </DialogHeader>
      {!sale && !error && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading the latest booking and payments…</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sale && <fieldset disabled={submitting || !allowed} className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant={action === "extension" ? "default" : "outline"} disabled={!extension || sale.booking.status !== "checked_out" || sale.booking.openEnded} onClick={() => { setAction("extension"); change(); }}>Correct extension</Button>
          <Button variant={action === "duplicate" ? "destructive" : "outline"} onClick={() => { setAction("duplicate"); change(); }}>Remove whole duplicate</Button>
        </div>
        {action === "extension" && extension && <>
          <p className="text-sm">Recorded extension: <strong>{extension.hours} hours · {peso(extension.amount)}</strong>. Set both values to zero to remove it. The original package and actual checkout time stay unchanged.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="correct-ext-hours">Correct extension hours</Label><Input id="correct-ext-hours" type="number" min="0" max={extension.hours} step="0.5" value={hours} onChange={e => { setHours(e.target.value); change(); }} /></div>
            <div className="grid gap-1.5"><Label htmlFor="correct-ext-charge">Correct extension charge</Label><Input id="correct-ext-charge" type="number" min="0" max={extension.amount} step="0.01" value={charge} onChange={e => { setCharge(e.target.value); change(); }} /></div>
          </div>
          <div className="grid gap-2"><p className="text-sm font-medium">Remove incorrectly recorded payment</p><p className="text-xs text-muted-foreground">Enter only money that was recorded by mistake. Leave zero if the money was actually collected; this action does not issue a refund.</p>
            <div className="grid grid-cols-3 gap-3">{METHODS.map(method => <div key={method} className="grid gap-1.5"><Label htmlFor={`remove-${method}`}>{LABELS[method]}</Label><Input id={`remove-${method}`} type="number" min="0" step="0.01" value={remove[method]} onChange={e => { setRemove(current => ({ ...current, [method]: e.target.value })); change(); }} /></div>)}</div>
          </div>
        </>}
        {action === "duplicate" && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>This removes the entire sale, including the room, extensions, products and recorded payments. Use it only if the whole sale was a duplicate or entered by mistake.</p><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={restoreStock} onChange={e => { setRestoreStock(e.target.checked); change(); }} />Return cancelled products to stock</label><p className="mt-1 text-xs text-muted-foreground">Uncheck if those products were actually used or delivered. Missing catalogue items and unlimited items are not restocked.</p></div>}
        {preview && <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="mb-2 font-semibold">Before → After</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt>Booked hours</dt><dd>{preview.before.hoursBooked} → {preview.after.hoursBooked}</dd>
            <dt>Room charge</dt><dd>{peso(preview.before.totalRoomCharge)} → {peso(preview.after.totalRoomCharge)}</dd>
            <dt>Total sale</dt><dd>{peso(preview.before.totalAmount)} → {peso(preview.after.totalAmount)}</dd>
            <dt>Recorded paid</dt><dd>{peso(preview.before.amountPaid)} → {peso(preview.after.amountPaid)}</dd>
          </dl>
          {preview.removedPayments.length > 0 && <div className="mt-3 border-t pt-2"><p className="font-medium">Original payment entries being reversed</p>{preview.removedPayments.map(payment => <p key={payment.transactionId} className="mt-1 text-xs">{payment.timestamp.toDate().toLocaleString("en-PH")} · {METHODS.filter(method => payment[method] > 0).map(method => `${LABELS[method]} −${peso(payment[method])}`).join(" · ")}</p>)}<p className="mt-2 text-xs text-muted-foreground">These corrections reduce the original collection shifts, even when those shifts have already ended.</p></div>}
        </div>}
        {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
        <div className="grid gap-1.5"><Label htmlFor="sale-correction-reason">Reason for correction</Label><Textarea id="sale-correction-reason" maxLength={500} placeholder="For example: cashier accidentally added a 3-hour extension; guest paid only ₱200." value={reason} onChange={e => { setReason(e.target.value); change(); }} /></div>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I checked the before/after amounts and payment entries. Save this correction to the original reports.</span></label>
      </fieldset>}
      <DialogFooter><Button variant="outline" disabled={submitting} onClick={onClose}>Cancel</Button><Button disabled={submitting || !allowed || !preview || !confirmed || reason.trim().length < 5} onClick={() => void save()}>{submitting && <Loader2Icon className="size-4 animate-spin" />}Save correction</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
