"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/auth-context";
import { isDrawerEnabled, setDrawerEnabled } from "@/lib/receipt-printer";
import { setDrawerPin, subscribeToDrawerPinConfigured } from "@/lib/settings";
import { OpenDrawerForm } from "@/components/cash-drawer-open";
import { BanknoteIcon, Loader2Icon } from "lucide-react";

export function CashDrawerControl() {
  const { appUser } = useAuth();
  const isOwner = appUser?.role === "owner";
  const [configured, setConfigured] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [drawerOn, setDrawerOn] = useState(false);

  useEffect(() => subscribeToDrawerPinConfigured(setConfigured), []);
  useEffect(() => setDrawerOn(isDrawerEnabled()), []);

  function handleToggle() {
    const next = !drawerOn;
    setDrawerEnabled(next);
    setDrawerOn(next);
    toast.success(
      next
        ? "Auto-open on — the drawer will pop when a guest pays cash."
        : "Auto-open off — use Open drawer (with PIN) at end of shift."
    );
  }

  async function handleSavePin() {
    if (newPin.trim().length < 4) {
      toast.error("Use at least 4 digits.");
      return;
    }
    setSavingPin(true);
    try {
      await setDrawerPin(newPin.trim());
      toast.success("Drawer PIN saved for cashiers.");
      setNewPin("");
    } catch {
      toast.error("Couldn't save the PIN — please try again.");
    } finally {
      setSavingPin(false);
    }
  }

  if (!appUser) return null;

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <BanknoteIcon className="size-5" />
        <span
          className={
            drawerOn
              ? "absolute top-1 right-1 size-2 rounded-full bg-emerald-500"
              : "absolute top-1 right-1 size-2 rounded-full bg-muted-foreground/40"
          }
        />
        <span className="sr-only">Cash drawer</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Cash drawer</span>
            <Button size="sm" variant={drawerOn ? "outline" : "default"} onClick={handleToggle}>
              {drawerOn ? "Auto-open off" : "Auto-open on"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {drawerOn
              ? "Opens by itself when cash is collected. GCash and QRPh leave it closed. Fully paid checkouts also leave it closed."
              : "Auto-open is off. At end of shift, open it below with the PIN to count cash."}
          </p>

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">Open to count cash</span>
            <OpenDrawerForm />
          </div>

          {isOwner && (
            <div className="flex flex-col gap-1.5 border-t pt-3">
              <Label htmlFor="newDrawerPin" className="text-xs text-muted-foreground">
                {configured ? "Change cashier PIN" : "Set a PIN for cashiers"}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="newDrawerPin"
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 1234"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  disabled={savingPin}
                />
                <Button size="sm" variant="outline" onClick={handleSavePin} disabled={savingPin}>
                  {savingPin && <Loader2Icon className="size-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
