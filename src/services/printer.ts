import type { Order, CartItem, OrderItem } from '@/types/database';
import { formatYen, formatTime } from '@/locale/format';

export interface PrinterResult {
  success: boolean;
  error?: string;
}

export interface PrinterAdapter {
  printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult>;
  printKitchenOrder(order: Order): Promise<PrinterResult>;
  isAvailable(): Promise<boolean>;
}

// ============================================================
// ОБЩИЕ УТИЛИТЫ
// ============================================================
const WIDTH = 32;
const DIVIDER = '-'.repeat(WIDTH);
const DIVIDER_HEAVY = '='.repeat(WIDTH);

function center(text: string, width = WIDTH): string {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function padBetween(left: string, right: string, width = WIDTH): string {
  const gap = width - left.length - right.length;
  if (gap < 1) return `${left} ${right}`;
  return left + ' '.repeat(gap) + right;
}

// ============================================================
// КУХОННЫЙ ЧЕК
// ============================================================
function formatKitchenItem(item: OrderItem): string[] {
  const out: string[] = [];

  let name = item.name;
  if (item.variant) name += ` [${item.variant}]`;

  const qty = `${item.quantity}x`;
  out.push(`${qty.padEnd(4)}${name}`);

  // Опции (property / sauce / extra / topping) с отступом.
  // type === 'variant' пропускаем — он уже показан в скобках [Chicken].
  for (const opt of item.options ?? []) {
    if (opt.type === 'variant') continue;
    const suffix = opt.quantity > 1 ? ` x${opt.quantity}` : '';
    out.push(`    + ${opt.name}${suffix}`);
  }

  return out;
}

function buildKitchenTicketText(order: Order): string {
  const lines: string[] = [];

  lines.push(DIVIDER_HEAVY);
  lines.push(center('K I T C H E N'));
  lines.push(DIVIDER_HEAVY);
  lines.push('');

  lines.push(center(`#${order.order_number}`));
  lines.push('');
  lines.push(center(formatTime(order.created_at)));
  lines.push('');
  lines.push(DIVIDER);

  const activeItems = (order.order_items ?? []).filter(
    (i) => !i.is_removed
  );

  if (activeItems.length === 0) {
    lines.push(center('(empty)'));
  } else {
    for (const item of activeItems) {
      lines.push(...formatKitchenItem(item));
      lines.push('');
    }
  }

  lines.push(DIVIDER);

  if (order.comment && order.comment.trim()) {
    lines.push('');
    lines.push(`!!! NOTE: ${order.comment}`);
    lines.push('');
    lines.push(DIVIDER);
  }

  lines.push('');
  lines.push(DIVIDER_HEAVY);
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// ЧЕК КЛИЕНТУ (номерок + время ожидания)
//
//   ================================
//              KEBAB POS
//   ================================
//
//
//                #1234
//
//
//              ~15 min
//
//
//   ================================
// ============================================================
function buildCustomerTicketText(
  order: Order,
  estimatedMinutes?: number
): string {
  const lines: string[] = [];

  lines.push(DIVIDER_HEAVY);
  lines.push(center('KEBAB POS'));
  lines.push(DIVIDER_HEAVY);
  lines.push('');
  lines.push('');

  lines.push(center(`#${order.order_number}`, WIDTH));
  lines.push('');

  if (estimatedMinutes && estimatedMinutes > 0) {
    lines.push('');
    lines.push(center(`~${estimatedMinutes} min`, WIDTH));
    lines.push('');
  }

  lines.push('');
  lines.push(DIVIDER_HEAVY);
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// ЧЕК ДЛЯ КОРЗИНЫ (предпросмотр до создания заказа)
// ============================================================
export function buildCartTicket(
  cartItems: CartItem[],
  orderNumber: number,
  orderType: string,
  total: number
): string {
  const lines: string[] = [];

  lines.push(center('KEBAB POS'));
  lines.push(center(`ORDER #${orderNumber}`));
  lines.push(DIVIDER);
  lines.push('');
  lines.push(center(orderType));
  lines.push('');

  for (const item of cartItems) {
    let name = item.name;
    if (item.variant) name += ` [${item.variant}]`;
    const left = `${item.quantity}x ${name}`;
    const right =
      item.price === 0 ? 'FREE' : formatYen(item.price * item.quantity);
    lines.push(padBetween(left, right));
    if (item.options && item.options.length > 0) {
      for (const o of item.options) {
        if (o.type === 'variant') continue;
        const q = o.quantity > 1 ? ` x${o.quantity}` : '';
        lines.push(`    + ${o.name}${q}`);
      }
    }
  }

  lines.push('');
  lines.push(DIVIDER);
  lines.push(padBetween('TOTAL', formatYen(total)));
  lines.push(DIVIDER);
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// АДАПТЕРЫ
// ============================================================
class ConsolePrinterAdapter implements PrinterAdapter {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult> {
    try {
      console.log('');
      console.log('┌──────── CUSTOMER TICKET ────────┐');
      console.log(buildCustomerTicketText(order, estimatedMinutes));
      console.log('└─────────────────────────────────┘');
      console.log('');
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown print error',
      };
    }
  }

  async printKitchenOrder(order: Order): Promise<PrinterResult> {
    try {
      console.log('');
      console.log('┌──────── KITCHEN TICKET ─────────┐');
      console.log(buildKitchenTicketText(order));
      console.log('└─────────────────────────────────┘');
      console.log('');
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown print error',
      };
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
      const device = await (
        navigator as unknown as { usb: USB }
      ).usb.requestDevice({ filters: [{ classCode: 7 }] });
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
      (e) => e.direction === 'out'
    )?.endpointNumber;
    if (!endpointNumber) throw new Error('No output endpoint');
    await this.device.transferOut(endpointNumber, data);
  }

  async printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult> {
    try {
      await this.print(buildCustomerTicketText(order, estimatedMinutes));
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Print failed',
      };
    }
  }

  async printKitchenOrder(order: Order): Promise<PrinterResult> {
    try {
      await this.print(buildKitchenTicketText(order));
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Print failed',
      };
    }
  }
}

// ============================================================
// ГЛОБАЛЬНЫЙ АДАПТЕР
// ============================================================
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

export async function printCustomerTicket(
  order: Order,
  estimatedMinutes?: number
): Promise<PrinterResult> {
  return currentAdapter.printCustomerTicket(order, estimatedMinutes);
}

export async function printKitchenOrder(order: Order): Promise<PrinterResult> {
  return currentAdapter.printKitchenOrder(order);
}

export function buildCustomerTicket(
  order: Order,
  estimatedMinutes?: number
): string {
  return buildCustomerTicketText(order, estimatedMinutes);
}

export function buildKitchenTicket(order: Order): string {
  return buildKitchenTicketText(order);
}