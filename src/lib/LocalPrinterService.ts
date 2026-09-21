// src/lib/LocalPrinterService.ts
import type { Order, Language } from '@/lib/types';
import {
  loadTicketLayout,
  type TicketLayout,
  type TicketBlock,
} from '@/lib/ticketLayout';
import { supabase } from '@/lib/supabase';

// ─── Типы ───────────────────────────────────────────────────────────────────
export type PrinterRole = 'kitchen' | 'receipt';

export interface PrinterStatus {
  connected: boolean;
  kitchen: string | null;
  receipt: string | null;
}

export interface PrinterList {
  kitchen: string | null;
  receipt: string | null;
  all: string[];
}

export interface PrinterInfo {
  name: string;
  kind: 'thermal' | 'a4';
  columns: number;
  paper_size: string;
}

export interface PrinterService {
  printKitchenTicket(order: Order, lang: Language): Promise<void>;
  printReceipt(order: Order, lang: Language): Promise<void>;
}

const SERVER_URL = 'http://127.0.0.1:9999';

// ═══════════════════════════════════════════════════════════════════════════
// СТАТУС И СПИСОК
// ═══════════════════════════════════════════════════════════════════════════
export async function getPrinterStatus(): Promise<PrinterStatus> {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      kitchen: string | null;
      receipt: string | null;
    };
    return {
      connected: Boolean(data.kitchen && data.receipt),
      kitchen: data.kitchen,
      receipt: data.receipt,
    };
  } catch {
    return { connected: false, kitchen: null, receipt: null };
  }
}

export async function getAvailablePrinters(): Promise<PrinterList> {
  const res = await fetch(`${SERVER_URL}/printers`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as PrinterList;
  return {
    kitchen: data.kitchen ?? null,
    receipt: data.receipt ?? null,
    all: data.all ?? [],
  };
}

export async function getPrinterInfo(name: string): Promise<PrinterInfo | null> {
  try {
    const res = await fetch(
      `${SERVER_URL}/printer-info?name=${encodeURIComponent(name)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success: boolean;
      kind?: 'thermal' | 'a4';
      columns?: number;
      paper_size?: string;
    };
    if (!data.success || !data.kind) return null;
    return {
      name,
      kind: data.kind,
      columns: data.columns ?? 42,
      paper_size: data.paper_size ?? '',
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// УСТАНОВКА ПРИНТЕРА + СОХРАНЕНИЕ ИНФО В SUPABASE
// ═══════════════════════════════════════════════════════════════════════════
export async function setActivePrinter(
  role: PrinterRole,
  name: string
): Promise<{ ok: boolean; info?: PrinterInfo }> {
  try {
    const res = await fetch(`${SERVER_URL}/set-printer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, name }),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as {
      success: boolean;
      kind?: 'thermal' | 'a4';
      columns?: number;
      paper_size?: string;
    };
    if (!data.success) return { ok: false };

    const info: PrinterInfo = {
      name,
      kind: data.kind ?? 'thermal',
      columns: data.columns ?? 42,
      paper_size: data.paper_size ?? '',
    };

    // Сохраняем в restaurant_settings: имя + тип + колонки
    await supabase
      .from('restaurant_settings')
      .upsert(
        [
          { key: `printer_${role}`, value: name, updated_at: new Date().toISOString() },
          { key: `printer_${role}_kind`, value: info.kind, updated_at: new Date().toISOString() },
          { key: `printer_${role}_columns`, value: String(info.columns), updated_at: new Date().toISOString() },
        ],
        { onConflict: 'key' }
      );

    return { ok: true, info };
  } catch (e) {
    console.error(`[PRINTER] setActivePrinter(${role}) failed:`, e);
    return { ok: false };
  }
}

export async function syncPrintersFromDb(): Promise<void> {
  try {
    const { data } = await supabase
      .from('restaurant_settings')
      .select('key, value')
      .in('key', ['printer_kitchen', 'printer_receipt']);

    if (!data) return;

    const map: Record<string, string> = {};
    (data as { key: string; value: string | null }[]).forEach((row) => {
      if (row.value) map[row.key] = row.value;
    });

    let available: string[] = [];
    try {
      const list = await getAvailablePrinters();
      available = list.all;
    } catch {
      /* сервер может быть не запущен */
    }

    for (const role of ['kitchen', 'receipt'] as PrinterRole[]) {
      const name = map[`printer_${role}`];
      if (!name) continue;
      if (available.length === 0 || available.includes(name)) {
        await fetch(`${SERVER_URL}/set-printer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, name }),
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[PRINTER] syncPrintersFromDb failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ОТПРАВКА В PYTHON (hex + text)
// ═══════════════════════════════════════════════════════════════════════════
async function sendToPrinter(
  role: PrinterRole,
  hex: string,
  text: string
): Promise<void> {
  const res = await fetch(`${SERVER_URL}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, hex, text }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// КОДИРОВКА CP866 (для ESC/POS на термо)
// ═══════════════════════════════════════════════════════════════════════════
const CP866_MAP: Record<string, number> = {
  'А': 0x80, 'Б': 0x81, 'В': 0x82, 'Г': 0x83, 'Д': 0x84, 'Е': 0x85, 'Ж': 0x86, 'З': 0x87,
  'И': 0x88, 'Й': 0x89, 'К': 0x8a, 'Л': 0x8b, 'М': 0x8c, 'Н': 0x8d, 'О': 0x8e, 'П': 0x8f,
  'Р': 0x90, 'С': 0x91, 'Т': 0x92, 'У': 0x93, 'Ф': 0x94, 'Х': 0x95, 'Ц': 0x96, 'Ч': 0x97,
  'Ш': 0x98, 'Щ': 0x99, 'Ъ': 0x9a, 'Ы': 0x9b, 'Ь': 0x9c, 'Э': 0x9d, 'Ю': 0x9e, 'Я': 0x9f,
  'а': 0xa0, 'б': 0xa1, 'в': 0xa2, 'г': 0xa3, 'д': 0xa4, 'е': 0xa5, 'ж': 0xa6, 'з': 0xa7,
  'и': 0xa8, 'й': 0xa9, 'к': 0xaa, 'л': 0xab, 'м': 0xac, 'н': 0xad, 'о': 0xae, 'п': 0xaf,
  'р': 0xe0, 'с': 0xe1, 'т': 0xe2, 'у': 0xe3, 'ф': 0xe4, 'х': 0xe5, 'ц': 0xe6, 'ч': 0xe7,
  'ш': 0xe8, 'щ': 0xe9, 'ъ': 0xea, 'ы': 0xeb, 'ь': 0xec, 'э': 0xed, 'ю': 0xee, 'я': 0xef,
  'Ё': 0xf0, 'ё': 0xf1, '№': 0xfc,
};

function encodeCP866(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    if (CP866_MAP[ch] !== undefined) bytes.push(CP866_MAP[ch]);
    else {
      const code = ch.charCodeAt(0);
      bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
    }
  }
  return bytes;
}

function textToBytes(text: string): number[] {
  return [...encodeCP866(text), 0x0a];
}

const CMD = {
  INIT:         [0x1b, 0x40],
  ALIGN_LEFT:   [0x1b, 0x61, 0x00],
  ALIGN_CENTER: [0x1b, 0x61, 0x01],
  ALIGN_RIGHT:  [0x1b, 0x61, 0x02],
  BOLD_ON:      [0x1b, 0x45, 0x01],
  BOLD_OFF:     [0x1b, 0x45, 0x00],
  SIZE_2X:      [0x1d, 0x21, 0x11],
  SIZE_1X:      [0x1d, 0x21, 0x00],
  CP866:        [0x1b, 0x74, 0x11],
  CUT:          [0x1d, 0x56, 0x42, 0x00],
};

function alignCmd(a: TicketBlock['align']): number[] {
  if (a === 'center') return CMD.ALIGN_CENTER;
  if (a === 'right') return CMD.ALIGN_RIGHT;
  return CMD.ALIGN_LEFT;
}

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ ВЫРАВНИВАНИЯ
// ═══════════════════════════════════════════════════════════════════════════
function alignText(
  text: string,
  align: TicketBlock['align'],
  width: number
): string {
  const t = text.slice(0, width);
  if (align === 'center') {
    const pad = Math.max(0, Math.floor((width - t.length) / 2));
    return ' '.repeat(pad) + t;
  }
  if (align === 'right') {
    return ' '.repeat(Math.max(0, width - t.length)) + t;
  }
  return t;
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНТЕКСТ ДЛЯ РЕНДЕРА
// ═══════════════════════════════════════════════════════════════════════════
interface RenderContext {
  orderLabel: string;
  orderNumber: number;
  tableLabel: string;
  tableValue: string;
  timeLabel: string;
  timeValue: string;
  items: { quantity: number; name: string; price?: number }[];
  notesLabel: string;
  notes: string[];
  totalLabel: string;
  totalValue: number;
  thanks: string;
  width: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ESC/POS (для термопринтера)
// ═══════════════════════════════════════════════════════════════════════════
function renderLayoutHex(layout: TicketLayout, ctx: RenderContext): string {
  const bytes: number[] = [];
  bytes.push(...CMD.INIT, ...CMD.CP866);

  for (const block of layout.blocks) {
    if (!block.enabled) continue;

    const align = alignCmd(block.align);
    const boldOn = block.bold ? CMD.BOLD_ON : [];
    const boldOff = block.bold ? CMD.BOLD_OFF : [];
    const sizeOn = block.size === 2 ? CMD.SIZE_2X : [];
    const sizeOff = block.size === 2 ? CMD.SIZE_1X : [];

    const emitLine = (text: string) => {
      bytes.push(...align, ...boldOn, ...sizeOn);
      bytes.push(...textToBytes(text));
      bytes.push(...sizeOff, ...boldOff);
    };
    const emitSeparator = () => {
      bytes.push(...align);
      bytes.push(...textToBytes('-'.repeat(ctx.width)));
    };

    switch (block.id) {
      case 'header':
        emitLine(`${ctx.orderLabel} #${ctx.orderNumber}`);
        break;
      case 'table':
        emitLine(`${ctx.tableLabel}: ${ctx.tableValue}`);
        break;
      case 'time':
        emitLine(`${ctx.timeLabel}: ${ctx.timeValue}`);
        break;
      case 'separator1':
      case 'separator2':
      case 'separator3':
        emitSeparator();
        break;
      case 'items':
        for (const it of ctx.items) {
          emitLine(`${it.quantity} x ${it.name}`);
          if (it.price !== undefined) {
            bytes.push(
              ...CMD.ALIGN_RIGHT,
              ...textToBytes(`¥${it.price.toLocaleString()}`)
            );
          }
        }
        break;
      case 'notes':
        if (ctx.notes.length > 0) {
          emitLine(`${ctx.notesLabel}:`);
          for (const n of ctx.notes) emitLine(n.toUpperCase());
        }
        break;
      case 'total':
        emitLine(`${ctx.totalLabel}: ¥${ctx.totalValue.toLocaleString()}`);
        break;
      case 'thanks':
        emitLine(ctx.thanks);
        break;
    }
  }

  bytes.push(0x0a, 0x0a, 0x0a);
  bytes.push(...CMD.CUT);
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ПРОСТОГО ТЕКСТА (для A4)
// ═══════════════════════════════════════════════════════════════════════════
function renderLayoutText(layout: TicketLayout, ctx: RenderContext): string {
  const lines: string[] = [];

  for (const block of layout.blocks) {
    if (!block.enabled) continue;

    const emit = (text: string) => {
      lines.push(alignText(text, block.align, ctx.width));
    };
    const emitSep = () => {
      lines.push('-'.repeat(ctx.width));
    };

    switch (block.id) {
      case 'header':
        emit(`${ctx.orderLabel} #${ctx.orderNumber}`);
        break;
      case 'table':
        emit(`${ctx.tableLabel}: ${ctx.tableValue}`);
        break;
      case 'time':
        emit(`${ctx.timeLabel}: ${ctx.timeValue}`);
        break;
      case 'separator1':
      case 'separator2':
      case 'separator3':
        emitSep();
        break;
      case 'items':
        for (const it of ctx.items) {
          emit(`${it.quantity} x ${it.name}`);
          if (it.price !== undefined) {
            const priceStr = `¥${it.price.toLocaleString()}`;
            lines.push(alignText(priceStr, 'right', ctx.width));
          }
        }
        break;
      case 'notes':
        if (ctx.notes.length > 0) {
          emit(`${ctx.notesLabel}:`);
          for (const n of ctx.notes) emit(n.toUpperCase());
        }
        break;
      case 'total':
        emit(`${ctx.totalLabel}: ¥${ctx.totalValue.toLocaleString()}`);
        break;
      case 'thanks':
        emit(ctx.thanks);
        break;
    }
  }

  lines.push('', '', '');
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// КЭШ РАСКЛАДОК
// ═══════════════════════════════════════════════════════════════════════════
let kitchenLayoutCache: TicketLayout | null = null;
let receiptLayoutCache: TicketLayout | null = null;

export function invalidateLayoutCache() {
  kitchenLayoutCache = null;
  receiptLayoutCache = null;
}

async function getKitchenLayout(): Promise<TicketLayout> {
  if (!kitchenLayoutCache) kitchenLayoutCache = await loadTicketLayout('kitchen');
  return kitchenLayoutCache;
}
async function getReceiptLayout(): Promise<TicketLayout> {
  if (!receiptLayoutCache) receiptLayoutCache = await loadTicketLayout('receipt');
  return receiptLayoutCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЙ СЕРВИС
// ═══════════════════════════════════════════════════════════════════════════
export const LocalPrinterService: PrinterService = {
  async printKitchenTicket(order: Order, lang: Language) {
    const status = await getPrinterStatus();
    if (!status.kitchen) {
      console.warn('[PRINTER] Кухонный принтер не выбран');
      return;
    }
    const layout = await getKitchenLayout();

    const orderLabel    = lang === 'ru' ? 'ЗАКАЗ' : 'ORDER';
    const tableLabel    = lang === 'ru' ? 'СТОЛ' : 'TABLE';
    const takeawayLabel = lang === 'ru' ? 'С СОБОЙ' : 'TAKEAWAY';
    const timeLabel     = lang === 'ru' ? 'ВРЕМЯ' : 'TIME';
    const noteLabel     = lang === 'ru' ? 'КОММЕНТАРИЙ' : 'NOTE';

    const time = new Date(order.created_at).toLocaleTimeString(
      lang === 'ru' ? 'ru-RU' : 'en-US',
      { hour: '2-digit', minute: '2-digit' }
    );

    const tableValue =
      order.order_type === 'dine_in' && order.table
        ? order.table.name
        : takeawayLabel;

    const notes = (order.order_items ?? [])
      .map((i) => i.note)
      .filter(Boolean) as string[];
    if (order.customer_note) notes.push(order.customer_note);

    const ctx: RenderContext = {
      orderLabel,
      orderNumber: order.order_number,
      tableLabel,
      tableValue,
      timeLabel,
      timeValue: time,
      items: (order.order_items ?? []).map((it) => ({
        quantity: it.quantity,
        name: lang === 'ru' ? it.product_name_ru : it.product_name_ja,
      })),
      notesLabel: noteLabel,
      notes,
      totalLabel: '',
      totalValue: 0,
      thanks: '',
      width: layout.paperWidth,
    };

    const hex = renderLayoutHex(layout, ctx);
    const text = renderLayoutText(layout, ctx);
    await sendToPrinter('kitchen', hex, text);
  },

  async printReceipt(order: Order, lang: Language) {
    const status = await getPrinterStatus();
    if (!status.receipt) {
      console.warn('[PRINTER] Принтер для чеков не выбран');
      return;
    }
    const layout = await getReceiptLayout();

    const orderLabel = lang === 'ru' ? 'ЗАКАЗ' : 'ORDER';
    const totalLabel = lang === 'ru' ? 'ИТОГО' : 'TOTAL';
    const thanks     = lang === 'ru' ? 'СПАСИБО!' : 'THANK YOU!';
    const time = new Date(order.created_at).toLocaleString(
      lang === 'ru' ? 'ru-RU' : 'en-US'
    );

    const ctx: RenderContext = {
      orderLabel,
      orderNumber: order.order_number,
      tableLabel: '',
      tableValue: '',
      timeLabel: '',
      timeValue: time,
      items: (order.order_items ?? []).map((it) => ({
        quantity: it.quantity,
        name: lang === 'ru' ? it.product_name_ru : it.product_name_ja,
        price: it.total_price,
      })),
      notesLabel: '',
      notes: [],
      totalLabel,
      totalValue: order.total,
      thanks,
      width: layout.paperWidth,
    };

    const hex = renderLayoutHex(layout, ctx);
    const text = renderLayoutText(layout, ctx);
    await sendToPrinter('receipt', hex, text);
  },
};