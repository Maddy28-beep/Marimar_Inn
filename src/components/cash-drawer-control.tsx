"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/auth-context";
import { isDrawerEnabled, setDrawerEnabled } from "@/lib/receipt-printer";
import { normalizePin, setDrawerPin, subscribeToDrawerPinConfigured } from "@/lib/settings";
import { OpenDrawerForm } from "@/components/cash-drawer-open";
import { BanknoteIcon, Loader2Icon } from "lucide-react";

export function CashDrawerControl() {
  const { appUser } = useAuth();
  const isOwner = appUser?.role === "owner";
  const [configured, setConfigured] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [openOnCash, setOpenOnCash] = useState(false);

  useEffect(() => subscribeToDrawerPinConfigured(setConfigured), []);
  useEffect(() => setOpenOnCash(isDrawerEnabled()), []);

  function handleToggle() {
    const next = !openOnCash;
    setDrawerEnabled(next);
    setOpenOnCash(next);
    toast.success(
      next
        ? "On cash pay: the drawer will open when a guest pays cash."
        : "On cash pay is off. Use Open drawer (with PIN) when you need it."
    );
  }

  async function handleSavePin() {
    const digits = normalizePin(newPin);
    if (digits.length < 4) {
      toast.error("Use at least 4 digits.");
      return;
    }
    setSavingPin(true);
    try {
      await setDrawerPin(digits);
      toast.success("Drawer PIN saved. Cashiers can use it now.");
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
            openOnCash
              ? "absolute top-1 right-1 size-2 rounded-full bg-emerald-500"
              : "absolute top-1 right-1 size-2 rounded-full bg-muted-foreground/40"
          }
        />
        <span className="sr-only">Cash drawer</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-medium">On cash pay</span>
              <p className="text-xs text-muted-foreground">
                {openOnCash
                  ? "Drawer opens when a guest pays cash. GCash and QRPh leave it closed. Fully paid checkouts also leave it closed."
                  : "Drawer stays closed during sales. Open it below with the PIN when you need to count cash."}
              </p>
            </div>
            <Button
              size="sm"
              variant={openOnCash ? "default" : "outline"}
              className="shrink-0"
              onClick={handleToggle}
            >
              {openOnCash ? "On" : "Off"}
            </Button>
          </div>

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">Open drawer</span>
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
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  name="marimar-drawer-pin-setup"
                  placeholder="e.g. 2026"
                  value={newPin}
                  onChange={(e) => setNewPin(normalizePin(e.target.value))}
                  disabled={savingPin}
                  maxLength={8}
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
