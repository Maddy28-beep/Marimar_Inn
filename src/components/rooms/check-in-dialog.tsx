"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkIn } from "@/lib/bookings";
import { updateRoomStatus } from "@/lib/rooms";
import { subscribeToInventory } from "@/lib/inventory";
import {
  PAYMENT_METHOD_LABELS,
  ROOM_RATE_PACKAGES,
  ROOM_TYPE_LABELS,
  type InventoryItem,
  type PaymentMethod,
  type Room,
} from "@/lib/types";
import { Loader2Icon, MinusIcon, PlusIcon } from "lucide-react";

interface CheckInDialogProps {
  room: Room | null;
  cashierId: string;
  onClose: () => void;
}

export function CheckInDialog({ room, cashierId, onClose }: CheckInDialogProps) {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestCount, setGuestCount] = useState("2");
  const [packageIndex, setPackageIndex] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => subscribeToInventory(setInventory), []);

  const cartLines = useMemo(() => {
    if (!inventory) return [];
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const item = inventory.find((i) => i.itemId === itemId);
        return item ? { item, qty } : null;
      })
      .filter((line): line is { item: InventoryItem; qty: number } => line !== null);
  }, [cart, inventory]);

  const fbTotal = cartLines.reduce((sum, line) => sum + line.qty * line.item.sellingPrice, 0);

  function adjustCart(item: InventoryItem, delta: number) {
    setCart((prev) => {
      const current = prev[item.itemId] ?? 0;
      const next = Math.max(0, Math.min(item.quantity, current + delta));
      return { ...prev, [item.itemId]: next };
    });
  }

  if (!room) return null;

  const selectedPackage = ROOM_RATE_PACKAGES[packageIndex];
  const roomTotal = selectedPackage.price;
  const total = roomTotal + fbTotal;
  const paid = Number(amountPaid) || 0;
  const change = paid > total ? paid - total : 0;

  async function handleSubmit() {
    if (!room) return;
    if (!guestName.trim()) {
      toast.error("Guest name is required.");
      return;
    }

    setSubmitting(true);
    try {
      await checkIn({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        guestCount: guestCount ? Number(guestCount) : undefined,
        packageHours: selectedPackage.hours,
        packagePrice: selectedPackage.price,
        paymentMethod,
        amountPaid: Math.min(paid, total),
        specialRequests: specialRequests.trim() || undefined,
        cashierId,
        cartItems: cartLines.map((line) => ({ itemId: line.item.itemId, quantity: line.qty })),
      });
      toast.success(`Room ${room.roomNumber} checked in.`);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error && error.message.includes("left in stock")
          ? error.message
          : "Couldn't check in — please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkCleaning() {
    if (!room) return;
    setSubmitting(true);
    try {
      await updateRoomStatus(room.roomId, "cleaning");
      toast.success(`Room ${room.roomNumber} marked for cleaning.`);
      onClose();
    } catch {
      toast.error("Couldn't update the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkMaintenance() {
    if (!room) return;
    setSubmitting(true);
    try {
      await updateRoomStatus(room.roomId, "maintenance");
      toast.success(`Room ${room.roomNumber} marked under maintenance.`);
      onClose();
    } catch {
      toast.error("Couldn't update the room — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Check in — Room {room.roomNumber}</DialogTitle>
          <DialogDescription>{ROOM_TYPE_LABELS[room.type]}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="guestName">Guest name</Label>
            <Input
              id="guestName"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guestPhone">Contact number</Label>
              <Input
                id="guestPhone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guestCount"># of guests</Label>
              <Input
                id="guestCount"
                type="number"
                min={1}
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Rate package</Label>
            <div className="flex flex-wrap gap-1.5">
              {ROOM_RATE_PACKAGES.map((pkg, index) => (
                <Button
                  key={pkg.hours}
                  type="button"
                  size="sm"
                  variant={packageIndex === index ? "default" : "outline"}
                  onClick={() => setPackageIndex(index)}
                  disabled={submitting}
                >
                  {pkg.hours}h · ₱{pkg.price}
                </Button>
              ))}
            </div>
          </div>

          {inventory !== null && inventory.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Store items (optional)</Label>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-1.5">
                {inventory.map((item) => {
                  const qty = cart[item.itemId] ?? 0;
                  const outOfStock = item.quantity <= 0;
                  return (
                    <div
                      key={item.itemId}
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        {item.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          ₱{item.sellingPrice.toFixed(2)}
                        </span>
                      </div>
                      {outOfStock ? (
                        <span className="text-xs text-rose-600 dark:text-rose-400">
                          Out of stock
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            onClick={() => adjustCart(item, -1)}
                            disabled={qty === 0 || submitting}
                          >
                            <MinusIcon className="size-3" />
                          </Button>
                          <span className="w-4 text-center tabular-nums">{qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            onClick={() => adjustCart(item, 1)}
                            disabled={qty >= item.quantity || submitting}
                          >
                            <PlusIcon className="size-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Room ({selectedPackage.hours}h)</span>
              <span>₱{roomTotal.toFixed(2)}</span>
            </div>
            {fbTotal > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Store items</span>
                <span>₱{fbTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-base font-bold">
              <span>Total due</span>
              <span>₱{total.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Payment method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              disabled={submitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{PAYMENT_METHOD_LABELS[paymentMethod]}</SelectValue>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amountPaid">Amount paid</Label>
              <Input
                id="amountPaid"
                type="number"
                min={0}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Change</Label>
              <div className="flex h-8 items-center text-sm font-medium">
                ₱{change.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialRequests">Special requests</Label>
            <Textarea
              id="specialRequests"
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkCleaning}
              disabled={submitting}
              className="text-muted-foreground"
            >
              Mark for cleaning
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkMaintenance}
              disabled={submitting}
              className="text-muted-foreground"
            >
              Mark maintenance
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Check in
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
