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
import { Textarea } from "@/components/ui/textarea";
import { approveVoidRequest, denyVoidRequest } from "@/lib/void-requests";
import { useAuth } from "@/context/auth-context";
import type { VoidRequest } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

function timeAgo(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface VoidRequestReviewDialogProps {
  requests: VoidRequest[];
  onClose: () => void;
}

export function VoidRequestReviewDialog({ requests, onClose }: VoidRequestReviewDialogProps) {
  const { appUser } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");

  async function handleApprove(request: VoidRequest) {
    if (!appUser) return;
    const isOrderItem = request.target === "order_item";
    const confirmMessage = isOrderItem
      ? `Remove ${request.itemQuantity}× ${request.itemName} (₱${(request.itemSubtotal ?? 0).toFixed(2)}) from Room ${request.roomNumber}'s order? This was already paid for — you'll need to hand that back to the guest.`
      : `Approve voiding Room ${request.roomNumber} — ${request.guestName}? This frees up the room without checking out.`;
    if (!window.confirm(confirmMessage)) return;
    setBusyId(request.voidRequestId);
    try {
      await approveVoidRequest(request, {
        uid: appUser.uid,
        name: appUser.displayName ?? appUser.email ?? "Owner",
      });
      toast.success(isOrderItem ? `${request.itemName} removed from Room ${request.roomNumber}'s order.` : `Room ${request.roomNumber} voided.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't approve the void request.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeny(request: VoidRequest) {
    if (!appUser) return;
    setBusyId(request.voidRequestId);
    try {
      await denyVoidRequest(
        request,
        { uid: appUser.uid, name: appUser.displayName ?? appUser.email ?? "Owner" },
        denyNote.trim() || undefined
      );
      toast.success(
        request.target === "order_item"
          ? `Request to remove ${request.itemName} from Room ${request.roomNumber} denied.`
          : `Void request for Room ${request.roomNumber} denied.`
      );
      setDenyingId(null);
      setDenyNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't deny the void request.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Void requests</DialogTitle>
          <DialogDescription>
            Approving cancels the booking and frees the room. Denying leaves it untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {requests.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending void requests.
            </p>
          )}
          {requests.map((request) => {
            const isOrderItem = request.target === "order_item";
            const balance = Math.max(request.totalAmount - request.amountPaid, 0);
            const busy = busyId === request.voidRequestId;
            const denying = denyingId === request.voidRequestId;
            return (
              <div key={request.voidRequestId} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Room {request.roomNumber} — {request.guestName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(request.requestedAt.toDate(), new Date())}
                  </span>
                </div>
                {isOrderItem && (
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Remove {request.itemQuantity}× {request.itemName} — ₱{(request.itemSubtotal ?? 0).toFixed(2)} (already paid)
                  </p>
                )}
                <p className="text-muted-foreground">&ldquo;{request.reason}&rdquo;</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Requested by {request.requestedByName}</span>
                  {!isOrderItem && <span>Balance ₱{balance.toFixed(2)}</span>}
                </div>

                {denying ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={denyNote}
                      onChange={(e) => setDenyNote(e.target.value.slice(0, 300))}
                      placeholder="Optional note for the cashier (e.g. why this was denied)"
                      rows={2}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setDenyingId(null);
                          setDenyNote("");
                        }}
                      >
                        Back
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleDeny(request)}
                      >
                        {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                        Confirm deny
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDenyingId(request.voidRequestId)}
                    >
                      Deny
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => handleApprove(request)}>
                      {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
