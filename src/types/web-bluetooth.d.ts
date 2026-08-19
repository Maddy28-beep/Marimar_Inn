// Web Bluetooth isn't part of TypeScript's standard DOM lib (it's a
// non-standard/experimental API) — minimal ambient declarations covering
// only the subset this app actually calls directly, same convention as
// point-of-sale.d.ts for the untyped printer packages.

interface BluetoothCharacteristicProperties {
  readonly write: boolean;
  readonly writeWithoutResponse: boolean;
}

interface BluetoothRemoteGATTCharacteristic {
  readonly properties: BluetoothCharacteristicProperties;
  writeValueWithResponse(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse(value: Uint8Array): Promise<void>;
  // Older browsers only ever had this original method, predating the split
  // with/without-response methods above — optional since modern Chrome
  // still exposes it too, but code should prefer the split methods when
  // they're available.
  writeValue?(value: Uint8Array): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothLEScanFilter {
  name?: string;
  namePrefix?: string;
  services?: string[];
}

interface RequestDeviceOptions {
  filters: BluetoothLEScanFilter[];
  optionalServices?: string[];
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  getDevices?(): Promise<BluetoothDevice[]>;
}

interface Navigator {
  bluetooth: Bluetooth;
}
