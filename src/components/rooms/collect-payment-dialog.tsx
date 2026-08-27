"use client";

import { useState } from "react";
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
import { collectBalance } from "@/lib/bookings";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { useAuth } from "@/context/auth-context";
import {
  printBalancePaymentReceipt,
  previewBalancePaymentReceipt,
  printerErrorMessage,
  referenceNumberFor,
  kickDrawerForCashPayment,
  staffFirstName,
} from "@/lib/receipt-printer";
import {
  cashCollectedNow,
  collectedAmount,
  emptyPaymentDraft,
  PaymentBreakdownDisplay,
  PaymentFields,
  paymentPayload,
  type PaymentDraft,
} from "@/components/payments/payment-fields";
import { ReceiptBrandHeader } from "@/components/receipt-brand-header";
import { ReceiptPreviewStrip } from "@/components/receipt-preview";
import type { Booking, PaymentMethod, Room } from "@/lib/types";
import { Loader2Icon, PrinterIcon } from "lucide-react";

interface CollectPaymentDialogProps {
  room: Room;
  booking: Booking;
  balance: number;
  onClose: () => void;
}

export function CollectPaymentDialog({ room, booking, balance, onClose }: CollectPaymentDialogProps) {
  const { appUser } = useAuth();
  const printer = useReceiptPrinter();
  const staffName = appUser?.displayName ?? appUser?.email ?? "Staff";
  const [payment, setPayment] = useState<PaymentDraft>(() => ({
    ...emptyPaymentDraft(),
    amountPaid: balance.toFixed(2),
  }));
  const { submitting, guard } = useSubmitGuard();
  const [phase, setPhase] = useState<"form" | "receipt">("form");
  const [receipt, setReceipt] = useState<{
    amountCollected: number;
    remainingBalance: number;
    change: number;
    paymentMethod: PaymentMethod;
    gcashReference?: string;
    qrphReference?: string;
    splitCashAmount?: number;
    splitGcashAmount?: number;
    splitQrphAmount?: number;
  } | null>(null);

  const paid = collectedAmount(payment, balance);
  const change = paid > balance ? paid - balance : 0;

  async function handleSubmit() {
    if (paid <= 0) {
      toast.error("Enter an amount to collect.");
      return;
    }
    await guard(submitPayment);
  }

  async function submitPayment() {
    if (!appUser) return;
    const payload = paymentPayload(payment, balance);
    try {
      const result = await collectBalance(
        booking,
        payload.amountPaid,
        {
          paymentMethod: payload.paymentMethod,
          gcashReference: payload.gcashReference,
          qrphReference: payload.qrphReference,
          splitCashAmount: payload.splitCashAmount,
          splitGcashAmount: payload.splitGcashAmount,
          splitQrphAmount: payload.splitQrphAmount,
        },
        { uid: appUser.uid, name: staffName }
      );
      toast.success(`₱${result.amountCollected.toFixed(2)} collected.`);
      if (printer.connected) {
        try {
          await kickDrawerForCashPayment(cashCollectedNow(payment, balance));
        } catch (error) {
          toast.error(`Collected, but the drawer said: ${printerErrorMessage(error)}`);
        }
      }
      setReceipt({
        amountCollected: result.amountCollected,
        remainingBalance: result.balance,
        change,
        paymentMethod: payload.paymentMethod,
        gcashReference: payload.gcashReference,
        qrphReference: payload.qrphReference,
        splitCashAmount: payload.splitCashAmount,
        splitGcashAmount: payload.splitGcashAmount,
        splitQrphAmount: payload.splitQrphAmount,
      });
      setPhase("receipt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't collect payment.");
    }
  }

  async function printThermalCopy() {
    if (!printer.connected || !receipt) return;
    try {
      await printBalancePaymentReceipt(booking, room, {
        staffName,
        amountCollected: receipt.amountCollected,
        remainingBalance: receipt.remainingBalance,
        change: receipt.change,
        paymentMethod: receipt.paymentMethod,
        gcashReference: receipt.gcashReference,
        qrphReference: receipt.qrphReference,
        splitCashAmount: receipt.splitCashAmount,
        splitGcashAmount: receipt.splitGcashAmount,
        splitQrphAmount: receipt.splitQrphAmount,
      });
    } catch (error) {
      toast.error(printerErrorMessage(error));
    }
  }

  if (phase === "receipt" && receipt) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Payment collected</DialogTitle>
            <DialogDescription>
              Room {room.roomNumber} — hand this receipt to the guest.
            </DialogDescription>
          </DialogHeader>

          <div className="print-area flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <ReceiptBrandHeader
              subtitle="Balance Payment"
              reference={referenceNumberFor(booking.bookingId)}
            />
            <div className="my-1 border-t" />
            <div className="flex justify-between">
              <span>Room</span>
              <span>{room.roomNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Guest</span>
              <span>{booking.guestName}</span>
            </div>
            <div className="my-1 border-t" />
            <PaymentBreakdownDisplay
              portions={{
                cash: receipt.splitCashAmount ?? (receipt.paymentMethod === "cash" ? receipt.amountCollected : 0),
                gcash: receipt.splitGcashAmount ?? (receipt.paymentMethod === "gcash" ? receipt.amountCollected : 0),
                qrph: receipt.splitQrphAmount ?? (receipt.paymentMethod === "qrph" ? receipt.amountCollected : 0),
              }}
              method={receipt.paymentMethod}
              amountPaid={receipt.amountCollected}
              gcashReference={receipt.gcashReference}
              qrphReference={receipt.qrphReference}
              change={receipt.change}
            />
            {receipt.remainingBalance > 0 && (
              <div className="flex justify-between font-medium text-amber-600 dark:text-amber-400">
                <span>Remaining balance</span>
                <span>₱{receipt.remainingBalance.toFixed(2)}</span>
              </div>
            )}
            <div className="my-1 border-t" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Staff</span>
              <span>{staffFirstName(staffName)}</span>
            </div>
          </div>

          <div className="print:hidden flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Thermal printer preview</p>
            <div className="max-h-72 overflow-y-auto rounded-md bg-muted/40 p-2">
              <ReceiptPreviewStrip
                lines={previewBalancePaymentReceipt(booking, room, {
                  staffName,
                  amountCollected: receipt.amountCollected,
                  remainingBalance: receipt.remainingBalance,
                  change: receipt.change,
                  paymentMethod: receipt.paymentMethod,
                  gcashReference: receipt.gcashReference,
                  qrphReference: receipt.qrphReference,
                  splitCashAmount: receipt.splitCashAmount,
                  splitGcashAmount: receipt.splitGcashAmount,
                  splitQrphAmount: receipt.splitQrphAmount,
                })}
                paperWidth={printer.paperWidth}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
            {printer.connected && (
              <Button variant="outline" onClick={printThermalCopy}>
                <PrinterIcon className="size-4" />
                Print Receipt
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collect payment — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>
            {booking.guestName} · Balance due ₱{balance.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <PaymentFields
          draft={payment}
          onChange={setPayment}
          due={balance}
          disabled={submitting}
          idPrefix="collect"
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || paid <= 0}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Collect ₱{Math.min(paid, balance).toFixed(2)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
