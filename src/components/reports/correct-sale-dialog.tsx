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
import { isAmenityItem } from "@/lib/booking-extras";
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
  const [action, setAction] = useState<SaleCorrectionInput["action"] | null>(null);
  const [productIndexes, setProductIndexes] = useState<number[]>([]);
  const [hours, setHours] = useState("0");
  const [charge, setCharge] = useState("0");
  const [remove, setRemove] = useState({ cash: "0", gcash: "0", qrph: "0" });
  const [reason, setReason] = useState("Extension added by mistake.");
  const [editDetails, setEditDetails] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<"mistake" | "received" | "">("");
  const [productChoice, setProductChoice] = useState<"not_given" | "given" | "">("");
  const [duplicateReason, setDuplicateReason] = useState("duplicate");
  const [confirmed, setConfirmed] = useState(false);
  const { submitting, guard } = useSubmitGuard();

  useEffect(() => {
    let cancelled = false;
    loadSaleCorrection(row.bookingId, branchId).then(loaded => {
      if (cancelled) return;
      setSale(loaded);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this sale. Check your internet connection."); });
    return () => { cancelled = true; };
  }, [row.bookingId, branchId]);

  const extension = sale ? extensionDetails(sale.booking) : null;
  const stockItems = (sale?.booking.items ?? []).filter(item => !isAmenityItem(item) && item.quantity > 0);
  const productsAnswered = (action !== "duplicate" && action !== "products") || stockItems.length === 0 || productChoice !== "";
  const selectedProductCharge = (sale?.booking.items ?? []).reduce((sum, item, index) => sum + (productIndexes.includes(index) ? item.subtotal : 0), 0);
  const reduction = action === "room" ? sale?.booking.totalRoomCharge ?? 0 : action === "products" ? selectedProductCharge : (extension?.amount ?? 0) - (editDetails ? Number(charge) : 0);
  const paidMethods = METHODS.filter(method => (sale?.booking[method === "cash" ? "splitCashAmount" : method === "gcash" ? "splitGcashAmount" : "splitQrphAmount"] ?? 0) > 0);
  // Only suggest a category payment when the whole sale was paid in one method.
  // Otherwise the owner identifies the incorrect amounts instead of guessing.
  const categorySuggestion = sale && sale.booking.amountPaid === sale.booking.totalAmount && paidMethods.length === 1
    ? { cash: 0, gcash: 0, qrph: 0, [paidMethods[0]]: reduction } : null;
  const suggestedRemoval = action === "extension" && sale && extension ? suggestExtensionRemoval(sale.booking, sale.transactions, reduction) : categorySuggestion;
  const manualPayment = paymentChoice === "mistake" && suggestedRemoval === null;
  const input: SaleCorrectionInput | null = sale && action ? {
    action, extensionHours: editDetails ? Number(hours) : 0, extensionAmount: editDetails ? Number(charge) : 0,
    productIndexes,
    removePayment: { cash: Number(remove.cash), gcash: Number(remove.gcash), qrph: Number(remove.qrph) },
    // Preview financial effects while the owner is still entering the reason.
    reason: reason.trim() || "Preview correction", expectedUpdatedAt: sale.booking.updatedAt.toMillis(),
    expectedCorrectionCount: sale.booking.saleCorrectionCount ?? 0, restoreStock: productChoice === "not_given",
  } : null;
  let preview: ReturnType<typeof planSaleCorrection> | null = null;
  let previewError = "";
  if (sale && input) {
    try { preview = planSaleCorrection(sale.booking, sale.transactions, input); }
    catch (cause) { previewError = cause instanceof Error ? cause.message : "Check the corrected values."; }
  }
  const allowed = canCorrectSale(appUser?.role);
  const readyToReview = action !== null && (action === "duplicate" || paymentChoice !== "");
  function change() { setConfirmed(false); }
  function choosePayment(choice: "mistake" | "received") {
    setPaymentChoice(choice);
    const split = choice === "mistake" && suggestedRemoval ? suggestedRemoval : { cash: 0, gcash: 0, qrph: 0 };
    setRemove({ cash: String(split.cash), gcash: String(split.gcash), qrph: String(split.qrph) });
    change();
  }
  function chooseAction(next: SaleCorrectionInput["action"], edit = false) {
    setAction(next); setEditDetails(edit); setPaymentChoice(""); setConfirmed(false);
    setProductChoice(""); setDuplicateReason("duplicate");
    setProductIndexes([]);
    setHours(String(edit ? extension?.hours ?? 0 : 0)); setCharge(String(edit ? extension?.amount ?? 0 : 0));
    setRemove({ cash: "0", gcash: "0", qrph: "0" });
    setReason(next === "duplicate" ? "The same sale was entered twice." : next === "room" ? "Room booking added by mistake." : next === "products" ? "Store products added by mistake." : edit ? "Incorrect extension details." : "Extension added by mistake.");
  }
  async function save() {
    if (!input || !preview || !allowed || !confirmed || !readyToReview || !productsAnswered) return;
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
        <DialogTitle>What do you want to void? · {row.refNumber}</DialogTitle>
        <DialogDescription>{branchLabel} · Room {row.roomNumber} · {row.checkInTime.toLocaleString("en-PH")}. You can fix this even after the shift ends.</DialogDescription>
      </DialogHeader>
      {!sale && !error && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Loading the latest booking and payments…</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sale && <fieldset disabled={submitting || !allowed} className="grid gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="What to void">
          {([
            { value: "extension", label: "Extra hours only", help: "Keep the room and store products.", disabled: !extension || (extension.hours === 0 && extension.amount === 0) || sale.booking.openEnded },
            { value: "room", label: "Room booking only", help: "Remove all room charges. Keep store products.", disabled: sale.booking.status === "voided" || sale.booking.totalRoomCharge <= 0 },
            { value: "products", label: "Store products only", help: "Choose the products. Keep the room booking.", disabled: stockItems.length === 0 },
            { value: "duplicate", label: "Everything", help: "Remove the room, extra hours and all products.", disabled: false },
          ] as const).map(option => <Button key={option.value} type="button" variant="outline" aria-pressed={action === option.value} disabled={option.disabled || sale.booking.voidReason === "duplicate"} className={`h-auto justify-start whitespace-normal p-3 text-left ${action === option.value ? "border-primary bg-primary/5" : ""}`} onClick={() => chooseAction(option.value)}><span><strong className="block">{option.label}</strong><span className="mt-1 block text-xs font-normal text-muted-foreground">{option.disabled ? "Nothing to void here." : option.help}</span></span></Button>)}
        </div>
        {!action && <p className="text-sm text-muted-foreground">Choose one above. Nothing changes until you save.</p>}
        {action === "room" && <div className="rounded-lg border p-3 text-sm"><p className="font-semibold">Void only the Room {row.roomNumber} booking</p><p className="mt-1">Remove {peso(reduction)} in room charges, including extra hours and extra-person charges. Store products and their charges will stay.</p><p className="mt-1 text-muted-foreground">This is an old booking. The room&apos;s current guest and status stay the same.</p></div>}
        {action === "products" && <div className="grid gap-2"><p className="text-sm font-semibold">Which products were added by mistake?</p>{sale.booking.items.map((item, index) => !isAmenityItem(item) && item.quantity > 0 && <label key={index} className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-1" checked={productIndexes.includes(index)} onChange={e => { setProductIndexes(current => e.target.checked ? [...current, index] : current.filter(value => value !== index)); setProductChoice(""); setPaymentChoice(""); setRemove({ cash: "0", gcash: "0", qrph: "0" }); change(); }} /><span>{item.quantity} × {item.name} · {peso(item.subtotal)}</span></label>)}<p className="text-xs text-muted-foreground">Only checked products will be removed. Room charges, towels and blankets stay.</p></div>}
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
        </>}
        {action && action !== "duplicate" && (action !== "products" || productIndexes.length > 0) && <>
          <div className="grid gap-2">
            <p className="text-sm font-semibold">{action === "extension" ? "Did the guest actually pay the extra money?" : "Was a payment also entered by mistake?"}</p>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${paymentChoice === "mistake" ? "border-primary bg-primary/5" : ""}`}><input className="mt-1" type="radio" name="extension-money" checked={paymentChoice === "mistake"} onChange={() => choosePayment("mistake")} /><span><strong>{action === "extension" ? "No — it was only entered by mistake." : "Yes, remove the wrong payment too."}</strong><span className="mt-1 block text-xs text-muted-foreground">Remove only money that was never collected.</span></span></label>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${paymentChoice === "received" ? "border-primary bg-primary/5" : ""}`}><input className="mt-1" type="radio" name="extension-money" checked={paymentChoice === "received"} onChange={() => choosePayment("received")} /><span><strong>{action === "extension" ? "Yes — the guest paid it." : "No, keep the payment on record."}</strong><span className="mt-1 block text-xs text-muted-foreground">Keep money that was really collected. No refund is sent.</span></span></label>
          </div>
          {paymentChoice === "mistake" && !manualPayment && <p className="text-sm text-primary">{METHODS.some(method => Number(remove[method]) > 0) ? `We will remove ${METHODS.filter(method => Number(remove[method]) > 0).map(method => `${peso(Number(remove[method]))} ${LABELS[method]}`).join(" + ")} from the payment record.` : "No payment needs removing. Only the charge will change."}</p>}
          {manualPayment && <div className="grid gap-2 rounded-lg border p-3"><p className="text-sm font-medium">Which payment amount was entered by mistake?</p><p className="text-xs text-muted-foreground">The payment history does not identify one clear amount. Enter the incorrect amount below so we do not remove a real payment.</p><div className="grid grid-cols-3 gap-3">{METHODS.map(method => <div key={method} className="grid gap-1.5"><Label htmlFor={`remove-${method}`}>{LABELS[method]}</Label><Input id={`remove-${method}`} type="number" min="0" step="0.01" value={remove[method]} onChange={e => { setRemove(current => ({ ...current, [method]: e.target.value })); change(); }} /></div>)}</div></div>}
        </>}
        {action === "duplicate" && <>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-semibold">Nothing has changed yet.</p>
            <p className="mt-1">Void means cancel this old Room {row.roomNumber} booking and remove its whole sale from the totals.</p>
            <p className="mt-2 text-muted-foreground">Use this if the whole booking was a mistake or was added twice. Today&apos;s guest and room status will stay the same.</p>
          </div>
        </>}
        {(action === "duplicate" || action === "products") && <>
          {stockItems.length > 0 ? <div className="grid gap-2">
            <p className="text-sm font-semibold">Did the guest get these items?</p>
            <p className="text-xs text-muted-foreground">This question is only about stock. It does not save or cancel anything yet.</p>
            <p className="text-xs text-muted-foreground">{(sale.booking.items ?? []).filter((item, index) => !isAmenityItem(item) && (action === "duplicate" || productIndexes.includes(index))).map(item => `${item.quantity} × ${item.name}`).join(", ") || "Choose products above first."}</p>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${productChoice === "not_given" ? "border-primary bg-primary/5" : ""}`}><input className="mt-1" type="radio" name="duplicate-products" checked={productChoice === "not_given"} onChange={() => { setProductChoice("not_given"); change(); }} /><span><strong>No, the guest did not get them.</strong><span className="mt-1 block text-xs text-muted-foreground">Add them back to stock when I save.</span></span></label>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${productChoice === "given" ? "border-primary bg-primary/5" : ""}`}><input className="mt-1" type="radio" name="duplicate-products" checked={productChoice === "given"} onChange={() => { setProductChoice("given"); change(); }} /><span><strong>Yes, the guest got them.</strong><span className="mt-1 block text-xs text-muted-foreground">Do not add them back to stock.</span></span></label>
          </div> : <p className="text-sm text-muted-foreground">No tracked product entries on this sale. Stock will stay the same.</p>}
        </>}
        {preview && readyToReview && <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="mb-2 font-semibold">{action === "duplicate" ? "After you press the void button:" : `After saving, this sale will be ${peso(preview.after.totalAmount)}.`}</p>
          {action === "duplicate" ? <ul className="grid list-disc gap-1 pl-5">
            <li>This old Room {row.roomNumber} booking will be cancelled (voided).</li>
            <li>Sales will go down by {peso(preview.before.totalAmount)}. The old shift report will update too.</li>
            <li>Payments on record will go down by {peso(preview.before.amountPaid)}. No money is sent back to the guest.</li>
            {stockItems.length > 0 && productChoice && <li>{productChoice === "not_given" ? "Items we can track will be added back to stock." : "Stock will stay the same."}</li>}
          </ul> : <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            {action === "extension" && <><dt>Stay hours</dt><dd>{preview.before.hoursBooked} → {preview.after.hoursBooked}</dd></>}
            <dt>Sale total</dt><dd>{peso(preview.before.totalAmount)} → {peso(preview.after.totalAmount)}</dd>
            <dt>Payment on record</dt><dd>{peso(preview.before.amountPaid)} → {peso(preview.after.amountPaid)}</dd>
          </dl>
          {action === "room" && <p className="mt-2 font-medium">The room booking will be voided. Store products stay.</p>}
          {action === "products" && <p className="mt-2 font-medium">Only the checked products will be removed. The room booking stays as it is.</p>}
          <p className="mt-2 text-xs text-muted-foreground">The original shift&apos;s totals will update automatically. A correction history is kept.</p>
          </>}
          {action === "duplicate" && <p className="mt-2 text-xs text-muted-foreground">We keep a record of who made this change and why.</p>}
          {preview.removedPayments.length > 0 && <details className="mt-3 border-t pt-2"><summary className="cursor-pointer text-xs">View payment details</summary>{preview.removedPayments.map(payment => <p key={payment.transactionId} className="mt-1 text-xs">{payment.timestamp.toDate().toLocaleString("en-PH")} · {METHODS.filter(method => payment[method] > 0).map(method => `${LABELS[method]} −${peso(payment[method])}`).join(" · ")}</p>)}</details>}
        </div>}
        {previewError && readyToReview && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
        {action && (action === "duplicate" ? <div className="grid gap-1.5"><Label htmlFor="duplicate-reason">Why remove this sale?</Label><select id="duplicate-reason" className="h-10 w-full rounded-lg border bg-card px-3 text-sm" value={duplicateReason} onChange={e => { const choice = e.target.value; setDuplicateReason(choice); setReason(choice === "duplicate" ? "The same sale was entered twice." : choice === "mistake" ? "This sale was entered by mistake." : ""); change(); }}><option value="duplicate">The same sale was entered twice</option><option value="mistake">This sale was entered by mistake</option><option value="other">Another reason</option></select>{duplicateReason === "other" && <><Label className="mt-2" htmlFor="sale-correction-reason">Tell us why</Label><Textarea id="sale-correction-reason" maxLength={500} value={reason} onChange={e => { setReason(e.target.value); change(); }} /></>}</div> : <div className="grid gap-1.5"><Label htmlFor="sale-correction-reason">Why are you fixing this?</Label><Textarea id="sale-correction-reason" maxLength={500} value={reason} onChange={e => { setReason(e.target.value); change(); }} /></div>)}
        {readyToReview && <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{action === "duplicate" ? "I want to cancel this booking and its whole sale." : "I checked the new total above."}</span></label>}
        {action === "duplicate" && <p className="text-sm font-medium" role="status">{!productsAnswered ? "First, answer the items question above." : !confirmed ? "To continue: tick the box above, then press “Void booking & sale”." : "To save this change, press “Void booking & sale” below."}</p>}
        {action === "extension" && <Button variant="outline" onClick={() => chooseAction("extension", !editDetails)}>{editDetails ? "Remove all extra hours instead" : "Change only some extra hours or their price"}</Button>}
      </fieldset>}
      <DialogFooter><Button variant="outline" disabled={submitting} onClick={onClose}>Cancel</Button>{action && <Button variant={action === "duplicate" || action === "room" ? "destructive" : "default"} disabled={submitting || !allowed || !preview || !confirmed || !readyToReview || !productsAnswered || (manualPayment && !METHODS.some(method => Number(remove[method]) > 0)) || reason.trim().length < 5} onClick={() => void save()}>{submitting && <Loader2Icon className="size-4 animate-spin" />}{action === "duplicate" ? "Void booking & sale" : action === "room" ? "Void room only" : action === "products" ? "Void checked products" : editDetails ? "Save changes & update sales" : "Remove extension & update sales"}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
