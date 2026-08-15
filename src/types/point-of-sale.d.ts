// These packages ship untyped JS builds — minimal ambient declarations
// covering only what this app actually calls, based on their published
// READMEs (github.com/NielsLeenheer/ReceiptPrinterEncoder,
// WebBluetoothReceiptPrinter, WebSerialReceiptPrinter).

declare module "@point-of-sale/receipt-printer-encoder" {
  export interface ReceiptPrinterEncoderOptions {
    language?: "esc-pos" | "star-prnt";
    codepageMapping?: string;
    width?: number;
  }

  export default class ReceiptPrinterEncoder {
    constructor(options?: ReceiptPrinterEncoderOptions);
    initialize(): this;
    align(value: "left" | "center" | "right"): this;
    bold(value?: boolean): this;
    underline(value?: boolean): this;
    text(value: string): this;
    line(value: string): this;
    newline(): this;
    rule(): this;
    cut(value?: "full" | "partial"): this;
    pulse(pin?: number, on?: number, off?: number): this;
    encode(): Uint8Array;
  }
}

declare module "@point-of-sale/webbluetooth-receipt-printer" {
  export interface ConnectedPrinterInfo {
    type: "bluetooth";
    name: string;
    id: string;
    language: "esc-pos" | "star-prnt";
    codepageMapping: string;
  }

  export default class WebBluetoothReceiptPrinter {
    connect(): Promise<void>;
    reconnect(lastUsedDevice: { id: string }): Promise<void>;
    print(data: Uint8Array): void;
    addEventListener(type: "connected", listener: (device: ConnectedPrinterInfo) => void): void;
    addEventListener(type: "disconnected", listener: () => void): void;
    addEventListener(type: string, listener: (payload: unknown) => void): void;
  }
}

declare module "@point-of-sale/webserial-receipt-printer" {
  export interface WebSerialReceiptPrinterOptions {
    baudRate?: number;
    bufferSize?: number;
    dataBits?: 7 | 8;
    flowControl?: "none" | "hardware";
    parity?: "none" | "even" | "odd";
    stopBits?: 1 | 2;
  }

  export interface ConnectedPrinterInfo {
    type: "serial";
    vendorId?: number;
    productId?: number;
    manufacturerName?: string;
    productName?: string;
    serialNumber?: string;
    language: "esc-pos" | "star-prnt";
    codepageMapping: string;
  }

  export default class WebSerialReceiptPrinter {
    constructor(options?: WebSerialReceiptPrinterOptions);
    connect(): Promise<void>;
    reconnect(lastUsedDevice: { vendorId?: number; productId?: number }): Promise<void>;
    print(data: Uint8Array): void;
    addEventListener(type: "connected", listener: (device: ConnectedPrinterInfo) => void): void;
    addEventListener(type: "disconnected", listener: () => void): void;
    addEventListener(type: string, listener: (payload: unknown) => void): void;
  }
}
