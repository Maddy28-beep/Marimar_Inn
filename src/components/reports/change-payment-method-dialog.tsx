"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import { paymentBreakdown } from "@/lib/bookings";
import {
  canChangePaymentMethod,
  changeBookingPaymentMethod,
  changeStoreSalePaymentMethod,
  fetchPaymentEvents,
  sumSplit,
  type NewPaymentSplit,
  type PaymentEvent,
} from "@/lib/payment-changes";
import type { DailySalesRow } from "@/lib/reports";
import type { PaymentPortions } from "@/lib/bookings";
import { Loader2Icon } from "lucide-react";

type Choice = "cash" | "gcash" | "qrph" | "split";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "qrph", label: "QRPh" },
  { value: "split", label: "Split" },
];

function peso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function describe(split: PaymentPortions): string {
  const parts: string[] = [];
  if (split.cash > 0.004) parts.push(`Cash ${peso(split.cash)}`);
  if (split.gcash > 0.004) parts.push(`GCash ${peso(split.gcash)}`);
  if (split.qrph > 0.004) parts.push(`QRPh ${peso(split.qrph)}`);
  return parts.join(" + ") || "—";
}

const TYPE_LABELS: Record<string, string> = {
  checkin: "Check-in",
  extend: "Extend",
  checkout: "Checkout",
  order: "Order",
  payment: "Payment",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fix a payment taken under the wrong method — e.g. recorded as cash but the
 * guest actually paid by QRPh. The amount is locked: only which method(s)
 * covered it can change, and the split must add up to the same total.
 */
export function ChangePaymentMethodDialog({
  row,
  onClose,
  onDone,
}: {
  row: DailySalesRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { appUser } = useAuth();
  const isStore = row.isStoreSale === true;
  const [events, setEvents] = useState<PaymentEvent[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("cash");
  const [splitCash, setSplitCash] = useState("");
  const [splitGcash, setSplitGcash] = useState("");
  const [splitQrph, setSplitQrph] = useState("");
  const [gcashRef, setGcashRef] = useState("");
  const [qrphRef, setQrphRef] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (isStore) {
          const split = paymentBreakdown({
            paymentMethod: row.paymentMethod,
            amountPaid: row.totalPaid,
            splitCashAmount: row.splitCashAmount,
            splitGcashAmount: row.splitGcashAmount,
            splitQrphAmount: row.splitQrphAmount,
          });
          const list: PaymentEvent[] = [
            {
              transactionId: row.bookingId,
              type: "payment",
              timestamp: row.checkInTime,
              split,
              amount: sumSplit(split),
            },
          ];
          if (!cancelled) {
            setEvents(list);
            setSelectedId(row.bookingId);
          }
          return;
        }
        const list = await fetchPaymentEvents(row.bookingId);
        if (!cancelled) {
          setEvents(list);
          if (list.length === 1) setSelectedId(list[0]!.transactionId);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [row, isStore]);

  const event = events?.find((e) => e.transactionId === selectedId) ?? null;
  const allowed = event ? canChangePaymentMethod(appUser?.role, event.timestamp) : true;

  function newSplit(): NewPaymentSplit | null {
    if (!event) return null;
    const amount = round2(event.amount);
    const base =
      choice === "cash"
        ? { cash: amount, gcash: 0, qrph: 0 }
        : choice === "gcash"
          ? { cash: 0, gcash: amount, qrph: 0 }
          : choice === "qrph"
            ? { cash: 0, gcash: 0, qrph: amount }
            : {
                cash: round2(Number(splitCash) || 0),
                gcash: round2(Number(splitGcash) || 0),
                qrph: round2(Number(splitQrph) || 0),
              };
    return { ...base, gcashReference: gcashRef, qrphReference: qrphRef };
  }

  const next = newSplit();
  const needsGcashRef = !!next && next.gcash > 0;
  const needsQrphRef = !!next && next.qrph > 0;
  const splitTotal = round2((Number(splitCash) || 0) + (Number(splitGcash) || 0) + (Number(splitQrph) || 0));
  const splitOk = choice !== "split" || (event !== null && Math.abs(splitTotal - event.amount) < 0.005);

  async function handleSave() {
    if (!event || !next || !appUser) return;
    setSaving(true);
    try {
      const actor = {
        uid: appUser.uid,
        name: appUser.displayName ?? appUser.email ?? "Staff",
        role: appUser.role,
      };
      if (isStore) {
        await changeStoreSalePaymentMethod(row.bookingId, next, actor);
      } else {
        await changeBookingPaymentMethod(row.bookingId, event.transactionId, next, actor);
      }
      toast.success("Payment method updated — the amount didn't change.");
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't change the payment method.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Change payment method — {isStore ? "Store sale" : `Room ${row.roomNumber}`}
          </DialogTitle>
          <DialogDescription>
            Only the method can change. The amount stays the same, and the change is recorded
            under your name.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-destructive">Couldn&apos;t load this payment — please try again.</p>
        ) : !events ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payment record was found for this booking, so its method can&apos;t be changed
            here. Ask the owner.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {events.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label>Which payment?</Label>
                <div className="flex flex-col gap-1.5">
                  {events.map((e) => (
                    <button
                      key={e.transactionId}
                      type="button"
                      onClick={() => setSelectedId(e.transactionId)}
                      className={
                        "rounded-lg border px-3 py-2 text-left text-sm " +
                        (e.transactionId === selectedId ? "border-primary bg-primary/5" : "")
                      }
                    >
                      <div className="font-medium">
                        {TYPE_LABELS[e.type] ?? e.type} ·{" "}
                        {e.timestamp.toLocaleString("en-PH", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-muted-foreground">
                        {peso(e.amount)} — {describe(e.split)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {event && (
              <>
                <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                  <div className="text-muted-foreground">Currently</div>
                  <div className="font-medium">
                    {peso(event.amount)} — {describe(event.split)}
                  </div>
                </div>

                {!allowed ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    This payment is from an earlier day — only the owner can change it.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label>Actually paid by</Label>
                      <div className="flex flex-wrap gap-2">
                        {CHOICES.map((c) => (
                          <Button
                            key={c.value}
                            type="button"
                            variant={choice === c.value ? "default" : "outline"}
                            onClick={() => setChoice(c.value)}
                            disabled={saving}
                          >
                            {c.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm font-semibold">
                      <span>Amount (can&apos;t be changed)</span>
                      <span>{peso(event.amount)}</span>
                    </div>

                    {choice === "split" && (
                      <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              ["Cash", splitCash, setSplitCash],
                              ["GCash", splitGcash, setSplitGcash],
                              ["QRPh", splitQrph, setSplitQrph],
                            ] as const
                          ).map(([label, value, setter]) => (
                            <div key={label} className="flex flex-col gap-1">
                              <Label className="text-xs">{label}</Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                disabled={saving}
                              />
                            </div>
                          ))}
                        </div>
                        <p className={"text-xs " + (splitOk ? "text-muted-foreground" : "text-destructive")}>
                          Combined {peso(splitTotal)} of {peso(event.amount)}
                          {splitOk ? "" : " — must add up to the same amount"}
                        </p>
                      </div>
                    )}

                    {needsGcashRef && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="chg-gcash-ref">GCash reference number</Label>
                        <Input
                          id="chg-gcash-ref"
                          value={gcashRef}
                          onChange={(e) => setGcashRef(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    )}
                    {needsQrphRef && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="chg-qrph-ref">QRPh reference number</Label>
                        <Input
                          id="chg-qrph-ref"
                          value={qrphRef}
                          onChange={(e) => setQrphRef(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !event || !allowed || !splitOk}>
            {saving && <Loader2Icon className="size-4 animate-spin" />}
            Save change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
