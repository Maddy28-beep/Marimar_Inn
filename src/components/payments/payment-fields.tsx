"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";
import type { PaymentPortions } from "@/lib/bookings";
import { paymentPortionLines } from "@/lib/bookings";

export interface PaymentDraft {
  method: PaymentMethod;
  amountPaid: string;
  gcashReference: string;
  qrphReference: string;
  splitCash: string;
  splitGcash: string;
  splitQrph: string;
}

export function emptyPaymentDraft(): PaymentDraft {
  return {
    method: "cash",
    amountPaid: "",
    gcashReference: "",
    qrphReference: "",
    splitCash: "",
    splitGcash: "",
    splitQrph: "",
  };
}

export function collectedAmount(draft: PaymentDraft, due: number): number {
  if (draft.method === "gcash" || draft.method === "qrph") return due;
  if (draft.method === "split") {
    return (
      (Number(draft.splitCash) || 0) +
      (Number(draft.splitGcash) || 0) +
      (Number(draft.splitQrph) || 0)
    );
  }
  return Number(draft.amountPaid) || 0;
}

export function cashCollectedNow(draft: PaymentDraft, due: number): number {
  if (draft.method === "cash") return collectedAmount(draft, due);
  if (draft.method === "split") return Number(draft.splitCash) || 0;
  return 0;
}

export function paymentPayload(draft: PaymentDraft, due: number) {
  const amount = Math.min(collectedAmount(draft, due), due);
  const splitCash = Number(draft.splitCash) || 0;
  const splitGcash = Number(draft.splitGcash) || 0;
  const splitQrph = Number(draft.splitQrph) || 0;
  const usesGcash = draft.method === "gcash" || (draft.method === "split" && splitGcash > 0);
  const usesQrph = draft.method === "qrph" || (draft.method === "split" && splitQrph > 0);
  return {
    paymentMethod: draft.method,
    amountPaid: amount,
    gcashReference: usesGcash ? draft.gcashReference.trim() || undefined : undefined,
    qrphReference: usesQrph ? draft.qrphReference.trim() || undefined : undefined,
    splitCashAmount: draft.method === "split" ? splitCash : undefined,
    splitGcashAmount: draft.method === "split" ? splitGcash : undefined,
    splitQrphAmount: draft.method === "split" ? splitQrph : undefined,
  };
}

interface PaymentFieldsProps {
  draft: PaymentDraft;
  onChange: (draft: PaymentDraft) => void;
  due: number;
  disabled?: boolean;
  idPrefix?: string;
}

export function PaymentFields({
  draft,
  onChange,
  due,
  disabled,
  idPrefix = "pay",
}: PaymentFieldsProps) {
  const paid = collectedAmount(draft, due);
  const change = paid > due ? paid - due : 0;
  const showGcashRef = draft.method === "gcash" || (draft.method === "split" && (Number(draft.splitGcash) || 0) > 0);
  const showQrphRef = draft.method === "qrph" || (draft.method === "split" && (Number(draft.splitQrph) || 0) > 0);

  function patch(partial: Partial<PaymentDraft>) {
    onChange({ ...draft, ...partial });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-base font-bold">Payment method</Label>
        <Select
          value={draft.method}
          onValueChange={(v) => patch({ method: v as PaymentMethod })}
          disabled={disabled}
        >
          <SelectTrigger className="h-11 w-full text-base font-semibold">
            <SelectValue>{PAYMENT_METHOD_LABELS[draft.method]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showGcashRef && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-gcash-ref`}>GCash reference number</Label>
          <Input
            id={`${idPrefix}-gcash-ref`}
            value={draft.gcashReference}
            onChange={(e) => patch({ gcashReference: e.target.value })}
            placeholder="e.g. 1234 567 890123"
            disabled={disabled}
          />
        </div>
      )}

      {showQrphRef && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-qrph-ref`}>QRPh reference number</Label>
          <Input
            id={`${idPrefix}-qrph-ref`}
            value={draft.qrphReference}
            onChange={(e) => patch({ qrphReference: e.target.value })}
            placeholder="e.g. 1234 567 890123"
            disabled={disabled}
          />
        </div>
      )}

      {draft.method === "gcash" || draft.method === "qrph" ? (
        <div className="flex flex-col gap-1.5">
          <Label className="text-base font-bold">Amount paid</Label>
          <div className="flex h-11 items-center rounded-lg border-2 bg-muted px-3 text-base font-semibold text-foreground">
            Full amount — ₱{due.toFixed(2)} via {PAYMENT_METHOD_LABELS[draft.method]}
          </div>
        </div>
      ) : draft.method === "split" ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-split-cash`} className="text-base font-bold">Cash amount</Label>
              <Input
                id={`${idPrefix}-split-cash`}
                type="number"
                min={0}
                value={draft.splitCash}
                onChange={(e) => patch({ splitCash: e.target.value })}
                disabled={disabled}
                className="h-11 border-2 text-base font-semibold"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-split-gcash`} className="text-base font-bold">GCash amount</Label>
              <Input
                id={`${idPrefix}-split-gcash`}
                type="number"
                min={0}
                value={draft.splitGcash}
                onChange={(e) => patch({ splitGcash: e.target.value })}
                disabled={disabled}
                className="h-11 border-2 text-base font-semibold"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-split-qrph`} className="text-base font-bold">QRPh amount</Label>
              <Input
                id={`${idPrefix}-split-qrph`}
                type="number"
                min={0}
                value={draft.splitQrph}
                onChange={(e) => patch({ splitQrph: e.target.value })}
                disabled={disabled}
                className="h-11 border-2 text-base font-semibold"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Combined</span>
            <span>
              ₱{paid.toFixed(2)} of ₱{due.toFixed(2)}
              {change > 0 ? ` · ₱${change.toFixed(2)} change` : ""}
            </span>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-amount`} className="text-base font-bold">Amount paid</Label>
            <Input
              id={`${idPrefix}-amount`}
              type="number"
              min={0}
              step="0.01"
              value={draft.amountPaid}
              onChange={(e) => patch({ amountPaid: e.target.value })}
              disabled={disabled}
              className="h-11 border-2 text-base font-semibold"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-base font-bold">Change</Label>
            <div className="flex h-11 items-center text-base font-semibold">₱{change.toFixed(2)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PaymentBreakdownDisplay({
  portions,
  method,
  amountPaid,
  gcashReference,
  qrphReference,
  change,
}: {
  portions: PaymentPortions;
  method: PaymentMethod;
  amountPaid: number;
  gcashReference?: string;
  qrphReference?: string;
  change?: number;
}) {
  const lines = paymentPortionLines(portions);
  return (
    <>
      {lines.length > 1 ? (
        lines.map((line) => (
          <div key={line.label} className="flex justify-between text-muted-foreground">
            <span>Paid via {line.label}</span>
            <span>₱{line.amount.toFixed(2)}</span>
          </div>
        ))
      ) : (
        <div className="flex justify-between text-muted-foreground">
          <span>Paid via {PAYMENT_METHOD_LABELS[method]}</span>
          <span>₱{amountPaid.toFixed(2)}</span>
        </div>
      )}
      {gcashReference && (
        <div className="flex justify-between text-muted-foreground">
          <span>GCash Ref</span>
          <span>{gcashReference}</span>
        </div>
      )}
      {qrphReference && (
        <div className="flex justify-between text-muted-foreground">
          <span>QRPh Ref</span>
          <span>{qrphReference}</span>
        </div>
      )}
      {(change ?? 0) > 0 && (
        <div className="flex justify-between text-muted-foreground">
          <span>Change</span>
          <span>₱{change!.toFixed(2)}</span>
        </div>
      )}
    </>
  );
}
