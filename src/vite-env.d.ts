/// <reference types="vite/client" />

// ============================================================
// WebUSB type declarations
// ============================================================
interface USBEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  packetSize: number;
}

interface USBAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  interfaceName?: string;
  endpoints: USBEndpoint[];
}

interface USBInterface {
  interfaceNumber: number;
  alternates: USBAlternateInterface[];
  claimed: boolean;
}

interface USBConfiguration {
  configurationValue: number;
  configurationName?: string;
  interfaces: USBInterface[];
}

interface USBOutTransferResult {
  bytesWritten: number;
  status: 'ok' | 'stall' | 'babble';
}

interface USBInTransferResult {
  data: DataView;
  status: 'ok' | 'stall' | 'babble';
}

interface USBDevice {
  vendorId: number;
  productId: number;
  deviceClass: number;
  deviceSubclass: number;
  deviceProtocol: number;
  manufacturerName?: string;
  productName?: string;
  serialNumber?: string;
  configuration: USBConfiguration | null;
  configurations: USBConfiguration[];
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: BufferSource
  ): Promise<USBOutTransferResult>;
  transferIn(
    endpointNumber: number,
    length: number
  ): Promise<USBInTransferResult>;
}

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

interface USBConnectionEvent extends Event {
  device: USBDevice;
}

interface USB {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
  addEventListener(
    type: 'connect' | 'disconnect',
    listener: (e: USBConnectionEvent) => void
  ): void;
  removeEventListener(
    type: 'connect' | 'disconnect',
    listener: (e: USBConnectionEvent) => void
  ): void;
}

interface Navigator {
  usb?: USB;
}