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
  emitPrintKitchenDelta,
  emitPrintCustomer,
  emitBuildTicket,
  emitBuildKitchenDelta,
} from '@/lib/socket';
import {
  findUsbDeviceBySlot,
  hasWebUsb,
} from '@/lib/printer-discovery';
import { printBufferViaUsb, base64ToBytes } from '@/lib/usb-printer';

export type { PrinterResult };

export interface PrinterAdapter {
  printCustomerTicket(
    order: Order,
    estimatedMinutes?: number
  ): Promise<PrinterResult>;
  printKitchenOrder(order: Order): Promise<PrinterResult>;
  printKitchenDelta(order: Order): Promise<PrinterResult>;
  isAvailable(): Promise<boolean>;
}

// ============================================================
// Текстовые билдеры (для отладки)
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
// Логирование (включено всегда, чтобы видеть проблемы)
// ============================================================
function log(...args: unknown[]) {
  console.log('%c[print]', 'color:#f97316;font-weight:bold', ...args);
}

function warn(...args: unknown[]) {
  console.warn('%c[print]', 'color:#dc2626;font-weight:bold', ...args);
}

function step(...args: unknown[]) {
  console.log('%c[print] ›', 'color:#0ea5e9;font-weight:bold', ...args);
}

// ============================================================
// Настройки
// ============================================================
async function getSettingsSafe(): Promise<PrinterSettings | null> {
  try {
    step('Запрашиваю настройки принтеров с сервера...');
    const s = await emitGetPrinterSettings();
    step('Настройки получены:', JSON.stringify(s));
    return s;
  } catch (e) {
    warn('Не удалось получить настройки:', e);
    return null;
  }
}

// ============================================================
// USB-печать — полный чек
// ============================================================
async function printViaUsb(
  target: 'kitchen' | 'cashier',
  order: Order,
  etaMinutes: number,
  slot: PrinterSlot
): Promise<PrinterResult> {
  log(`USB-печать [${target}]`);
  step('slot:', JSON.stringify(slot));

  if (slot.usb_vendor_id == null || slot.usb_product_id == null) {
    warn('USB-принтер не настроен (нет VID/PID)');
    return { success: false, error: 'USB-принтер не настроен' };
  }

  if (!hasWebUsb()) {
    warn('WebUSB не поддерживается в этом браузере');
    return {
      success: false,
      error: 'WebUSB не поддерживается. Откройте Chrome или Edge.',
    };
  }

  step('Ищу USB-устройство в браузере...');
  const device = await findUsbDeviceBySlot(slot);
  if (!device) {
    warn('USB-устройство не найдено');
    return {
      success: false,
      error: 'USB-принтер не найден. Разрешите доступ в браузере.',
    };
  }
  step('USB-устройство найдено:', device.productName ?? '(no name)');

  step('Прошу сервер собрать ESC/POS буфер...');
  const buildRes = await emitBuildTicket({ target, order, etaMinutes });
  if (!buildRes.ok || !buildRes.buffer) {
    warn('Сервер не вернул буфер:', buildRes.error);
    return {
      success: false,
      error: buildRes.error || 'Не удалось собрать чек',
    };
  }

  const bytes = base64ToBytes(buildRes.buffer);
  step(`Получен буфер ${bytes.length} байт, пишу в USB...`);

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
// USB-печать — DELTA-ЧЕК
// ============================================================
async function printDeltaViaUsb(
  order: Order,
  slot: PrinterSlot
): Promise<PrinterResult> {
  log('USB-DELTA печать кухни');
  step('slot:', JSON.stringify(slot));

  if (slot.usb_vendor_id == null || slot.usb_product_id == null) {
    warn('USB-DELTA: принтер не настроен');
    return { success: false, error: 'USB-принтер не настроен' };
  }

  if (!hasWebUsb()) {
    warn('USB-DELTA: WebUSB не поддерживается');
    return {
      success: false,
      error: 'WebUSB не поддерживается. Откройте Chrome или Edge.',
    };
  }

  step('USB-DELTA: ищу устройство в браузере...');
  const device = await findUsbDeviceBySlot(slot);
  if (!device) {
    warn('USB-DELTA: устройство не найдено');
    return {
      success: false,
      error: 'USB-принтер не найден. Разрешите доступ в браузере.',
    };
  }
  step('USB-DELTA: устройство найдено');

  step('USB-DELTA: прошу сервер собрать delta-буфер...');
  const buildRes = await emitBuildKitchenDelta(order);
  step('USB-DELTA: ответ сервера:', JSON.stringify(buildRes));

  if (!buildRes.ok) {
    warn('USB-DELTA: сервер вернул ошибку:', buildRes.error);
    return {
      success: false,
      error: buildRes.error || 'Не удалось собрать delta-чек',
    };
  }

  if (!buildRes.buffer) {
    log(
      'USB-DELTA: сервер вернул пусто (нет изменений is_removed / is_added_later)'
    );
    return { success: true, skipped: true, note: 'no-changes' };
  }

  const bytes = base64ToBytes(buildRes.buffer);
  step(`USB-DELTA: получен буфер ${bytes.length} байт, пишу в USB...`);

  try {
    await printBufferViaUsb(device, bytes);
    log('USB-DELTA ✓ OK');
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка USB-печати';
    warn('USB-DELTA ✗', msg);
    return { success: false, error: msg };
  }
}

// ============================================================
// Роутинг — полный чек
// ============================================================
async function routePrint(
  target: 'kitchen' | 'cashier',
  order: Order,
  etaMinutes: number
): Promise<PrinterResult> {
  log(`──────── routePrint ${target} ────────`);
  step(`Заказ #${order.order_number}, позиций: ${order.order_items?.length ?? 0}`);

  const settings = await getSettingsSafe();
  if (!settings) {
    warn('routePrint: не удалось получить настройки');
    return { success: false, error: 'Не удалось получить настройки' };
  }

  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  step(`${target} slot:`, JSON.stringify(slot));

  if (!slot.enabled) {
    warn(`routePrint: [${target}] выключен в настройках → skipped`);
    return { success: true, skipped: true };
  }

  if (slot.source === 'usb') {
    return printViaUsb(target, order, etaMinutes, slot);
  }

  if (target === 'kitchen') {
    step('routePrint: отправляю на сервер printer-print-kitchen');
    const r = await emitPrintKitchen(order);
    step('routePrint: ответ сервера:', JSON.stringify(r));
    return r;
  }
  step('routePrint: отправляю на сервер printer-print-customer');
  const r = await emitPrintCustomer(order, etaMinutes);
  step('routePrint: ответ сервера:', JSON.stringify(r));
  return r;
}

// ============================================================
// Роутинг — DELTA-ЧЕК
// ============================================================
async function routeDelta(order: Order): Promise<PrinterResult> {
  log('──────── routeDelta kitchen ────────');
  step(`Заказ #${order.order_number}`);
  step(
    'Позиции заказа:',
    JSON.stringify(
      (order.order_items ?? []).map((i) => ({
        name: i.name,
        qty: i.quantity,
        is_removed: i.is_removed,
        is_added_later: i.is_added_later,
      }))
    )
  );

  const settings = await getSettingsSafe();
  if (!settings) {
    warn('routeDelta: не удалось получить настройки');
    return { success: false, error: 'Не удалось получить настройки' };
  }

  const slot = settings.kitchen;
  step('kitchen slot:', JSON.stringify(slot));

  if (!slot.enabled) {
    warn('routeDelta: кухня выключена в настройках → skipped');
    return { success: true, skipped: true };
  }

  if (slot.source === 'usb') {
    step('routeDelta: source=usb → печатаю через WebUSB');
    return printDeltaViaUsb(order, slot);
  }

  step('routeDelta: source=' + slot.source + ' → отправляю на сервер');
  const r = await emitPrintKitchenDelta(order);
  step('routeDelta: ответ сервера:', JSON.stringify(r));
  return r;
}

// ============================================================
// Адаптеры
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

  async printKitchenDelta(order: Order): Promise<PrinterResult> {
    try {
      return await routeDelta(order);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Print failed';
      warn('printKitchenDelta exception:', msg);
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
  async printKitchenDelta(order: Order): Promise<PrinterResult> {
    console.log('┌──── KITCHEN DELTA ────┐');
    console.log(buildKitchenTicketText(order));
    console.log('└───────────────────────┘');
    return { success: true };
  }
}

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
// Публичный API
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

export async function printKitchenDelta(order: Order): Promise<PrinterResult> {
  return currentAdapter.printKitchenDelta(order);
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