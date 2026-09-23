import type { Order, CartItem, OrderItem } from '@/types/database';
import { formatYen, formatTime } from '@/locale/format';

export interface PrinterResult {
  success: boolean;
  error?: string;
}

export interface PrinterAdapter {
  printCustomerTicket(order: Order): Promise<PrinterResult>;
  printKitchenOrder(order: Order): Promise<PrinterResult>;
  isAvailable(): Promise<boolean>;
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ТЕКСТА
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

/**
 * Строка позиции заказа.
 *   С ценами (для клиента):
 *     1× Kebab Wrap Chicken          ¥500
 *   Без цен (для кухни):
 *     1× Kebab Wrap Chicken
 *
 * Опции (если есть) идут отдельной строкой с отступом:
 *        + Cheese ×2, Spicy
 */
function formatItemLine(item: OrderItem, showPrices: boolean): string {
  // Полное название блюда + вариант (Chicken / Mix / Beef)
  let displayName = item.name;
  if (item.variant) displayName += ` ${item.variant}`;

  let line = `${item.quantity}× ${displayName}`;

  if (showPrices) {
    const price =
      item.price === 0 ? 'FREE' : formatYen(item.price * item.quantity);
    line = padBetween(line, price);
  }

  // Опции (если они когда-нибудь появятся)
  if (item.options && item.options.length > 0) {
    const opts = item.options
      .map((o) => (o.quantity > 1 ? `${o.name} ×${o.quantity}` : o.name))
      .join(', ');
    line += `\n   + ${opts}`;
  }

  return line;
}

/**
 * Все позиции заказа.
 */
function buildOrderLines(order: Order, showPrices: boolean): string {
  if (!order.order_items || order.order_items.length === 0) {
    return '(empty)';
  }
  return order.order_items
    .map((item) => formatItemLine(item, showPrices))
    .join('\n');
}

// ============================================================
// ЧЕК КЛИЕНТУ
// ============================================================
function buildCustomerTicketText(order: Order): string {
  const lines: string[] = [];

  lines.push(center('KEBAB POS'));
  lines.push(center(`ORDER #${order.order_number}`));
  lines.push(center(formatTime(order.created_at)));
  lines.push(DIVIDER);
  lines.push('');

  // Тип заказа (OUTSIDE / INSIDE)
  const typeLabel =
    order.order_type === 'INSIDE' ? '>>> INSIDE <<<' : '>>> OUTSIDE <<<';
  lines.push(center(typeLabel));
  lines.push('');

  // Позиции с ценами
  lines.push(buildOrderLines(order, true));
  lines.push('');

  // Итого
  lines.push(DIVIDER);
  lines.push(padBetween('TOTAL', formatYen(order.total_amount)));
  lines.push(DIVIDER);

  // Комментарий
  if (order.comment) {
    lines.push('');
    lines.push(`Note: ${order.comment}`);
  }

  // Подвал
  lines.push('');
  lines.push(center('Thank you!'));
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// КУХОННЫЙ ТИКЕТ (без цен, крупные строки)
// ============================================================
function buildKitchenTicketText(order: Order): string {
  const lines: string[] = [];

  lines.push(DIVIDER_HEAVY);
  lines.push(center('KITCHEN'));
  lines.push(DIVIDER_HEAVY);
  lines.push('');

  // Номер заказа — крупно
  lines.push(center(`ORDER #${order.order_number}`));
  lines.push(center(formatTime(order.created_at)));
  lines.push('');

  // Тип заказа
  lines.push(center(order.order_type));
  lines.push('');
  lines.push(DIVIDER);
  lines.push('');

  // Позиции без цен
  lines.push(buildOrderLines(order, false));
  lines.push('');

  // Комментарий — заметно
  if (order.comment) {
    lines.push(DIVIDER);
    lines.push('');
    lines.push(`!! ${order.comment} !!`);
    lines.push('');
  }

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
    if (item.variant) name += ` ${item.variant}`;
    const left = `${item.quantity}× ${name}`;
    const right =
      item.price === 0
        ? 'FREE'
        : formatYen(item.price * item.quantity);
    lines.push(padBetween(left, right));
    if (item.options && item.options.length > 0) {
      const opts = item.options
        .map((o) => (o.quantity > 1 ? `${o.name} ×${o.quantity}` : o.name))
        .join(', ');
      lines.push(`   + ${opts}`);
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

  async printCustomerTicket(order: Order): Promise<PrinterResult> {
    try {
      console.log('=== CUSTOMER TICKET ===');
      console.log(buildCustomerTicketText(order));
      console.log('=== END TICKET ===');
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
      console.log('=== KITCHEN TICKET ===');
      console.log(buildKitchenTicketText(order));
      console.log('=== END TICKET ===');
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

  async printCustomerTicket(order: Order): Promise<PrinterResult> {
    try {
      await this.print(buildCustomerTicketText(order));
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