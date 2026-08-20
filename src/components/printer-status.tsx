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
import { ReceiptPreviewDialog } from "@/components/receipt-preview";
import { useReceiptPrinter } from "@/hooks/use-receipt-printer";
import { BluetoothIcon, CableIcon, EyeIcon, PrinterIcon, SmartphoneIcon } from "lucide-react";
import { previewTestPage, type PairedPrinter } from "@/lib/receipt-printer";

const KIND_LABELS: Record<string, string> = {
  bluetooth: "Bluetooth",
  serial: "USB/Serial",
  rawbt: "via RawBT app",
  native: "Tablet Bluetooth",
};

export function PrinterStatus() {
  const printer = useReceiptPrinter();
  const [connecting, setConnecting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

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
          "Couldn't connect — this printer likely uses classic Bluetooth, which Chrome can't print to. Install the Marimar Inn tablet app, or pair the printer in Android Settings and use that app."
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

  async function handleNativeConnect(device: PairedPrinter) {
    setConnecting(true);
    try {
      await printer.connectNative(device);
      toast.success(`Connected to ${device.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't connect to the printer.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleTestPrint() {
    try {
      await printer.printTest();
      toast.success("Test sent to the printer.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test print failed.");
    }
  }

  async function handleForgetSaved() {
    try {
      await printer.forgetSavedPrinter();
      printer.refreshPairedPrinters();
      toast.success("Saved printer forgotten. Tap the printer you want to use.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't forget the saved printer.");
    }
  }

  return (
    <>
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
      <PopoverContent align="end" className="w-80 p-3">
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
            <>
              <p className="text-sm text-muted-foreground">
                {printer.name} · {printer.kind ? KIND_LABELS[printer.kind] : ""}
              </p>
              <div className="flex flex-col gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                  <EyeIcon className="size-3.5" />
                  Preview receipt
                </Button>
                <Button variant="outline" size="sm" onClick={handleTestPrint}>
                  Print test
                </Button>
                <Button variant="ghost" size="sm" onClick={() => printer.disconnect()}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : printer.nativeApp ? (
            <div className="flex flex-col gap-1.5">
              {printer.pairedPrinters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Pair the thermal printer in Android Settings → Bluetooth first,
                  then tap the printer icon again. No extra print app is needed.
                </p>
              ) : (
                printer.pairedPrinters.map((device) => (
                  <Button
                    key={device.id}
                    variant="outline"
                    size="sm"
                    disabled={connecting}
                    onClick={() => handleNativeConnect(device)}
                  >
                    <BluetoothIcon className="size-3.5" />
                    {device.name}
                  </Button>
                ))
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => printer.refreshPairedPrinters()}
              >
                Refresh printer list
              </Button>
            </div>
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
                Chrome cannot print to most cheap thermal printers (they use
                classic Bluetooth). Install the Marimar Inn tablet app on this
                device — it prints the same way the other inn app does, with no
                RawBT.
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
            {!printer.connected ? (
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <EyeIcon className="size-3.5" />
                Preview receipt
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void handleForgetSaved()}>
              Forget saved printer
            </Button>
            <p className="text-xs text-muted-foreground">
              Clears the last printer this app remembered so it won&apos;t auto-connect
              to the wrong one. Extra devices still in the list can be unpaired in
              Android Settings → Bluetooth.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    <ReceiptPreviewDialog
      open={previewOpen}
      onOpenChange={setPreviewOpen}
      lines={previewOpen ? previewTestPage() : []}
      paperWidth={printer.paperWidth}
      title="Printer test preview"
      onPrint={printer.connected ? handleTestPrint : undefined}
    />
    </>
  );
}
