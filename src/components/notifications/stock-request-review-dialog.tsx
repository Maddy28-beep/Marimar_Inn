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
import { approveStockRequest, denyStockRequest } from "@/lib/stock-requests";
import { useAuth } from "@/context/auth-context";
import { syncNote, useOnlineStatus } from "@/hooks/use-online-status";
import { visibleStaffName } from "@/lib/roles";
import type { StockRequest } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

function timeAgo(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface StockRequestReviewDialogProps {
  requests: StockRequest[];
  onClose: () => void;
}

export function StockRequestReviewDialog({ requests, onClose }: StockRequestReviewDialogProps) {
  const { appUser } = useAuth();
  const isOnline = useOnlineStatus();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");

  async function handleApprove(request: StockRequest) {
    if (!appUser) return;
    if (
      !window.confirm(
        `Add ${request.quantity}× ${request.itemName} to inventory? This updates the stock count immediately.`
      )
    ) {
      return;
    }
    setBusyId(request.stockRequestId);
    try {
      await approveStockRequest(request, {
        uid: appUser.uid,
        name: appUser.displayName ?? appUser.email ?? "Owner",
      });
      toast.success(`${request.quantity}× ${request.itemName} added to inventory.` + syncNote(isOnline));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't approve the stock request.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeny(request: StockRequest) {
    if (!appUser) return;
    setBusyId(request.stockRequestId);
    try {
      await denyStockRequest(
        request,
        { uid: appUser.uid, name: appUser.displayName ?? appUser.email ?? "Owner" },
        denyNote.trim() || undefined
      );
      toast.success(`Request to add ${request.itemName} denied.`);
      setDenyingId(null);
      setDenyNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't deny the stock request.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Stock requests</DialogTitle>
          <DialogDescription>
            Approving adds the quantity to inventory right away. Denying leaves stock unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {requests.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending stock requests.
            </p>
          )}
          {requests.map((request) => {
            const busy = busyId === request.stockRequestId;
            const denying = denyingId === request.stockRequestId;
            return (
              <div
                key={request.stockRequestId}
                className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    +{request.quantity} × {request.itemName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(request.requestedAt.toDate(), new Date())}
                  </span>
                </div>
                <p className="text-muted-foreground">{request.category}</p>
                {request.reason && <p className="text-muted-foreground">&ldquo;{request.reason}&rdquo;</p>}
                <div className="text-xs text-muted-foreground">
                  Requested by {visibleStaffName(request.requestedByName, request.requestedByRole) || "Staff"}
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
                      onClick={() => setDenyingId(request.stockRequestId)}
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
