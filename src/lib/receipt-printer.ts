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
  // Every component that calls useReceiptPrinter() (PrinterStatus, plus
  // every dialog that can print) fires this on its own mount. Without this
  // guard, opening a dialog while already connected would build a brand new
  // WebBluetoothReceiptPrinter and re-run reconnect() on top of a
  // perfectly working connection — clobbering the working instance's print
  // characteristic with a fresh one if the redundant reconnect is slower,
  // fails partway through, or races the original. The UI would keep
  // showing "Connected" (state.kind is untouched unless a fresh attempt
  // actually succeeds or the device fires its own disconnect event) while
  // prints silently go nowhere.
  if (state.kind !== null) return;

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

// The underlying print() promise can hang indefinitely instead of rejecting
// if a single write partway through its internal queue fails — the library
// has no reject path for that case, only a resolve once every queued write
// has gone through. Racing it against a timeout turns a dead/stuck BLE
// connection into a normal, catchable error instead of freezing whichever
// flow (check-in, checkout, extend) is waiting on the print to finish.
const PRINT_TIMEOUT_MS = 8000;

async function send(data: Uint8Array): Promise<void> {
  let printPromise: Promise<unknown>;
  if (state.kind === "bluetooth" && bluetoothPrinter) {
    printPromise = bluetoothPrinter.print(data);
  } else if (state.kind === "serial" && serialPrinter) {
    printPromise = serialPrinter.print(data);
  } else {
    throw new Error("No thermal printer connected.");
  }

  await Promise.race([
    printPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Printer didn't respond in time.")), PRINT_TIMEOUT_MS)
    ),
  ]);
}

function money(amount: number): string {
  // Most thermal printers' built-in codepages (CP437, WCP1252, etc.) don't
  // include the ₱ glyph — it would print as a garbled character or blank.
  // "P" is plain ASCII and prints correctly on every printer.
  return `P${amount.toFixed(2)}`;
}

/**
 * Right-pads a label and right-aligns a value so both fit the paper's
 * character width. The encoder doesn't word-wrap — a line longer than the
 * printer's configured width is just handed to the printer's own firmware,
 * which may wrap it oddly or, on some cheap ESC/POS clones, drop the
 * overflow entirely. Clipping the label (never the value — that's always a
 * peso amount, and truncating money is far worse than truncating a label)
 * guarantees the line itself never exceeds width.
 */
function twoColumn(label: string, value: string, width: number): string {
  const maxLabelLength = Math.max(1, width - value.length - 1);
  const clippedLabel =
    label.length > maxLabelLength ? label.slice(0, Math.max(0, maxLabelLength - 3)) + "..." : label;
  const space = Math.max(1, width - clippedLabel.length - value.length);
  return `${clippedLabel}${" ".repeat(space)}${value}`;
}

/** Clips a standalone (non-two-column) line so it never exceeds the printer's width. */
function clampLine(text: string, width: number): string {
  // ASCII "..." rather than the "…" glyph — same reasoning as money()
  // using "P" instead of "₱": most thermal printers' built-in codepages
  // don't include non-ASCII characters.
  return text.length > width ? text.slice(0, Math.max(0, width - 3)) + "..." : text;
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
    .bold(false);

  // splitCashAmount/splitGcashAmount track the running total across every
  // transaction on the booking, so this is accurate even at checkout after
  // check-in and an extension used different methods — a single "Paid
  // (method)" line would misattribute the whole cumulative amount to
  // whichever method happened to be used most recently.
  const cashPaid = booking.splitCashAmount ?? 0;
  const gcashPaid = booking.splitGcashAmount ?? 0;
  if (cashPaid > 0 && gcashPaid > 0) {
    encoder
      .line(twoColumn("Paid (Cash)", money(cashPaid), width))
      .line(twoColumn("Paid (GCash)", money(gcashPaid), width));
  } else {
    encoder.line(
      twoColumn(`Paid (${PAYMENT_METHOD_LABELS[booking.paymentMethod]})`, money(extras.finalAmountPaid), width)
    );
  }

  if (booking.gcashReference) {
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

export async function printThermalReceipt(booking: Booking, room: Room, extras: ReceiptExtras) {
  await send(buildReceiptBytes(booking, room, extras));
}

export interface ExtensionReceiptExtras {
  staffName: string;
  hours: number;
  amountCharged: number;
  amountPaid: number;
  change: number;
  paymentMethod: PaymentMethod;
  gcashReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
}

/**
 * A short, standalone receipt for a single "+1 hour" extension payment —
 * distinct from buildReceiptBytes(), which reprints the booking's whole
 * running total. Re-printing the full total here would look like the guest
 * is being charged for the original package again on top of the extension.
 */
export function buildExtensionReceiptBytes(
  booking: Booking,
  room: Room,
  extras: ExtensionReceiptExtras
): Uint8Array {
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
    .line("Extension Receipt")
    .line(`Ref: ${referenceNumberFor(booking.bookingId)}`)
    .newline()
    .align("left")
    .line(twoColumn("Room", room.roomNumber, width))
    .line(twoColumn("Guest", booking.guestName, width))
    .line(`Time: ${new Date().toLocaleString()}`)
    .newline()
    .line(twoColumn(`+${extras.hours}h extension`, money(extras.amountCharged), width))
    .newline()
    .bold(true)
    .line(twoColumn("Total", money(extras.amountCharged), width))
    .bold(false);

  if (extras.paymentMethod === "split") {
    encoder
      .line(twoColumn("Paid (Cash)", money(extras.splitCashAmount ?? 0), width))
      .line(twoColumn("Paid (GCash)", money(extras.splitGcashAmount ?? 0), width));
  } else {
    encoder.line(
      twoColumn(`Paid (${PAYMENT_METHOD_LABELS[extras.paymentMethod]})`, money(extras.amountPaid), width)
    );
  }

  if ((extras.paymentMethod === "gcash" || extras.paymentMethod === "split") && extras.gcashReference) {
    encoder.line(`GCash Ref: ${extras.gcashReference}`);
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

export async function printExtensionReceipt(booking: Booking, room: Room, extras: ExtensionReceiptExtras) {
  await send(buildExtensionReceiptBytes(booking, room, extras));
}

export interface DailySalesReceiptRow {
  roomNumber: string;
  refNumber: string;
  packageHours: number;
  extensionHours: number;
  extensionAmount: number;
  totalRoomAmount: number;
  totalStoreAmount: number;
  totalPaid: number;
  paymentMethodLabel: string;
  gcashReference?: string;
}

export interface DailySalesReceiptTotals {
  totalRoomAmount: number;
  totalStoreAmount: number;
  totalPaid: number;
  cashCollected: number;
  gcashCollected: number;
}

export interface DailySalesReceiptData {
  dateLabel: string;
  frontDesk?: string;
  housekeeping?: string;
  dutyTime?: string;
  rows: DailySalesReceiptRow[];
  totals: DailySalesReceiptTotals;
}

/**
 * The on-screen/Excel Daily Sales Report has 15 columns — meant for a full
 * sheet of paper. A thermal printer is only 32-48 characters wide, so this
 * is a genuinely different, compact layout (one short block per booking)
 * rather than the same table shrunk down.
 */
export function buildDailySalesReceiptBytes(data: DailySalesReceiptData): Uint8Array {
  const width = state.paperWidth;
  const rule = "-".repeat(width);
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
    .line("Daily Sales Report")
    .line(clampLine(data.dateLabel, width));

  if (data.frontDesk) encoder.line(clampLine(`Front desk: ${data.frontDesk}`, width));
  if (data.housekeeping) encoder.line(clampLine(`Housekeeping: ${data.housekeeping}`, width));
  if (data.dutyTime) encoder.line(clampLine(`Time: ${data.dutyTime}`, width));

  encoder.align("left").newline().line(rule);

  if (data.rows.length === 0) {
    encoder.align("center").line("No check-ins that day.").align("left");
  } else {
    for (const row of data.rows) {
      // Room/ref/hours line is bounded by construction: ref numbers are a
      // fixed 9 chars and room numbers/hours are always 1-3 digits, so this
      // never risks overflowing even 32-char paper.
      encoder.line(`Rm ${row.roomNumber}  ${row.refNumber}  ${row.packageHours}h`);
      if (row.extensionAmount > 0) {
        encoder.line(twoColumn(`  +${row.extensionHours}h ext`, money(row.extensionAmount), width));
      }
      if (row.totalStoreAmount > 0) {
        encoder.line(twoColumn("  Store items", money(row.totalStoreAmount), width));
      }
      encoder.line(twoColumn(`Paid (${row.paymentMethodLabel})`, money(row.totalPaid), width));
      // GCash reference numbers get their own line rather than being
      // appended to the Paid line — appended, a 13-digit reference pushes
      // the line past 32-char (58mm) paper's width; unlike a label, a
      // reference number can't be safely clipped, since a shortened one is
      // useless for the Owner to verify against GCash later.
      if (row.gcashReference) {
        encoder.line(clampLine(`  Ref: ${row.gcashReference}`, width));
      }
      encoder.line(rule);
    }
  }

  encoder
    .bold(true)
    .line(twoColumn("Room total", money(data.totals.totalRoomAmount), width))
    .line(twoColumn("Store total", money(data.totals.totalStoreAmount), width))
    .bold(false)
    .newline()
    .line(twoColumn("Cash collected", money(data.totals.cashCollected), width))
    .line(twoColumn("GCash collected", money(data.totals.gcashCollected), width))
    .line(twoColumn("Total collected", money(data.totals.totalPaid), width))
    .newline()
    .bold(true)
    .line(twoColumn("OVERALL SALE", money(data.totals.totalRoomAmount + data.totals.totalStoreAmount), width))
    .bold(false)
    .newline()
    .newline()
    .line("Prepared by: __________")
    .newline()
    .line("Checked by:  __________")
    .newline()
    .line("Noted by:    __________")
    .newline()
    .newline()
    .newline()
    .cut();

  return encoder.encode();
}

export async function printDailySalesReceipt(data: DailySalesReceiptData) {
  await send(buildDailySalesReceiptBytes(data));
}

/** Sends the drawer-kick pulse — the drawer must be cabled into the printer's RJ11 port. */
export async function openCashDrawer() {
  const encoder = new ReceiptPrinterEncoder({
    language: printerLanguage,
    codepageMapping: printerCodepageMapping,
  });
  await send(encoder.pulse().encode());
}

/**
 * `amount` should be the cash portion specifically — for a split payment,
 * that's the cash half only, not the combined total, since the drawer only
 * needs to open when actual cash is changing hands.
 */
export function shouldOpenDrawer(paymentMethod: PaymentMethod, amount: number): boolean {
  return (paymentMethod === "cash" || paymentMethod === "split") && amount > 0;
}
