"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { BluetoothIcon, CableIcon, PrinterIcon, SmartphoneIcon } from "lucide-react";

const KIND_LABELS: Record<string, string> = {
  bluetooth: "Bluetooth",
  serial: "USB/Serial",
  rawbt: "via RawBT app",
};

export function PrinterStatus() {
  const printer = useReceiptPrinter();
  const [connecting, setConnecting] = useState(false);

  async function handleConnect(via: "bluetooth" | "serial" | "rawbt") {
    setConnecting(true);
    try {
      if (via === "bluetooth") {
        await printer.connectBluetooth();
      } else if (via === "serial") {
        await printer.connectSerial();
      } else {
        await printer.connectRawBt();
      }
      toast.success(
        via === "rawbt" ? "Set to print via the RawBT app." : "Thermal printer connected."
      );
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundError") {
        // User closed the device picker without selecting anything — not an error.
      } else if (via === "bluetooth") {
        toast.error(
          "Couldn't connect — if the printer doesn't show up, it may only support Bluetooth Classic, which browsers can't use directly. Try USB/Serial, or RawBT if the printer only supports classic Bluetooth."
        );
      } else if (via === "serial") {
        toast.error("Couldn't connect to the printer over USB/Serial — please try again.");
      } else {
        toast.error("Couldn't switch to RawBT — please try again.");
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <PrinterIcon className="size-5" />
        <span
          className={
            printer.connected
              ? "absolute top-1 right-1 size-2 rounded-full bg-emerald-500"
              : "absolute top-1 right-1 size-2 rounded-full bg-muted-foreground/40"
          }
        />
        <span className="sr-only">Thermal printer</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Thermal printer</span>
            {printer.connected ? (
              <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                Not connected
              </Badge>
            )}
          </div>

          {printer.connected ? (
            <p className="text-sm text-muted-foreground">
              {printer.name} · {printer.kind ? KIND_LABELS[printer.kind] : ""}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={connecting}
                onClick={() => handleConnect("bluetooth")}
              >
                <BluetoothIcon className="size-3.5" />
                Connect via Bluetooth
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={connecting}
                onClick={() => handleConnect("serial")}
              >
                <CableIcon className="size-3.5" />
                Connect via USB/Serial
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={connecting}
                onClick={() => handleConnect("rawbt")}
              >
                <SmartphoneIcon className="size-3.5" />
                Print via RawBT app
              </Button>
              <p className="text-xs text-muted-foreground">
                Only Chrome and Edge can talk to printers directly. If Bluetooth
                doesn&apos;t find your printer, it may only support classic
                Bluetooth, which browsers can&apos;t reach — install the free
                RawBT app, pair the printer inside it, then choose &quot;Print
                via RawBT app&quot; here.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">Paper width</span>
            <Select
              value={String(printer.paperWidth)}
              onValueChange={(v) => printer.setPaperWidth(Number(v) as 32 | 48)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{printer.paperWidth === 32 ? "58mm (32 chars)" : "80mm (48 chars)"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="32">58mm (32 chars)</SelectItem>
                <SelectItem value="48">80mm (48 chars)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
