"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/auth-context";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { openCashDrawer, isDrawerEnabled, setDrawerEnabled } from "@/lib/receipt-printer";
import { setDrawerPin, subscribeToDrawerPinConfigured, verifyDrawerPin } from "@/lib/settings";
import { BanknoteIcon, Loader2Icon } from "lucide-react";

export function CashDrawerControl() {
  const { appUser } = useAuth();
  const printer = useReceiptPrinter();
  const isOwner = appUser?.role === "owner";
  const [configured, setConfigured] = useState(false);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [opening, setOpening] = useState(false);
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
        ? "Cash drawer on — it will open when a guest pays cash."
        : "Cash drawer off — receipts print without opening it."
    );
  }

  if (!appUser) return null;

  async function handleOpen() {
    if (!printer.connected) return;

    if (!isOwner) {
      if (!pin.trim()) {
        toast.error("Enter the drawer PIN.");
        return;
      }
      setOpening(true);
      let ok: boolean;
      try {
        ok = await verifyDrawerPin(pin.trim());
      } catch {
        toast.error("Couldn't verify the PIN — please try again.");
        setOpening(false);
        return;
      }
      if (!ok) {
        toast.error("Wrong PIN.");
        setOpening(false);
        return;
      }
    } else {
      setOpening(true);
    }

    try {
      await openCashDrawer();
      toast.success("Cash drawer opened.");
      setPin("");
    } catch {
      toast.error("Couldn't open the cash drawer.");
    } finally {
      setOpening(false);
    }
  }

  async function handleSavePin() {
    if (newPin.trim().length < 4) {
      toast.error("Use at least 4 digits.");
      return;
    }
    setSavingPin(true);
    try {
      await setDrawerPin(newPin.trim());
      toast.success("Drawer PIN updated.");
      setNewPin("");
    } catch {
      toast.error("Couldn't save the PIN — please try again.");
    } finally {
      setSavingPin(false);
    }
  }

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
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Cash drawer</span>
            <Button size="sm" variant={drawerOn ? "outline" : "default"} onClick={handleToggle}>
              {drawerOn ? "Turn off" : "Turn on"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {drawerOn
              ? "Opens only when cash is collected (check-in, extension, or unpaid checkout). GCash and QRPh leave it closed."
              : "Off until a drawer is plugged into the printer. Receipts still print."}
          </p>

          {!printer.connected && (
            <p className="text-xs text-muted-foreground">
              Connect a thermal printer first — the drawer is wired into it.
            </p>
          )}

          {drawerOn && (isOwner ? (
            <>
              <Button size="sm" onClick={handleOpen} disabled={!printer.connected || opening}>
                {opening && <Loader2Icon className="size-4 animate-spin" />}
                Open drawer
              </Button>
              <div className="flex flex-col gap-1.5 border-t pt-3">
                <Label htmlFor="newDrawerPin" className="text-xs text-muted-foreground">
                  {configured ? "Change drawer PIN" : "Set a drawer PIN for staff"}
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
                    Save
                  </Button>
                </div>
              </div>
            </>
          ) : configured ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="drawerPin" className="text-xs text-muted-foreground">
                Enter PIN to open
              </Label>
              <div className="flex gap-2">
                <Input
                  id="drawerPin"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={opening}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleOpen();
                    }
                  }}
                />
                <Button size="sm" onClick={handleOpen} disabled={!printer.connected || opening}>
                  {opening && <Loader2Icon className="size-4 animate-spin" />}
                  Open
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No drawer PIN set yet — ask the Owner to set one.
            </p>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
