/// <reference types="vite/client" />

// WebUSB type declarations
interface USBDevice {
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  configuration: {
    interfaces: Array<{
      alternates: Array<{
        endpoints: Array<{
          endpointNumber: number;
          direction: string;
        }>;
      }>;
    }>;
  } | null;
  transferOut(endpointNumber: number, data: BufferSource): Promise<unknown>;
}

interface USB {
  requestDevice(options: { filters: Array<Record<string, unknown>> }): Promise<USBDevice>;
}

interface Navigator {
  usb?: USB;
}
