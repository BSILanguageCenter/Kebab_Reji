import type { Order } from '@/lib/types';
import type { Language } from '@/lib/types';

export interface PrinterService {
  printKitchenTicket(order: Order, lang: Language): Promise<void>;
  printReceipt(order: Order, lang: Language): Promise<void>;
}

export function formatKitchenTicket(order: Order, lang: Language): string {
  const W = 30;
  const line = '='.repeat(W);
  const sep = '-'.repeat(W);
  const orderLabel = lang === 'ru' ? 'ЗАКАЗ' : '注文';
  const tableLabel = lang === 'ru' ? 'СТОЛ' : 'テーブル';
  const takeawayLabel = lang === 'ru' ? 'С СОБОЙ' : 'テイクアウト';
  const timeLabel = lang === 'ru' ? 'ВРЕМЯ' : '時間';
  const noteLabel = lang === 'ru' ? 'КОММЕНТАРИЙ' : '備考';

  const time = new Date(order.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines: string[] = [line, centerText(`${orderLabel} #${order.order_number}`, W), line];

  if (order.order_type === 'dine_in' && order.table) {
    lines.push(`${tableLabel}: ${order.table.name}`);
  } else {
    lines.push(takeawayLabel);
  }
  lines.push(`${timeLabel}: ${time}`);
  lines.push('');

  lines.push(sep);
  for (const item of order.order_items ?? []) {
    const name = lang === 'ru' ? item.product_name_ru : item.product_name_ja;
    lines.push(`${item.quantity} x ${name}`);
  }
  lines.push(sep);

  const notes = (order.order_items ?? [])
    .map((i) => i.note)
    .filter(Boolean)
    .concat(order.customer_note ? [order.customer_note] : []);

  if (notes.length > 0) {
    lines.push('');
    lines.push(`${noteLabel}:`);
    for (const n of notes) {
      lines.push(n!.toUpperCase());
    }
  }

  lines.push(line);
  return lines.join('\n');
}

export function formatReceipt(order: Order, lang: Language): string {
  const W = 30;
  const line = '='.repeat(W);
  const sep = '-'.repeat(W);
  const orderLabel = lang === 'ru' ? 'ЗАКАЗ' : '注文';
  const totalLabel = lang === 'ru' ? 'ИТОГО' : '合計';
  const thankYou = lang === 'ru' ? 'СПАСИБО!' : 'ありがとうございました！';

  const time = new Date(order.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'ja-JP');

  const lines: string[] = [line, centerText(`${orderLabel} #${order.order_number}`, W), line, time, ''];

  lines.push(sep);
  for (const item of order.order_items ?? []) {
    const name = lang === 'ru' ? item.product_name_ru : item.product_name_ja;
    lines.push(`${item.quantity} x ${name}`);
    lines.push(rightAlign(`¥${item.total_price.toLocaleString()}`, W));
  }
  lines.push(sep);
  lines.push(`${totalLabel}: ¥${order.total.toLocaleString()}`);
  lines.push(line);
  lines.push(centerText(thankYou, W));
  lines.push(line);

  return lines.join('\n');
}

function centerText(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function rightAlign(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return ' '.repeat(pad) + text;
}
