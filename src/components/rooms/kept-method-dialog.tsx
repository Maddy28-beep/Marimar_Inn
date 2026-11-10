"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { KeptMethod } from "@/lib/bookings";

const LABELS: Record<KeptMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  qrph: "QRPh",
};

/**
 * A room-only void keeps the store items on the books, so part of what the
 * guest paid stays as real revenue. When more than one payment method could
 * have covered it, ask rather than guess — the answer is recorded on the
 * booking and the reports use it instead of an estimate.
 */
export function KeptMethodDialog({
  amount,
  choices,
  busy,
  onChoose,
  onCancel,
}: {
  amount: number;
  choices: KeptMethod[];
  busy?: boolean;
  onChoose: (method: KeptMethod) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How were the store items paid?</DialogTitle>
          <DialogDescription>
            Cancelling the room keeps the store items (₱
            {amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            ) on the sales report. Pick the payment method that actually covered them so the cash
            and QRPh totals stay correct.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {choices.map((method) => (
            <Button key={method} variant="outline" disabled={busy} onClick={() => onChoose(method)}>
              {LABELS[method]}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
