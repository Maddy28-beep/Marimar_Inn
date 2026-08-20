"use client";

import { useEffect, useState } from "react";
import {
  connectBluetoothPrinter,
  connectNativePrinter,
  connectRawBtPrinter,
  connectSerialPrinter,
  disconnectPrinter,
  forgetSavedPrinter,
  getPrinterState,
  isNativePrinterApp,
  listNativePairedPrinters,
  printTestPage,
  setPaperWidth,
  subscribePrinterState,
  tryReconnectPrinter,
  type PairedPrinter,
} from "@/lib/receipt-printer";

export function useReceiptPrinter() {
  const [state, setState] = useState(getPrinterState);
  const [nativeApp, setNativeApp] = useState(false);
  const [pairedPrinters, setPairedPrinters] = useState<PairedPrinter[]>([]);

  useEffect(() => subscribePrinterState(setState), []);

  useEffect(() => {
    setNativeApp(isNativePrinterApp());
    setPairedPrinters(listNativePairedPrinters());
  }, []);

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
    nativeApp,
    pairedPrinters,
    refreshPairedPrinters: () => setPairedPrinters(listNativePairedPrinters()),
    setPaperWidth,
    connectBluetooth: connectBluetoothPrinter,
    connectSerial: connectSerialPrinter,
    connectRawBt: connectRawBtPrinter,
    connectNative: connectNativePrinter,
    disconnect: disconnectPrinter,
    forgetSavedPrinter,
    printTest: printTestPage,
  };
}
