import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import WebBluetoothReceiptPrinter, {
  type ConnectedPrinterInfo as BluetoothPrinterInfo,
} from "@point-of-sale/webbluetooth-receipt-printer";
import WebSerialReceiptPrinter, {
  type ConnectedPrinterInfo as SerialPrinterInfo,
} from "@point-of-sale/webserial-receipt-printer";
import {
  PAYMENT_METHOD_LABELS,
  type Booking,
  type PaymentMethod,
  type Room,
} from "@/lib/types";

type PrinterKind = "bluetooth" | "serial";
type ConnectedInfo = BluetoothPrinterInfo | SerialPrinterInfo;

interface PrinterState {
  kind: PrinterKind | null;
  name: string | null;
  paperWidth: 32 | 48;
}

const STORAGE_KEY = "marimar-inn:thermal-printer";

let bluetoothPrinter: WebBluetoothReceiptPrinter | null = null;
let serialPrinter: WebSerialReceiptPrinter | null = null;
let printerLanguage: "esc-pos" | "star-prnt" = "esc-pos";
let printerCodepageMapping: string | undefined;

const state: PrinterState = { kind: null, name: null, paperWidth: 32 };
const listeners = new Set<(state: PrinterState) => void>();

function emit() {
  listeners.forEach((listener) => listener({ ...state }));
}

export function subscribePrinterState(listener: (state: PrinterState) => void) {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

export function getPrinterState(): PrinterState {
  return { ...state };
}

interface StoredDevice {
  kind: PrinterKind;
  paperWidth: 32 | 48;
  bluetoothId?: string;
  serialVendorId?: number;
  serialProductId?: number;
}

function loadStoredDevice(): StoredDevice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredDevice) : null;
  } catch {
    return null;
  }
}

function saveStoredDevice(device: StoredDevice) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
}

function onConnected(kind: PrinterKind, info: ConnectedInfo) {
  printerLanguage = info.language;
  printerCodepageMapping = info.codepageMapping;
  state.kind = kind;
  state.name =
    kind === "bluetooth"
      ? (info as BluetoothPrinterInfo).name
      : (info as SerialPrinterInfo).productName || "Serial printer";
  emit();

  const existing = loadStoredDevice();
  const paperWidth = existing?.paperWidth ?? state.paperWidth;
  state.paperWidth = paperWidth;
  if (kind === "bluetooth") {
    saveStoredDevice({ kind, paperWidth, bluetoothId: (info as BluetoothPrinterInfo).id });
  } else {
    const s = info as SerialPrinterInfo;
    saveStoredDevice({ kind, paperWidth, serialVendorId: s.vendorId, serialProductId: s.productId });
  }
}

/** Must be called from a click handler — browsers require a user gesture to open the device picker. */
export async function connectBluetoothPrinter(): Promise<void> {
  bluetoothPrinter = new WebBluetoothReceiptPrinter();
  bluetoothPrinter.addEventListener("connected", (info) =>
    onConnected("bluetooth", info)
  );
  bluetoothPrinter.addEventListener("disconnected", () => {
    state.kind = null;
    state.name = null;
    emit();
  });
  await bluetoothPrinter.connect();
}

/** Must be called from a click handler — browsers require a user gesture to open the port picker. */
export async function connectSerialPrinter(): Promise<void> {
  serialPrinter = new WebSerialReceiptPrinter();
  serialPrinter.addEventListener("connected", (info) => onConnected("serial", info));
  serialPrinter.addEventListener("disconnected", () => {
    state.kind = null;
    state.name = null;
    emit();
  });
  await serialPrinter.connect();
}

/**
 * Attempts a silent reconnect to whichever printer was last used, without
 * prompting the device picker. Browser support for permission persistence
 * varies, so this can quietly no-op — the UI should still offer a manual
 * "Connect printer" action as a fallback.
 */
export async function tryReconnectPrinter(): Promise<void> {
  const stored = loadStoredDevice();
  if (!stored) return;
  state.paperWidth = stored.paperWidth;

  try {
    if (stored.kind === "bluetooth" && stored.bluetoothId) {
      bluetoothPrinter = new WebBluetoothReceiptPrinter();
      bluetoothPrinter.addEventListener("connected", (info) => onConnected("bluetooth", info));
      bluetoothPrinter.addEventListener("disconnected", () => {
        state.kind = null;
        state.name = null;
        emit();
      });
      await bluetoothPrinter.reconnect({ id: stored.bluetoothId });
    } else if (stored.kind === "serial") {
      serialPrinter = new WebSerialReceiptPrinter();
      serialPrinter.addEventListener("connected", (info) => onConnected("serial", info));
      serialPrinter.addEventListener("disconnected", () => {
        state.kind = null;
        state.name = null;
        emit();
      });
      await serialPrinter.reconnect({
        vendorId: stored.serialVendorId,
        productId: stored.serialProductId,
      });
    }
  } catch {
    // No previously-authorized device found (or permission wasn't retained) — stays disconnected.
  }
}

export function setPaperWidth(width: 32 | 48) {
  state.paperWidth = width;
  const stored = loadStoredDevice();
  if (stored) saveStoredDevice({ ...stored, paperWidth: width });
  emit();
}

function send(data: Uint8Array) {
  if (state.kind === "bluetooth" && bluetoothPrinter) {
    bluetoothPrinter.print(data);
  } else if (state.kind === "serial" && serialPrinter) {
    serialPrinter.print(data);
  } else {
    throw new Error("No thermal printer connected.");
  }
}

function money(amount: number): string {
  // Most thermal printers' built-in codepages (CP437, WCP1252, etc.) don't
  // include the ₱ glyph — it would print as a garbled character or blank.
  // "P" is plain ASCII and prints correctly on every printer.
  return `P${amount.toFixed(2)}`;
}

/** Right-pads a label and right-aligns a value so both fit the paper's character width. */
function twoColumn(label: string, value: string, width: number): string {
  const space = Math.max(1, width - label.length - value.length);
  return `${label}${" ".repeat(space)}${value}`;
}

export interface ReceiptExtras {
  staffName: string;
  finalAmountPaid: number;
  change: number;
}

/**
 * Derives a short, human-readable reference number from the booking's
 * Firestore document ID — stable and unique without needing a separate
 * sequence counter. Same booking always prints the same reference, whether
 * it's the check-in copy or the final checkout copy.
 */
export function referenceNumberFor(bookingId: string): string {
  const clean = bookingId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const tail = clean.slice(-8).padStart(8, "0");
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

export function buildReceiptBytes(booking: Booking, room: Room, extras: ReceiptExtras): Uint8Array {
  const width = state.paperWidth;
  const encoder = new ReceiptPrinterEncoder({
    language: printerLanguage,
    codepageMapping: printerCodepageMapping,
    width,
  });

  encoder
    .initialize()
    .align("center")
    .bold(true)
    .line("Marimar Inn")
    .bold(false)
    .line("Official Receipt")
    .line(`Ref: ${referenceNumberFor(booking.bookingId)}`)
    .newline()
    .align("left")
    .line(twoColumn("Room", room.roomNumber, width))
    .line(twoColumn("Guest", booking.guestName, width))
    .line(`In: ${booking.checkInTime.toDate().toLocaleString()}`)
    .line(`Out: ${new Date().toLocaleString()}`)
    .newline()
    .line(twoColumn(`Room (${booking.hoursBooked}h)`, money(booking.totalRoomCharge), width));

  for (const item of booking.items) {
    encoder.line(
      twoColumn(`${item.quantity}x ${item.name}`, money(item.subtotal), width)
    );
  }
  if (booking.totalFbCharge > 0) {
    encoder.line(twoColumn("Store items", money(booking.totalFbCharge), width));
  }

  encoder
    .newline()
    .bold(true)
    .line(twoColumn("Total", money(booking.totalAmount), width))
    .bold(false)
    .line(twoColumn(`Paid (${PAYMENT_METHOD_LABELS[booking.paymentMethod]})`, money(extras.finalAmountPaid), width));

  if (booking.paymentMethod === "gcash" && booking.gcashReference) {
    encoder.line(`GCash Ref: ${booking.gcashReference}`);
  }

  if (extras.change > 0) {
    encoder.line(twoColumn("Change", money(extras.change), width));
  }

  encoder
    .newline()
    .align("center")
    .line(`Staff: ${extras.staffName}`)
    .newline()
    .newline()
    .newline()
    .cut();

  return encoder.encode();
}

export function printThermalReceipt(booking: Booking, room: Room, extras: ReceiptExtras) {
  send(buildReceiptBytes(booking, room, extras));
}

/** Sends the drawer-kick pulse — the drawer must be cabled into the printer's RJ11 port. */
export function openCashDrawer() {
  const encoder = new ReceiptPrinterEncoder({
    language: printerLanguage,
    codepageMapping: printerCodepageMapping,
  });
  send(encoder.pulse().encode());
}

export function shouldOpenDrawer(paymentMethod: PaymentMethod, amount: number): boolean {
  return paymentMethod === "cash" && amount > 0;
}
