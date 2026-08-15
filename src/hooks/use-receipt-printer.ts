"use client";

import { useEffect, useState } from "react";
import {
  connectBluetoothPrinter,
  connectSerialPrinter,
  getPrinterState,
  setPaperWidth,
  subscribePrinterState,
  tryReconnectPrinter,
} from "@/lib/receipt-printer";

export function useReceiptPrinter() {
  const [state, setState] = useState(getPrinterState);

  useEffect(() => subscribePrinterState(setState), []);

  // Attempt a silent reconnect once per app load — no-ops if the browser
  // didn't retain permission for a previously-authorized device.
  useEffect(() => {
    tryReconnectPrinter().catch(() => {});
  }, []);

  return {
    connected: state.kind !== null,
    kind: state.kind,
    name: state.name,
    paperWidth: state.paperWidth,
    setPaperWidth,
    connectBluetooth: connectBluetoothPrinter,
    connectSerial: connectSerialPrinter,
  };
}
