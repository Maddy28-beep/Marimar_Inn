"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { openCashDrawer, printerErrorMessage } from "@/lib/receipt-printer";
import { normalizePin, subscribeToDrawerPinConfigured, verifyDrawerPin } from "@/lib/settings";
import { Loader2Icon } from "lucide-react";

export function OpenDrawerForm() {
  const { appUser } = useAuth();
  const printer = useReceiptPrinter();
  const isOwner = appUser?.role === "owner";
  const [configured, setConfigured] = useState(false);
  const [pin, setPin] = useState("");
  const [opening, setOpening] = useState(false);

  useEffect(() => subscribeToDrawerPinConfigured(setConfigured), []);

  async function handleOpen() {
    if (!printer.connected) {
      toast.error("Connect the thermal printer first — the drawer is wired into it.");
      return;
    }

    if (!isOwner) {
      if (!configured) {
        toast.error("No drawer PIN yet — ask the Owner to set one.");
        return;
      }
      const digits = normalizePin(pin);
      if (!digits) {
        toast.error("Enter the drawer PIN.");
        return;
      }
      setOpening(true);
      let ok: boolean;
      try {
        ok = await verifyDrawerPin(digits);
      } catch {
        toast.error("Couldn't check the PIN — please try again.");
        setOpening(false);
        return;
      }
      if (!ok) {
        toast.error("That PIN doesn't match. Ask the Owner to save it again (banknote icon).");
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
    } catch (error) {
      toast.error(printerErrorMessage(error));
    } finally {
      setOpening(false);
    }
  }

  if (!appUser) return null;

  if (!isOwner && !configured) {
    return (
      <p className="text-xs text-muted-foreground">
        No drawer PIN set yet — ask the Owner to set one (banknote icon, top right).
      </p>
    );
  }

  if (isOwner) {
    return (
      <Button size="sm" onClick={handleOpen} disabled={opening}>
        {opening && <Loader2Icon className="size-4 animate-spin" />}
        Open drawer
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="shiftDrawerPin" className="text-xs text-muted-foreground">
        Enter the PIN the Owner set, then open
      </Label>
      <div className="flex gap-2">
        <Input
          id="shiftDrawerPin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name="marimar-drawer-pin"
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(normalizePin(e.target.value))}
          disabled={opening}
          maxLength={8}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleOpen();
            }
          }}
        />
        <Button size="sm" onClick={handleOpen} disabled={opening}>
          {opening && <Loader2Icon className="size-4 animate-spin" />}
          Open
        </Button>
      </div>
    </div>
  );
}
