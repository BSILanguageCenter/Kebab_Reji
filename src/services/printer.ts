import type { Order, CartItem } from '@/types/database';
import { formatYen } from '@/locale/format';

export interface PrinterResult {
  success: boolean;
  error?: string;
}

export interface PrinterAdapter {
  printCustomerTicket(order: Order): Promise<PrinterResult>;
  printKitchenOrder(order: Order): Promise<PrinterResult>;
  isAvailable(): Promise<boolean>;
}

function buildOrderLines(order: Order): string {
  if (!order.order_items) return '';
  return order.order_items
    .map((item) => {
      let line = `${item.short_name || item.name}`;
      if (item.variant) line += ` ${item.variant}`;
      line += ` x${item.quantity}`;
      if (item.options && item.options.length > 0) {
        const opts = item.options.map((o) => o.name).join(', ');
        line += `\n  + ${opts}`;
      }
      return line;
    })
    .join('\n');
}

function buildCartLines(cartItems: CartItem[]): string {
  return cartItems
    .map((item) => {
      let line = `${item.short_name || item.name}`;
      if (item.variant) line += ` ${item.variant}`;
      line += ` x${item.quantity}`;
      if (item.options.length > 0) {
        const opts = item.options.map((o) => o.name).join(', ');
        line += `\n  + ${opts}`;
      }
      return line;
    })
    .join('\n');
}

function buildCustomerTicketText(order: Order): string {
  const divider = '------------------------';
  const lines: string[] = [
    divider,
    '       KEBAB POS',
    `      ORDER #${order.order_number}`,
    divider,
    '',
    order.order_type,
    '',
    buildOrderLines(order),
    '',
    divider,
    `      TOTAL ${formatYen(order.total_amount)}`,
    divider,
  ];
  return lines.join('\n');
}

function buildKitchenTicketText(order: Order): string {
  const divider = '====================';
  const lines: string[] = [
    divider,
    '      KEBAB POS',
    divider,
    '',
    `ORDER #${order.order_number}`,
    order.order_type,
    '',
    buildOrderLines(order),
    '',
    divider,
  ];
  return lines.join('\n');
}

class ConsolePrinterAdapter implements PrinterAdapter {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async printCustomerTicket(order: Order): Promise<PrinterResult> {
    try {
      console.log('=== CUSTOMER TICKET ===');
      console.log(buildCustomerTicketText(order));
      console.log('=== END TICKET ===');
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown print error' };
    }
  }

  async printKitchenOrder(order: Order): Promise<PrinterResult> {
    try {
      console.log('=== KITCHEN TICKET ===');
      console.log(buildKitchenTicketText(order));
      console.log('=== END TICKET ===');
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown print error' };
    }
  }
}

class WebUsbPrinterAdapter implements PrinterAdapter {
  private device: USBDevice | null = null;

  async isAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('usb' in navigator)) return false;
    return true;
  }

  async connect(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('usb' in navigator)) return false;
    try {
      const device = await (navigator as unknown as { usb: USB }).usb.requestDevice({
        filters: [{ classCode: 7 }],
      });
      await device.open();
      if (device.configuration === null) await device.selectConfiguration(1);
      await device.claimInterface(0);
      this.device = device;
      return true;
    } catch {
      return false;
    }
  }

  private async print(text: string): Promise<void> {
    if (!this.device) throw new Error('Printer not connected');
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const config = this.device.configuration;
    if (!config) throw new Error('No configuration');
    const endpointNumber = config.interfaces[0].alternates[0].endpoints.find(
      (e: { direction: string; endpointNumber: number }) => e.direction === 'out'
    )?.endpointNumber;
    if (!endpointNumber) throw new Error('No output endpoint');
    await this.device.transferOut(endpointNumber, data);
  }

  async printCustomerTicket(order: Order): Promise<PrinterResult> {
    try {
      await this.print(buildCustomerTicketText(order));
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Print failed' };
    }
  }

  async printKitchenOrder(order: Order): Promise<PrinterResult> {
    try {
      await this.print(buildKitchenTicketText(order));
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Print failed' };
    }
  }
}

let currentAdapter: PrinterAdapter = new ConsolePrinterAdapter();

export function getPrinter(): PrinterAdapter {
  return currentAdapter;
}

export function setPrinter(adapter: PrinterAdapter): void {
  currentAdapter = adapter;
}

export function setConsolePrinter(): void {
  currentAdapter = new ConsolePrinterAdapter();
}

export function setWebUsbPrinter(): void {
  currentAdapter = new WebUsbPrinterAdapter();
}

export async function printCustomerTicket(order: Order): Promise<PrinterResult> {
  return currentAdapter.printCustomerTicket(order);
}

export async function printKitchenOrder(order: Order): Promise<PrinterResult> {
  return currentAdapter.printKitchenOrder(order);
}

export function buildCustomerTicket(order: Order): string {
  return buildCustomerTicketText(order);
}

export function buildKitchenTicket(order: Order): string {
  return buildKitchenTicketText(order);
}

export function buildCartTicket(cartItems: CartItem[], orderNumber: number, orderType: string, total: number): string {
  const divider = '------------------------';
  const lines: string[] = [
    divider,
    '       KEBAB POS',
    `      ORDER #${orderNumber}`,
    divider,
    '',
    orderType,
    '',
    buildCartLines(cartItems),
    '',
    divider,
    `      TOTAL ${formatYen(total)}`,
    divider,
  ];
  return lines.join('\n');
}
