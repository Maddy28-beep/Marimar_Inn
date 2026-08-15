"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRatePackage, updateRatePackage, type RatePackageInput } from "@/lib/rooms";
import type { RatePackage } from "@/lib/types";
import { Loader2Icon } from "lucide-react";

interface RatePackageFormDialogProps {
  mode: "create" | { pkg: RatePackage };
  onClose: () => void;
}

export function RatePackageFormDialog({ mode, onClose }: RatePackageFormDialogProps) {
  const editingPkg = mode === "create" ? null : mode.pkg;
  const [hours, setHours] = useState(String(editingPkg?.hours ?? ""));
  const [price, setPrice] = useState(String(editingPkg?.price ?? ""));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const hoursNum = Number(hours);
    const priceNum = Number(price);
    if (!hoursNum || hoursNum <= 0 || !priceNum || priceNum <= 0) {
      toast.error("Enter valid hours and price.");
      return;
    }
    const input: RatePackageInput = { hours: hoursNum, price: priceNum };

    setSubmitting(true);
    try {
      if (editingPkg) {
        await updateRatePackage(editingPkg.packageId, input);
        toast.success(`${hoursNum}h package updated.`);
      } else {
        await createRatePackage(input);
        toast.success(`${hoursNum}h package added.`);
      }
      onClose();
    } catch {
      toast.error("Couldn't save the rate package — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editingPkg ? "Edit rate package" : "Add rate package"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hours">Hours</Label>
            <Input
              id="hours"
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price">Price (₱)</Label>
            <Input
              id="price"
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
