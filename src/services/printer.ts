import type { Order, CartItem, OrderItem } from '@/types/database';
import type {
  PrinterResult,
  PrinterSettings,
  PrinterSlot,
} from '@/types/database';
import { formatYen, formatTime } from '@/locale/format';
import {
  emitGetPrinterSettings,
  emitPrintKitchen,
  emitPrintCustomer,
  emitBuildTicket,
} from '@/lib/socket';
import { findUsbDeviceBySlot } from '@/lib/printer-discovery';
import { printBufferViaUsb, base64ToBytes } from '@/lib/usb-printer';

export type { PrinterResult };

export interface PrinterAdapter {
  printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult>;
  printKitchenOrder(order: Order): Promise<PrinterResult>;
  isAvailable(): Promise<boolean>;
}

// ============================================================
// ТЕКСТОВЫЕ БИЛДЕРЫ
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

function formatKitchenItem(item: OrderItem): string[] {
  const out: string[] = [];
  let name = item.name;
  if (item.variant) name += ` [${item.variant}]`;
  out.push(`${item.quantity}x ${name}`);
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

  const activeItems = (order.order_items ?? []).filter((i) => !i.is_removed);
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
    lines.push('', `!!! NOTE: ${order.comment}`, '', DIVIDER);
  }
  lines.push('', DIVIDER_HEAVY, '');
  return lines.join('\n');
}

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
    lines.push('', center(`~${estimatedMinutes} min`, WIDTH), '');
  }
  lines.push('', DIVIDER_HEAVY, '');
  return lines.join('\n');
}

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

  lines.push('', DIVIDER, padBetween('TOTAL', formatYen(total)), DIVIDER, '');
  return lines.join('\n');
}

// ============================================================
// Логирование (можно отключить, поставив PRINT_DEBUG=false)
// ============================================================
const DEBUG =
  typeof window !== 'undefined' &&
  window.localStorage.getItem('print-debug') !== 'off';

function log(...args: unknown[]) {
  if (DEBUG) console.log('%c[print]', 'color:#f97316;font-weight:bold', ...args);
}

function warn(...args: unknown[]) {
  if (DEBUG) console.warn('%c[print]', 'color:#f97316;font-weight:bold', ...args);
}

// ============================================================
// Настройки
// ============================================================
async function getSettingsSafe(): Promise<PrinterSettings | null> {
  try {
    log('Запрашиваю настройки с сервера...');
    const s = await emitGetPrinterSettings();
    log('Получены настройки:', s);
    return s;
  } catch (e) {
    warn('Не удалось получить настройки:', e);
    return null;
  }
}

// ============================================================
// USB-печать
// ============================================================
async function printViaUsb(
  target: 'kitchen' | 'cashier',
  order: Order,
  etaMinutes: number,
  slot: PrinterSlot
): Promise<PrinterResult> {
  log(`USB-печать [${target}]`, slot);

  if (slot.usb_vendor_id == null || slot.usb_product_id == null) {
    return { success: false, error: 'USB-принтер не настроен' };
  }

  const device = await findUsbDeviceBySlot(slot);
  if (!device) {
    warn('USB-устройство не найдено в браузере');
    return {
      success: false,
      error:
        'USB-принтер не найден на этом устройстве. ' +
        'Подключите его к этому компьютеру или разрешите доступ в браузере.',
    };
  }

  const buildRes = await emitBuildTicket({ target, order, etaMinutes });
  if (!buildRes.ok || !buildRes.buffer) {
    return {
      success: false,
      error: buildRes.error || 'Не удалось собрать чек',
    };
  }

  const bytes = base64ToBytes(buildRes.buffer);
  log(`USB: получен буфер ${bytes.length} байт, пишу в устройство...`);

  try {
    await printBufferViaUsb(device, bytes);
    log(`USB [${target}] ✓ OK`);
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка USB-печати';
    warn(`USB [${target}] ✗`, msg);
    return { success: false, error: msg };
  }
}

// ============================================================
// Роутинг печати
// ============================================================
async function routePrint(
  target: 'kitchen' | 'cashier',
  order: Order,
  etaMinutes: number
): Promise<PrinterResult> {
  log(`──────── routePrint ${target} ────────`);
  log(`Заказ #${order.order_number}, items=${order.order_items?.length ?? 0}`);

  const settings = await getSettingsSafe();
  if (!settings) {
    return { success: false, error: 'Не удалось получить настройки' };
  }

  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  log(`Слот [${target}]:`, slot);

  if (!slot.enabled) {
    warn(`Принтер [${target}] выключен в настройках — пропускаю`);
    return { success: true, skipped: true };
  }

  if (slot.source === 'usb') {
    return printViaUsb(target, order, etaMinutes, slot);
  }

  log(`Отправляю заказ на сервер для печати по TCP...`);
  if (target === 'kitchen') {
    const res = await emitPrintKitchen(order);
    log(`Ответ сервера [kitchen]:`, res);
    return res;
  }
  const res = await emitPrintCustomer(order, etaMinutes);
  log(`Ответ сервера [cashier]:`, res);
  return res;
}

// ============================================================
// АДАПТЕРЫ
// ============================================================
class ServerPrinterAdapter implements PrinterAdapter {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult> {
    try {
      return await routePrint('cashier', order, estimatedMinutes ?? 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Print failed';
      warn('printCustomerTicket exception:', msg);
      return { success: false, error: msg };
    }
  }

  async printKitchenOrder(order: Order): Promise<PrinterResult> {
    try {
      return await routePrint('kitchen', order, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Print failed';
      warn('printKitchenOrder exception:', msg);
      return { success: false, error: msg };
    }
  }
}

class ConsolePrinterAdapter implements PrinterAdapter {
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult> {
    console.log('┌──── CUSTOMER ────┐');
    console.log(buildCustomerTicketText(order, estimatedMinutes));
    console.log('└──────────────────┘');
    return { success: true };
  }
  async printKitchenOrder(order: Order): Promise<PrinterResult> {
    console.log('┌──── KITCHEN ────┐');
    console.log(buildKitchenTicketText(order));
    console.log('└─────────────────┘');
    return { success: true };
  }
}

// ============================================================
// ГЛОБАЛЬНЫЙ АДАПТЕР
// ============================================================
let currentAdapter: PrinterAdapter = new ServerPrinterAdapter();

export function getPrinter(): PrinterAdapter {
  return currentAdapter;
}

export function setPrinter(adapter: PrinterAdapter): void {
  currentAdapter = adapter;
}

export function setServerPrinter(): void {
  currentAdapter = new ServerPrinterAdapter();
}

export function setConsolePrinter(): void {
  currentAdapter = new ConsolePrinterAdapter();
}

// ============================================================
// ПУБЛИЧНЫЙ API
// ============================================================
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