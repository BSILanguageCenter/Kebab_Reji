// src/lib/ticketLayout.ts
import { supabase } from '@/lib/supabase';

// ─── Типы ───────────────────────────────────────────────────────────────────
export type BlockAlign = 'left' | 'center' | 'right';
export type BlockSize = 1 | 2;
export type PaperWidth = 32 | 42 | 56 | 80;
export type PaperKind = 'thermal' | 'a4';

export interface TicketBlock {
  id: string;
  enabled: boolean;
  align: BlockAlign;
  bold: boolean;
  size: BlockSize;
}

export interface TicketLayout {
  version: 1;
  paperWidth: PaperWidth;
  paperKind: PaperKind;
  blocks: TicketBlock[];
}

export type LayoutKind = 'kitchen' | 'receipt';

// ─── Метаданные блоков ──────────────────────────────────────────────────────
export const BLOCK_META: Record<
  string,
  { label: string; desc: string; icon: string }
> = {
  header:     { label: 'Заголовок',    desc: 'Номер заказа',                 icon: '📢' },
  table:      { label: 'Стол / тип',   desc: 'Номер стола или «С собой»',    icon: '🍽️' },
  time:       { label: 'Время',        desc: 'Дата и время создания',        icon: '🕐' },
  separator1: { label: 'Линия 1',      desc: 'Разделитель',                  icon: '➖' },
  items:      { label: 'Позиции',      desc: 'Список блюд с количеством',    icon: '📋' },
  separator2: { label: 'Линия 2',      desc: 'Разделитель',                  icon: '➖' },
  separator3: { label: 'Линия 3',      desc: 'Разделитель',                  icon: '➖' },
  notes:      { label: 'Комментарии',  desc: 'Примечания к блюдам и заказу', icon: '💬' },
  total:      { label: 'Итого',        desc: 'Общая сумма',                  icon: '💰' },
  thanks:     { label: 'Благодарность', desc: 'Завершающая строка',          icon: '🙏' },
};

// ─── Дефолтные раскладки ────────────────────────────────────────────────────
export const DEFAULT_KITCHEN_LAYOUT: TicketLayout = {
  version: 1,
  paperWidth: 32,
  paperKind: 'thermal',
  blocks: [
    { id: 'header',     enabled: true, align: 'center', bold: true,  size: 2 },
    { id: 'table',      enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'time',       enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'separator1', enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'items',      enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'separator2', enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'notes',      enabled: true, align: 'left',   bold: true,  size: 1 },
  ],
};

export const DEFAULT_RECEIPT_LAYOUT: TicketLayout = {
  version: 1,
  paperWidth: 32,
  paperKind: 'thermal',
  blocks: [
    { id: 'header',     enabled: true, align: 'center', bold: true,  size: 1 },
    { id: 'time',       enabled: true, align: 'center', bold: false, size: 1 },
    { id: 'separator1', enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'items',      enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'separator2', enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'total',      enabled: true, align: 'left',   bold: true,  size: 1 },
    { id: 'separator3', enabled: true, align: 'left',   bold: false, size: 1 },
    { id: 'thanks',     enabled: true, align: 'center', bold: false, size: 1 },
  ],
};

export function defaultLayoutFor(kind: LayoutKind): TicketLayout {
  return kind === 'kitchen'
    ? JSON.parse(JSON.stringify(DEFAULT_KITCHEN_LAYOUT))
    : JSON.parse(JSON.stringify(DEFAULT_RECEIPT_LAYOUT));
}

// ─── Утилиты бумаги ─────────────────────────────────────────────────────────
export function paperKindFromWidth(w: PaperWidth): PaperKind {
  return w >= 56 ? 'a4' : 'thermal';
}

export function paperLabel(w: PaperWidth): string {
  if (w === 32) return '58 мм';
  if (w === 42) return '80 мм';
  if (w === 56) return 'A5';
  return 'A4';
}

// ═══════════════════════════════════════════════════════════════════════════
// ХРАНЕНИЕ в Supabase (restaurant_settings)
// ═══════════════════════════════════════════════════════════════════════════
const DB_KEY: Record<LayoutKind, string> = {
  kitchen: 'kitchen_ticket_layout',
  receipt: 'receipt_ticket_layout',
};

export async function loadTicketLayout(kind: LayoutKind): Promise<TicketLayout> {
  try {
    const { data } = await supabase
      .from('restaurant_settings')
      .select('value')
      .eq('key', DB_KEY[kind])
      .maybeSingle();

    if (data?.value) {
      const parsed = JSON.parse(data.value) as TicketLayout;
      if (parsed.version === 1 && Array.isArray(parsed.blocks)) {
        // Совместимость со старой версией (без paperKind)
        if (!parsed.paperKind) {
          parsed.paperKind = paperKindFromWidth(parsed.paperWidth);
        }
        return parsed;
      }
    }
  } catch (e) {
    console.warn(`[ticketLayout] не удалось загрузить ${kind}:`, e);
  }
  return defaultLayoutFor(kind);
}

export async function saveTicketLayout(
  kind: LayoutKind,
  layout: TicketLayout
): Promise<void> {
  await supabase
    .from('restaurant_settings')
    .upsert(
      {
        key: DB_KEY[kind],
        value: JSON.stringify(layout),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
}