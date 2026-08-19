"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/auth-context";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { openCashDrawer } from "@/lib/receipt-printer";
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

  useEffect(() => subscribeToDrawerPinConfigured(setConfigured), []);

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
      <PopoverTrigger render={<Button variant="ghost" size="icon" />}>
        <BanknoteIcon className="size-5" />
        <span className="sr-only">Cash drawer</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">Cash drawer</span>

          {!printer.connected && (
            <p className="text-xs text-muted-foreground">
              Connect a thermal printer first — the drawer is wired into it.
            </p>
          )}

          {isOwner ? (
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
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
