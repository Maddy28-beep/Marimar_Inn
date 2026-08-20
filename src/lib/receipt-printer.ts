import WebSerialReceiptPrinter, {
  type ConnectedPrinterInfo as SerialPrinterInfo,
} from "@point-of-sale/webserial-receipt-printer";
import {
  PAYMENT_METHOD_LABELS,
  type Booking,
  type PaymentMethod,
  type Room,
} from "@/lib/types";
import { paymentPortionLines } from "@/lib/bookings";
import {
  RECEIPT_ICON_BASE64,
  RECEIPT_ICON_HEIGHT,
  RECEIPT_ICON_WIDTH,
} from "@/lib/receipt-icon";

type PrinterKind = "bluetooth" | "serial" | "rawbt" | "native";

interface PrinterState {
  kind: PrinterKind | null;
  name: string | null;
  paperWidth: 32 | 48;
}

const STORAGE_KEY = "marimar-inn:thermal-printer";
const DRAWER_KEY = "marimar-inn:cash-drawer-enabled";
const SIDE_MARGIN = 3;

export interface ReceiptPreviewLine {
  align: "left" | "center" | "right";
  text: string;
  logo?: boolean;
}

interface BleLePrinterProfile {
  filters: BluetoothLEScanFilter[];
  serviceUuid: string;
  characteristicUuid: string;
  language: "esc-pos" | "star-prnt";
  codepageMapping: string;
}

// Reimplemented locally (from the device-matching table that used to ship
// inside @point-of-sale/webbluetooth-receipt-printer) so we can choose the
// write mode ourselves — see connectBleCharacteristic() below. Genuine BLE
// printers (Epson TM-P series, Star Micronics) are listed first since
// they're the ones this profile table actually matters for — the RPP02N
// this app started with turned out to be classic-Bluetooth-only underneath
// and unreachable from any browser regardless of this table.
const BLE_PRINTER_PROFILES: BleLePrinterProfile[] = [
  {
    filters: [{ namePrefix: "TM-P" }],
    serviceUuid: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    characteristicUuid: "49535343-8841-43f4-a8d4-ecbe34729bb3",
    language: "esc-pos",
    codepageMapping: "epson",
  },
  {
    filters: [{ namePrefix: "STAR L" }],
    serviceUuid: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    characteristicUuid: "49535343-8841-43f4-a8d4-ecbe34729bb3",
    language: "star-prnt",
    codepageMapping: "star",
  },
  {
    filters: [{ name: "BlueTooth Printer", services: ["000018f0-0000-1000-8000-00805f9b34fb"] }],
    serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "00002af1-0000-1000-8000-00805f9b34fb",
    language: "esc-pos",
    codepageMapping: "zjiang",
  },
  {
    filters: [{ name: "Printer001", services: ["000018f0-0000-1000-8000-00805f9b34fb"] }],
    serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "00002af1-0000-1000-8000-00805f9b34fb",
    language: "esc-pos",
    codepageMapping: "xprinter",
  },
  {
    filters: [{ name: "MPT-II", services: ["000018f0-0000-1000-8000-00805f9b34fb"] }],
    serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "00002af1-0000-1000-8000-00805f9b34fb",
    language: "esc-pos",
    codepageMapping: "mpt",
  },
  {
    // Generic fallback — matches most no-name-brand 58/80mm ESC/POS clones
    // (this app's RPP02N included) purely by service UUID.
    filters: [{ services: ["000018f0-0000-1000-8000-00805f9b34fb"] }],
    serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb",
    characteristicUuid: "00002af1-0000-1000-8000-00805f9b34fb",
    language: "esc-pos",
    codepageMapping: "epson",
  },
];

interface ConnectedBlePrinter {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  writeWithoutResponse: boolean;
}

let blePrinter: ConnectedBlePrinter | null = null;
let serialPrinter: WebSerialReceiptPrinter | null = null;
let printerLanguage: "esc-pos" | "star-prnt" = "esc-pos";
let printerCodepageMapping = "epson";

/**
 * Cheap ESC/POS clones (and Android WebView) trip over ReceiptPrinterEncoder's
 * code-page tables — Print test threw "Cannot convert undefined or null to object"
 * before a single byte reached the printer. Receipts here are ASCII-only, so we
 * emit the standard initialize/align/bold/cut bytes ourselves.
 */
class EscPosBuilder {
  private readonly chunks: number[] = [];
  private alignment: "left" | "center" | "right" = "left";
  private readonly leftMargin: number;
  private readonly preview: ReceiptPreviewLine[] = [];

  constructor(leftMargin = 0) {
    this.leftMargin = leftMargin;
  }

  private push(...bytes: number[]) {
    this.chunks.push(...bytes);
    return this;
  }

  initialize() {
    // Cheap 58mm clones ignore Epson density/speed bytes (they printed as
    // garbage) and double-height made every receipt huge. Font A + bold is
    // what this head actually renders.
    this.alignment = "left";
    this.push(0x1b, 0x40);
    this.push(0x1b, 0x4d, 0x00); // Font A
    this.push(0x12, 0x23, 0x08); // DC2 # 8 — Gprinter/Zjiang density
    this.push(0x1b, 0x45, 0x01); // bold
    return this;
  }

  align(value: "left" | "center" | "right") {
    this.alignment = value;
    const n = value === "center" ? 1 : value === "right" ? 2 : 0;
    return this.push(0x1b, 0x61, n);
  }

  bold(value = true) {
    return this.push(0x1b, 0x45, value ? 1 : 0);
  }

  text(value: string) {
    const ascii = toPrinterAscii(value);
    for (let i = 0; i < ascii.length; i++) this.chunks.push(ascii.charCodeAt(i));
    return this;
  }

  line(value: string) {
    const padded =
      this.alignment === "left" && this.leftMargin > 0
        ? `${" ".repeat(this.leftMargin)}${value}`
        : value;
    this.preview.push({ align: this.alignment, text: padded });
    return this.text(padded).feed();
  }

  newline() {
    this.preview.push({ align: this.alignment, text: "" });
    return this.feed();
  }

  private feed() {
    return this.push(0x0a);
  }

  cut() {
    // One line of feed so the last text clears the blade — extra LFs here
    // were wasting a strip of blank paper after every receipt.
    return this.push(0x0a, 0x1d, 0x56, 0x42, 0x00);
  }

  pulse() {
    return this.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }

  /**
   * GS v 0 raster bit image. Width must be a multiple of 8. Cheap 58mm
   * heads ignore ESC a for graphics and clip the last ~24 dots, so callers
   * should already have padded the bitmap to sit inside that safe area.
   */
  raster(widthPx: number, heightPx: number, data: Uint8Array) {
    const widthBytes = widthPx / 8;
    this.push(0x1d, 0x76, 0x30, 0x00);
    this.push(widthBytes & 0xff, (widthBytes >> 8) & 0xff);
    this.push(heightPx & 0xff, (heightPx >> 8) & 0xff);
    for (let i = 0; i < data.length; i++) this.chunks.push(data[i]);
    return this;
  }

  logo() {
    this.preview.push({ align: "center", text: "", logo: true });
    const { width, height, data } = centeredReceiptIcon(state.paperWidth);
    return this.raster(width, height, data).feed();
  }

  getPreview(): ReceiptPreviewLine[] {
    return this.preview;
  }

  encode() {
    return Uint8Array.from(this.chunks);
  }
}

function toPrinterAscii(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, (ch) => {
    const map: Record<string, string> = {
      "₱": "P",
      "ñ": "n",
      "Ñ": "N",
      "—": "-",
      "–": "-",
      "’": "'",
      "‘": "'",
      "“": '"',
      "”": '"',
    };
    return map[ch] ?? "?";
  });
}

function createEncoder(_width?: number) {
  return new EscPosBuilder(SIDE_MARGIN);
}

function decodeReceiptIcon(): Uint8Array {
  const bin = atob(RECEIPT_ICON_BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Centers the 160px mark on the full 58mm (~384) or 80mm (~576) raster so
 * left and right paper margins match. Trailing dots stay blank, so the
 * faint right edge of this 58mm head cannot slice the icon.
 */
function centeredReceiptIcon(paperChars: 32 | 48): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const src = decodeReceiptIcon();
  const srcBytes = RECEIPT_ICON_WIDTH / 8;
  const paperDots = paperChars === 48 ? 576 : 384;
  const canvasBytes = paperDots / 8;
  const leftBytes = Math.floor((canvasBytes - srcBytes) / 2);
  const data = new Uint8Array(canvasBytes * RECEIPT_ICON_HEIGHT);
  for (let y = 0; y < RECEIPT_ICON_HEIGHT; y++) {
    data.set(src.subarray(y * srcBytes, y * srcBytes + srcBytes), y * canvasBytes + leftBytes);
  }
  return { width: paperDots, height: RECEIPT_ICON_HEIGHT, data };
}

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
  name?: string;
  serialVendorId?: number;
  serialProductId?: number;
}

interface NativePrinterBridge {
  isNative(): boolean;
  listPairedJson(): string;
  connect(mac: string): string;
  writeBase64(data: string): string;
  printTest?: () => string;
  disconnect(): string;
}

export interface PairedPrinter {
  id: string;
  name: string;
}

function getNativePrinterBridge(): NativePrinterBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { MarimarNativePrinter?: NativePrinterBridge }).MarimarNativePrinter;
  if (!bridge || typeof bridge.isNative !== "function") return null;
  try {
    return bridge.isNative() ? bridge : null;
  } catch {
    return null;
  }
}

export function isNativePrinterApp(): boolean {
  return getNativePrinterBridge() !== null;
}

export function listNativePairedPrinters(): PairedPrinter[] {
  const bridge = getNativePrinterBridge();
  if (!bridge) return [];
  try {
    const parsed = JSON.parse(bridge.listPairedJson()) as PairedPrinter[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name) : [];
  } catch {
    return [];
  }
}

export async function connectNativePrinter(printer: PairedPrinter): Promise<void> {
  const bridge = getNativePrinterBridge();
  if (!bridge) throw new Error("Open Marimar Inn from the tablet app to print.");
  const result = bridge.connect(printer.id);
  if (result !== "ok") throw new Error(result || "Couldn't connect to the printer.");
  printerLanguage = "esc-pos";
  printerCodepageMapping = "epson";
  state.kind = "native";
  state.name = printer.name;
  emit();
  const existing = loadStoredDevice();
  const paperWidth = existing?.paperWidth ?? state.paperWidth;
  state.paperWidth = paperWidth;
  saveStoredDevice({ kind: "native", paperWidth, bluetoothId: printer.id, name: printer.name });
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

export function isDrawerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DRAWER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDrawerEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DRAWER_KEY, enabled ? "1" : "0");
}

function onSerialConnected(info: SerialPrinterInfo) {
  printerLanguage = info.language;
  printerCodepageMapping = info.codepageMapping;
  state.kind = "serial";
  state.name = info.productName || "Serial printer";
  emit();

  const existing = loadStoredDevice();
  const paperWidth = existing?.paperWidth ?? state.paperWidth;
  state.paperWidth = paperWidth;
  saveStoredDevice({ kind: "serial", paperWidth, serialVendorId: info.vendorId, serialProductId: info.productId });
}

function onBleConnected(name: string, id: string, profile: BleLePrinterProfile) {
  printerLanguage = profile.language;
  printerCodepageMapping = profile.codepageMapping;
  state.kind = "bluetooth";
  state.name = name;
  emit();

  const existing = loadStoredDevice();
  const paperWidth = existing?.paperWidth ?? state.paperWidth;
  state.paperWidth = paperWidth;
  saveStoredDevice({ kind: "bluetooth", paperWidth, bluetoothId: id });
}

function onDisconnected() {
  blePrinter = null;
  state.kind = null;
  state.name = null;
  emit();
}

/**
 * Connects the GATT server on an already-picked/already-authorized device
 * and finds whichever printer profile's service+characteristic it exposes.
 */
async function connectBleCharacteristic(device: BluetoothDevice): Promise<void> {
  if (!device.gatt) throw new Error("Device has no GATT server.");
  device.addEventListener("gattserverdisconnected", onDisconnected);
  const server = await device.gatt.connect();

  let lastError: unknown;
  for (const profile of BLE_PRINTER_PROFILES) {
    try {
      const service = await server.getPrimaryService(profile.serviceUuid);
      const characteristic = await service.getCharacteristic(profile.characteristicUuid);
      // Many cheap generic ESC/POS clones (this app's RPP02N included) only
      // expose "Write Without Response" on their print characteristic —
      // calling writeValueWithResponse() on those is rejected immediately,
      // with no paper feed and previously no error surfaced at all (that
      // rejection used to happen inside an unguarded async queue in the npm
      // library this replaces). Checking what the characteristic actually
      // advertises and matching the write call to it avoids that whole
      // class of failure instead of guessing.
      const writeWithoutResponse =
        characteristic.properties.writeWithoutResponse && !characteristic.properties.write;
      blePrinter = { device, characteristic, writeWithoutResponse };
      onBleConnected(device.name ?? "Bluetooth printer", device.id, profile);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No matching printer service found on this device.");
}

const BLE_ALL_FILTERS = BLE_PRINTER_PROFILES.flatMap((p) => p.filters);
const BLE_OPTIONAL_SERVICES = Array.from(new Set(BLE_PRINTER_PROFILES.map((p) => p.serviceUuid)));

/** Must be called from a click handler — browsers require a user gesture to open the device picker. */
export async function connectBluetoothPrinter(): Promise<void> {
  const device = await navigator.bluetooth.requestDevice({
    filters: BLE_ALL_FILTERS,
    optionalServices: BLE_OPTIONAL_SERVICES,
  });
  await connectBleCharacteristic(device);
}

/** Must be called from a click handler — browsers require a user gesture to open the port picker. */
export async function connectSerialPrinter(): Promise<void> {
  serialPrinter = new WebSerialReceiptPrinter();
  serialPrinter.addEventListener("connected", (info) => onSerialConnected(info));
  serialPrinter.addEventListener("disconnected", onDisconnected);
  await serialPrinter.connect();
}

/**
 * "Connecting" via RawBT isn't a real connection at all — RawBT (a small
 * Android app whose only job is bridging web pages to classic-Bluetooth
 * printers, see sendViaRawBt() below) does its own pairing/connection to
 * the printer entirely outside this page. There's nothing to negotiate
 * here beyond remembering that this is the print path to use.
 */
export async function connectRawBtPrinter(): Promise<void> {
  state.kind = "rawbt";
  state.name = "RawBT app";
  emit();

  const existing = loadStoredDevice();
  const paperWidth = existing?.paperWidth ?? state.paperWidth;
  state.paperWidth = paperWidth;
  saveStoredDevice({ kind: "rawbt", paperWidth });
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
  // guard, opening a dialog while already connected would re-run the whole
  // reconnect flow on top of a perfectly working connection — clobbering
  // the working characteristic reference with a fresh (and possibly
  // failed) one if the redundant attempt races or fails partway through.
  // The UI would keep showing "Connected" (state.kind is untouched unless
  // a fresh attempt actually succeeds or the device fires its own
  // disconnect event) while prints silently go nowhere.
  if (state.kind !== null) return;

  const stored = loadStoredDevice();
  if (!stored) return;
  state.paperWidth = stored.paperWidth;

  try {
    if (stored.kind === "bluetooth" && stored.bluetoothId) {
      if (!navigator.bluetooth.getDevices) return;
      const devices = await navigator.bluetooth.getDevices();
      const device = devices.find((d) => d.id === stored.bluetoothId);
      if (device) await connectBleCharacteristic(device);
    } else if (stored.kind === "serial") {
      serialPrinter = new WebSerialReceiptPrinter();
      serialPrinter.addEventListener("connected", (info) => onSerialConnected(info));
      serialPrinter.addEventListener("disconnected", onDisconnected);
      await serialPrinter.reconnect({
        vendorId: stored.serialVendorId,
        productId: stored.serialProductId,
      });
    } else if (stored.kind === "rawbt") {
      // Nothing to reconnect — see connectRawBtPrinter().
      state.kind = "rawbt";
      state.name = "RawBT app";
      emit();
    } else if (stored.kind === "native" && stored.bluetoothId) {
      const name = stored.name ?? "Bluetooth printer";
      await connectNativePrinter({ id: stored.bluetoothId, name });
    }
  } catch {
    // No previously-authorized device found (or permission wasn't retained) — stays disconnected.
  }
}

export function disconnectPrinter() {
  const native = getNativePrinterBridge();
  if (state.kind === "native" && native) {
    try {
      native.disconnect();
    } catch {
      // Already gone.
    }
  }
  if (blePrinter?.device.gatt?.connected) {
    try {
      blePrinter.device.gatt.disconnect();
    } catch {
      // Already gone.
    }
  }
  blePrinter = null;
  serialPrinter = null;
  state.kind = null;
  state.name = null;
  emit();
}

export function setPaperWidth(width: 32 | 48) {
  state.paperWidth = width;
  const stored = loadStoredDevice();
  if (stored) saveStoredDevice({ ...stored, paperWidth: width });
  emit();
}

const BLE_CHUNK_SIZE = 100;
// "Write Without Response" gets no acknowledgment from the printer, so
// pacing chunks avoids overrunning cheap printer firmware's receive
// buffer — there's no flow control to push back if we write too fast.
const BLE_CHUNK_DELAY_MS = 20;
const PRINT_TIMEOUT_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBleData(printer: ConnectedBlePrinter, data: Uint8Array): Promise<void> {
  // The split writeValueWithResponse()/writeValueWithoutResponse() methods
  // are relatively recent (~2020) — an older Chrome build (common on
  // budget/older Android tablets that don't auto-update) may not have them
  // at all, only the original writeValue(), which predates the
  // with/without-response distinction and just uses whichever mode the
  // characteristic supports under the hood. Feature-detect and fall back
  // rather than assuming the newer methods exist.
  const characteristic = printer.characteristic;
  const hasWithoutResponse = typeof characteristic.writeValueWithoutResponse === "function";
  const hasWithResponse = typeof characteristic.writeValueWithResponse === "function";

  for (let offset = 0; offset < data.length; offset += BLE_CHUNK_SIZE) {
    const chunk = data.subarray(offset, offset + BLE_CHUNK_SIZE);
    if (printer.writeWithoutResponse && hasWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
      await sleep(BLE_CHUNK_DELAY_MS);
    } else if (!printer.writeWithoutResponse && hasWithResponse) {
      await characteristic.writeValueWithResponse(chunk);
    } else if (characteristic.writeValue) {
      await characteristic.writeValue(chunk);
      await sleep(BLE_CHUNK_DELAY_MS);
    } else {
      throw new Error("This browser's Bluetooth support is too old to print.");
    }
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function withDrawerKick(data: Uint8Array, kick?: boolean): Uint8Array {
  if (!kick) return data;
  const pulse = new EscPosBuilder().pulse().encode();
  const combined = new Uint8Array(data.length + pulse.length);
  combined.set(data, 0);
  combined.set(pulse, data.length);
  return combined;
}

export function printerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message ?? "").trim();
    if (message) return message;
  }
  try {
    const text = String(error ?? "").trim();
    if (text && text !== "[object Object]") return text;
  } catch {
    // Ignore stringify failures from Java host objects.
  }
  return "The thermal printer didn't respond.";
}

const RAWBT_PACKAGE = "ru.a402d.rawbtprinter";

/**
 * RawBT (rawbt.ru) is a small Android app that does its own classic-
 * Bluetooth (SPP) pairing and connection to the printer — something no
 * browser can do — and registers a "rawbt:" intent scheme any page can
 * open to hand it a raw print job. Opening this link is fire-and-forget:
 * unlike the direct Bluetooth/Serial paths above, this page has no way to
 * find out whether RawBT actually received the job or the printer actually
 * printed it, only that Android was asked to open the link. Opened in a
 * new window rather than navigating the current tab so a missing-app
 * fallback (Play Store) doesn't blow away whatever's on screen mid-checkout.
 */
function sendViaRawBt(data: Uint8Array): void {
  const base64 = uint8ArrayToBase64(data);
  // Chrome on Android silently blocks window.open() of intent: URLs (and
  // custom schemes after an await), so the previous popup never reached
  // RawBT even when the app was installed. An iframe src assignment is
  // what Android Chrome actually delivers to the registered handler.
  const intentUrl = `intent:base64,${base64}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};end`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.display = "none";
  iframe.src = intentUrl;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 4000);
}

async function send(data: Uint8Array): Promise<void> {
  if (state.kind === "rawbt") {
    sendViaRawBt(data);
    return;
  }

  if (state.kind === "native") {
    const bridge = getNativePrinterBridge();
    if (!bridge) throw new Error("Open Marimar Inn from the tablet app to print.");
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
    try {
      const payload = uint8ArrayToBase64(bytes);
      const result = String(bridge.writeBase64(payload) ?? "").trim();
      if (result !== "ok") throw new Error(result || "The printer didn't accept the job.");
    } catch (error) {
      throw new Error(printerErrorMessage(error));
    }
    return;
  }

  let printPromise: Promise<unknown>;
  if (state.kind === "bluetooth" && blePrinter) {
    printPromise = writeBleData(blePrinter, data);
  } else if (state.kind === "serial" && serialPrinter) {
    printPromise = serialPrinter.print(data);
  } else {
    throw new Error("No thermal printer connected.");
  }

  // Guards against a hung write (e.g. a dead connection the
  // gattserverdisconnected event hasn't caught up with yet) turning into a
  // frozen flow instead of a normal, catchable error.
  await Promise.race([
    printPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Printer didn't respond in time.")), PRINT_TIMEOUT_MS)
    ),
  ]);
}

function layoutWidth(paperWidth: number) {
  // Same gap on both sides — the old paperWidth-3 inset only ate the right
  // edge, so every line looked shoved left. Three columns on the left match
  // the three weak columns on the right of this 58mm head.
  return Math.max(20, paperWidth - SIDE_MARGIN * 2);
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
  kickDrawer?: boolean;
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

function guestReceiptEncoder(booking: Booking, room: Room, extras: ReceiptExtras) {
  const width = layoutWidth(state.paperWidth);
  const encoder = createEncoder(width);

  encoder
    .initialize()
    .align("center")
    .logo()
    .line("Marimar Inn")
    .line("This is not an official receipt")
    .line(`Ref: ${referenceNumberFor(booking.bookingId)}`)
    .newline()
    .align("left")
    .line(twoColumn("Room", room.roomNumber, width))
    .line(twoColumn("Guest", booking.guestName, width))
    .line(`In: ${booking.checkInTime.toDate().toLocaleString()}`)
    .line(`Out: ${new Date().toLocaleString()}`)
    .newline()
    .line(twoColumn(`Room (${booking.hoursBooked}h)`, money(booking.totalRoomCharge), width));

  for (const item of booking.items ?? []) {
    encoder.line(
      twoColumn(`${item.quantity}x ${item.name}`, money(item.subtotal), width)
    );
  }
  if (booking.totalFbCharge > 0) {
    encoder.line(twoColumn("Store items", money(booking.totalFbCharge), width));
  }

  encoder
    .newline()
    .line(twoColumn("Total", money(booking.totalAmount), width));

  const portions = paymentPortionLines({
    cash: booking.splitCashAmount ?? 0,
    gcash: booking.splitGcashAmount ?? 0,
    qrph: booking.splitQrphAmount ?? 0,
  });
  if (portions.length > 1) {
    for (const line of portions) {
      encoder.line(twoColumn(`Paid (${line.label})`, money(line.amount), width));
    }
  } else {
    encoder.line(
      twoColumn(`Paid (${PAYMENT_METHOD_LABELS[booking.paymentMethod]})`, money(extras.finalAmountPaid), width)
    );
  }

  if (booking.gcashReference) {
    encoder.line(`GCash Ref: ${booking.gcashReference}`);
  }
  if (booking.qrphReference) {
    encoder.line(`QRPh Ref: ${booking.qrphReference}`);
  }

  if (extras.change > 0) {
    encoder.line(twoColumn("Change", money(extras.change), width));
  }

  encoder
    .newline()
    .align("center")
    .line(`Staff: ${extras.staffName}`)
    .newline()
    .line("Thank you for staying!")
    .cut();

  return encoder;
}

export function buildReceiptBytes(booking: Booking, room: Room, extras: ReceiptExtras): Uint8Array {
  return guestReceiptEncoder(booking, room, extras).encode();
}

export function previewGuestReceipt(
  booking: Booking,
  room: Room,
  extras: ReceiptExtras
): ReceiptPreviewLine[] {
  return guestReceiptEncoder(booking, room, extras).getPreview();
}

export async function printThermalReceipt(booking: Booking, room: Room, extras: ReceiptExtras) {
  await send(withDrawerKick(buildReceiptBytes(booking, room, extras), extras.kickDrawer));
}

export interface ExtensionReceiptExtras {
  staffName: string;
  hours: number;
  amountCharged: number;
  amountPaid: number;
  change: number;
  paymentMethod: PaymentMethod;
  gcashReference?: string;
  qrphReference?: string;
  splitCashAmount?: number;
  splitGcashAmount?: number;
  splitQrphAmount?: number;
  kickDrawer?: boolean;
}

/**
 * A short, standalone receipt for a single "+1 hour" extension payment —
 * distinct from buildReceiptBytes(), which reprints the booking's whole
 * running total. Re-printing the full total here would look like the guest
 * is being charged for the original package again on top of the extension.
 */
function extensionReceiptEncoder(
  booking: Booking,
  room: Room,
  extras: ExtensionReceiptExtras
) {
  const width = layoutWidth(state.paperWidth);
  const encoder = createEncoder(width);

  encoder
    .initialize()
    .align("center")
    .logo()
    .line("Marimar Inn")
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
    .line(twoColumn("Total", money(extras.amountCharged), width));

  const portions = paymentPortionLines({
    cash: extras.splitCashAmount ?? (extras.paymentMethod === "cash" ? extras.amountPaid : 0),
    gcash: extras.splitGcashAmount ?? (extras.paymentMethod === "gcash" ? extras.amountPaid : 0),
    qrph: extras.splitQrphAmount ?? (extras.paymentMethod === "qrph" ? extras.amountPaid : 0),
  });
  if (portions.length > 1) {
    for (const line of portions) {
      encoder.line(twoColumn(`Paid (${line.label})`, money(line.amount), width));
    }
  } else {
    encoder.line(
      twoColumn(`Paid (${PAYMENT_METHOD_LABELS[extras.paymentMethod]})`, money(extras.amountPaid), width)
    );
  }

  if (extras.gcashReference) {
    encoder.line(`GCash Ref: ${extras.gcashReference}`);
  }
  if (extras.qrphReference) {
    encoder.line(`QRPh Ref: ${extras.qrphReference}`);
  }

  if (extras.change > 0) {
    encoder.line(twoColumn("Change", money(extras.change), width));
  }

  encoder
    .newline()
    .align("center")
    .line(`Staff: ${extras.staffName}`)
    .newline()
    .line("Thank you for staying!")
    .cut();

  return encoder;
}

export function buildExtensionReceiptBytes(
  booking: Booking,
  room: Room,
  extras: ExtensionReceiptExtras
): Uint8Array {
  return extensionReceiptEncoder(booking, room, extras).encode();
}

export function previewExtensionReceipt(
  booking: Booking,
  room: Room,
  extras: ExtensionReceiptExtras
): ReceiptPreviewLine[] {
  return extensionReceiptEncoder(booking, room, extras).getPreview();
}

export async function printExtensionReceipt(booking: Booking, room: Room, extras: ExtensionReceiptExtras) {
  await send(withDrawerKick(buildExtensionReceiptBytes(booking, room, extras), extras.kickDrawer));
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
  qrphReference?: string;
}

export interface DailySalesReceiptTotals {
  totalRoomAmount: number;
  totalStoreAmount: number;
  totalPaid: number;
  cashCollected: number;
  gcashCollected: number;
  qrphCollected: number;
}

export interface DailySalesReceiptExpense {
  timeLabel: string;
  shiftLabel: string;
  description: string;
  cashierName: string;
  amount: number;
}

export interface DailySalesReceiptData {
  dateLabel: string;
  frontDesk?: string;
  housekeeping?: string;
  dutyTime?: string;
  rows: DailySalesReceiptRow[];
  totals: DailySalesReceiptTotals;
  expenses?: DailySalesReceiptExpense[];
}

/**
 * The on-screen/Excel Daily Sales Report has 15 columns — meant for a full
 * sheet of paper. A thermal printer is only 32-48 characters wide, so this
 * is a genuinely different, compact layout (one short block per booking)
 * rather than the same table shrunk down.
 */
function dailySalesReceiptEncoder(data: DailySalesReceiptData) {
  const width = layoutWidth(state.paperWidth);
  const rule = "-".repeat(width);
  const encoder = createEncoder(width);

  encoder
    .initialize()
    .align("center")
    .logo()
    .line("Marimar Inn")
    .line("Daily Sales Report");

  if (data.dutyTime === "FULL DAY") encoder.line("FULL DAY");

  encoder.line(clampLine(data.dateLabel, width));

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
        encoder.line(clampLine(`  GCash: ${row.gcashReference}`, width));
      }
      if (row.qrphReference) {
        encoder.line(clampLine(`  QRPh: ${row.qrphReference}`, width));
      }
      encoder.line(rule);
    }
  }

  const expenseTotal = (data.expenses ?? []).reduce((sum, expense) => sum + expense.amount, 0);
  const overallSale = data.totals.totalRoomAmount + data.totals.totalStoreAmount;

  encoder
    .bold(true)
    .line(twoColumn("Room total", money(data.totals.totalRoomAmount), width))
    .line(twoColumn("Store total", money(data.totals.totalStoreAmount), width))
    .bold(false)
    .newline()
    .line(twoColumn("Cash collected", money(data.totals.cashCollected), width));

  if (data.expenses && data.expenses.length > 0) {
    encoder.newline().line("Expenses");
    for (const expense of data.expenses) {
      encoder.line(clampLine(`${expense.timeLabel} ${expense.shiftLabel} ${expense.cashierName}`, width));
      encoder.line(twoColumn(`  ${expense.description}`, money(expense.amount), width));
    }
    encoder
      .line(twoColumn("Expenses total", money(expenseTotal), width))
      .line(twoColumn("Net cash", money(data.totals.cashCollected - expenseTotal), width));
  }

  encoder
    .line(twoColumn("GCash collected", money(data.totals.gcashCollected), width))
    .line(twoColumn("QRPh collected", money(data.totals.qrphCollected), width))
    .line(twoColumn("Total collected", money(data.totals.totalPaid), width));

  if (expenseTotal > 0) {
    encoder.line(twoColumn("Net after expenses", money(data.totals.totalPaid - expenseTotal), width));
  }

  encoder
    .newline()
    .bold(true)
    .line(twoColumn("OVERALL SALE", money(overallSale), width));
  if (expenseTotal > 0) {
    encoder.line(twoColumn("NET SALES", money(overallSale - expenseTotal), width));
  }
  encoder
    .bold(false)
    .newline()
    .newline()
    .line("Prepared by: __________")
    .newline()
    .line("Checked by:  __________")
    .newline()
    .line("Noted by:    __________")
    .cut();

  return encoder;
}

export function buildDailySalesReceiptBytes(data: DailySalesReceiptData): Uint8Array {
  return dailySalesReceiptEncoder(data).encode();
}

export function previewDailySalesReceipt(data: DailySalesReceiptData): ReceiptPreviewLine[] {
  return dailySalesReceiptEncoder(data).getPreview();
}

export async function printDailySalesReceipt(data: DailySalesReceiptData) {
  await send(buildDailySalesReceiptBytes(data));
}

function testPageEncoder() {
  const encoder = createEncoder();
  encoder
    .initialize()
    .align("center")
    .logo()
    .line("Marimar Inn")
    .line("Printer test")
    .newline()
    .align("left")
    .line(new Date().toLocaleString("en-PH"))
    .cut();
  return encoder;
}

export function previewTestPage(): ReceiptPreviewLine[] {
  return testPageEncoder().getPreview();
}

export async function printTestPage() {
  await send(testPageEncoder().encode());
}

/** Sends the drawer-kick pulse — the drawer must be cabled into the printer's RJ11 port. */
export async function openCashDrawer() {
  const encoder = createEncoder();
  await send(encoder.pulse().encode());
}

/**
 * Opens the drawer only when this payment actually includes cash — GCash
 * and QRPh stay closed. Also stays closed until the header "Drawer" switch
 * is turned on (no hardware yet).
 */
export function shouldOpenDrawer(cashCollectedNow: number): boolean {
  return isDrawerEnabled() && cashCollectedNow > 0;
}
