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
import { canCorrectSale, extensionDetails, planSaleCorrection, suggestExtensionRemoval, type SaleCorrectionInput } from "@/lib/sale-correction-plan";
import { correctHistoricalSale, loadSaleCorrection } from "@/lib/sale-corrections";
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
  const [reason, setReason] = useState("Extension added by mistake.");
  const [editDetails, setEditDetails] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<"mistake" | "received" | "">("");
  const [restoreStock, setRestoreStock] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const { submitting, guard } = useSubmitGuard();

  useEffect(() => {
    let cancelled = false;
    loadSaleCorrection(row.bookingId, branchId).then(loaded => {
      if (cancelled) return;
      setSale(loaded);
      const extension = extensionDetails(loaded.booking);
      if (loaded.booking.status === "voided" || !extension || (extension.hours === 0 && extension.amount === 0)) {
        setAction("duplicate");
        setReason("Duplicate booking entered by mistake.");
      }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this sale. Check your internet connection."); });
    return () => { cancelled = true; };
  }, [row.bookingId, branchId]);

  const extension = sale ? extensionDetails(sale.booking) : null;
  const suggestedRemoval = sale && extension ? suggestExtensionRemoval(sale.booking, sale.transactions, extension.amount - (editDetails ? Number(charge) : 0)) : null;
  const manualPayment = paymentChoice === "mistake" && suggestedRemoval === null;
  const input: SaleCorrectionInput | null = sale ? {
    action, extensionHours: editDetails ? Number(hours) : 0, extensionAmount: editDetails ? Number(charge) : 0,
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
  const readyToReview = action === "duplicate" || paymentChoice !== "";
  function change() { setConfirmed(false); }
  function choosePayment(choice: "mistake" | "received") {
    setPaymentChoice(choice);
    const split = choice === "mistake" && suggestedRemoval ? suggestedRemoval : { cash: 0, gcash: 0, qrph: 0 };
    setRemove({ cash: String(split.cash), gcash: String(split.gcash), qrph: String(split.qrph) });
    change();
  }
  function chooseAction(next: "extension" | "duplicate", edit = false) {
    setAction(next); setEditDetails(edit); setPaymentChoice(""); setConfirmed(false);
    setHours(String(edit ? extension?.hours ?? 0 : 0)); setCharge(String(edit ? extension?.amount ?? 0 : 0));
    setRemove({ cash: "0", gcash: "0", qrph: "0" });
    setReason(next === "duplicate" ? "Duplicate booking entered by mistake." : edit ? "Incorrect extension details." : "Extension added by mistake.");
  }
  async function save() {
    if (!input || !preview || !allowed || !confirmed || !readyToReview) return;
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
        <DialogTitle>Fix this sale · {row.refNumber}</DialogTitle>
        <DialogDescription>{branchLabel} · Room {row.roomNumber} · {row.checkInTime.toLocaleString("en-PH")}. You can fix this even after the shift ends.</DialogDescription>
      </DialogHeader>
      {!sale && !error && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading the latest booking and payments…</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sale && <fieldset disabled={submitting || !allowed} className="grid gap-4">
        {action === "extension" && extension && <>
          <div className="rounded-lg border bg-primary/5 p-3 text-sm">
            <p className="font-semibold">{editDetails ? "Change the extension" : "Remove the accidental extension"}</p>
            <p className="mt-1">{editDetails ? "Currently recorded:" : "This will remove:"} <strong>{extension.hours} extra hours · {peso(extension.amount)}</strong>.</p>
            <p className="mt-1 text-muted-foreground">The original {sale.booking.originalPackageHours}-hour booking stays. The guest&apos;s actual checkout time stays the same.</p>
          </div>
          {editDetails && <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="correct-ext-hours">Extra hours that should stay</Label><Input id="correct-ext-hours" type="number" min="0" max={extension.hours} step="0.5" value={hours} onChange={e => { setHours(e.target.value); setPaymentChoice(""); change(); }} /></div>
            <div className="grid gap-1.5"><Label htmlFor="correct-ext-charge">Extra charge that should stay</Label><Input id="correct-ext-charge" type="number" min="0" max={extension.amount} step="0.01" value={charge} onChange={e => { setCharge(e.target.value); setPaymentChoice(""); change(); }} /></div>
          </div>}
          <div className="grid gap-2">
            <p className="text-sm font-semibold">Did the guest actually pay the extra money?</p>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${paymentChoice === "mistake" ? "border-primary bg-primary/5" : ""}`}><input className="mt-1" type="radio" name="extension-money" checked={paymentChoice === "mistake"} onChange={() => choosePayment("mistake")} /><span><strong>No — it was only entered by mistake.</strong><span className="mt-1 block text-xs text-muted-foreground">Remove the incorrect extra payment from the sales report too.</span></span></label>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${paymentChoice === "received" ? "border-primary bg-primary/5" : ""}`}><input className="mt-1" type="radio" name="extension-money" checked={paymentChoice === "received"} onChange={() => choosePayment("received")} /><span><strong>Yes — the guest paid it.</strong><span className="mt-1 block text-xs text-muted-foreground">Keep the money recorded. This screen does not refund it.</span></span></label>
          </div>
          {paymentChoice === "mistake" && !manualPayment && <p className="text-sm text-primary">{METHODS.some(method => Number(remove[method]) > 0) ? `We will remove ${METHODS.filter(method => Number(remove[method]) > 0).map(method => `${peso(Number(remove[method]))} ${LABELS[method]}`).join(" + ")} from the payment record.` : "No extra payment needs removing. Only the extension charge will change."}</p>}
          {manualPayment && <div className="grid gap-2 rounded-lg border p-3"><p className="text-sm font-medium">Which payment amount was entered by mistake?</p><p className="text-xs text-muted-foreground">The payment history does not identify one clear amount. Enter the incorrect amount below so we do not remove a real payment.</p><div className="grid grid-cols-3 gap-3">{METHODS.map(method => <div key={method} className="grid gap-1.5"><Label htmlFor={`remove-${method}`}>{LABELS[method]}</Label><Input id={`remove-${method}`} type="number" min="0" step="0.01" value={remove[method]} onChange={e => { setRemove(current => ({ ...current, [method]: e.target.value })); change(); }} /></div>)}</div></div>}
        </>}
        {action === "duplicate" && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>This removes the entire sale, including the room, extensions, products and recorded payments. Use it only if the whole sale was a duplicate or entered by mistake.</p><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={restoreStock} onChange={e => { setRestoreStock(e.target.checked); change(); }} />Return cancelled products to stock</label><p className="mt-1 text-xs text-muted-foreground">Uncheck if those products were actually used or delivered. Missing catalogue items and unlimited items are not restocked.</p></div>}
        {preview && readyToReview && <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="mb-2 font-semibold">After saving, this sale will be {peso(preview.after.totalAmount)}.</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt>Stay hours</dt><dd>{preview.before.hoursBooked} → {preview.after.hoursBooked}</dd>
            <dt>Sale total</dt><dd>{peso(preview.before.totalAmount)} → {peso(preview.after.totalAmount)}</dd>
            <dt>Payment on record</dt><dd>{peso(preview.before.amountPaid)} → {peso(preview.after.amountPaid)}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">The original shift&apos;s totals will update automatically. A correction history is kept.</p>
          {preview.removedPayments.length > 0 && <details className="mt-3 border-t pt-2"><summary className="cursor-pointer text-xs">View payment details</summary>{preview.removedPayments.map(payment => <p key={payment.transactionId} className="mt-1 text-xs">{payment.timestamp.toDate().toLocaleString("en-PH")} · {METHODS.filter(method => payment[method] > 0).map(method => `${LABELS[method]} −${peso(payment[method])}`).join(" · ")}</p>)}</details>}
        </div>}
        {previewError && readyToReview && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
        <div className="grid gap-1.5"><Label htmlFor="sale-correction-reason">Why are you fixing this?</Label><Textarea id="sale-correction-reason" maxLength={500} value={reason} onChange={e => { setReason(e.target.value); change(); }} /></div>
        {readyToReview && <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I checked the new total above.</span></label>}
        <details className="border-t pt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Other correction options</summary><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!extension || sale.booking.status !== "checked_out" || sale.booking.openEnded} onClick={() => chooseAction("extension")}>Remove accidental extension</Button><Button variant="outline" disabled={!extension || sale.booking.status !== "checked_out" || sale.booking.openEnded} onClick={() => chooseAction("extension", true)}>Edit hours or price instead</Button><Button variant="outline" onClick={() => chooseAction("duplicate")}>Entire sale is a duplicate</Button></div></details>
      </fieldset>}
      <DialogFooter><Button variant="outline" disabled={submitting} onClick={onClose}>Cancel</Button><Button disabled={submitting || !allowed || !preview || !confirmed || !readyToReview || (manualPayment && !METHODS.some(method => Number(remove[method]) > 0)) || reason.trim().length < 5} onClick={() => void save()}>{submitting && <Loader2Icon className="size-4 animate-spin" />}{action === "duplicate" ? "Remove duplicate & update sales" : editDetails ? "Save changes & update sales" : "Remove extension & update sales"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
