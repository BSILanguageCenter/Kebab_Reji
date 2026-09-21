// src/lib/printA4.ts
import type { Order, Language } from '@/lib/types';
import type { TicketLayout, TicketBlock } from '@/lib/ticketLayout';

// ─── Хелперы выравнивания ───────────────────────────────────────────────────
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
  return t.padEnd(width, ' ');
}

// ─── Рендер layout → моноширинный текст ─────────────────────────────────────
interface RenderCtx {
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

function renderLayout(layout: TicketLayout, ctx: RenderCtx): string {
  const lines: string[] = [];

  for (const block of layout.blocks) {
    if (!block.enabled) continue;

    const emit = (text: string) => {
      lines.push(alignText(text, block.align, ctx.width));
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
        emit('-'.repeat(ctx.width));
        break;
      case 'items':
        for (const it of ctx.items) {
          emit(`${it.quantity} x ${it.name}`);
          if (it.price !== undefined) {
            lines.push(
              alignText(`¥${it.price.toLocaleString()}`, 'right', ctx.width)
            );
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

  return lines.join('\n');
}

// ─── HTML-обёртка с @media print ────────────────────────────────────────────
function buildHtml(params: {
  title: string;
  subtitle: string;
  body: string;
  layout: TicketLayout;
}): string {
  const { title, subtitle, body, layout } = params;
  const isA4 = layout.paperKind === 'a4';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #f3f4f6;
    font-family: ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace;
    color: #111;
  }
  .page-wrap {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 24px;
  }
  .paper {
    background: #fff;
    box-shadow: 0 4px 24px rgba(0,0,0,0.12);
    padding: 32px 40px;
    max-width: ${isA4 ? '210mm' : '120mm'};
    width: 100%;
  }
  .paper h1 {
    font-size: 18px;
    margin: 0 0 4px;
    text-align: center;
  }
  .paper .subtitle {
    font-size: 12px;
    color: #666;
    text-align: center;
    margin-bottom: 20px;
  }
  .paper pre {
    margin: 0;
    white-space: pre;
    font-size: ${isA4 ? '12px' : '11px'};
    line-height: 1.45;
    overflow: hidden;
    font-family: inherit;
  }
  @media print {
    body { background: #fff; }
    .page-wrap { padding: 0; min-height: auto; }
    .paper {
      box-shadow: none;
      padding: ${isA4 ? '15mm' : '5mm'};
      max-width: none;
    }
    .paper h1, .paper .subtitle { display: none; }
    .paper pre { font-size: ${isA4 ? '11pt' : '9pt'}; }
    @page {
      size: ${isA4 ? 'A4' : 'auto'};
      margin: ${isA4 ? '15mm' : '5mm'};
    }
  }
</style>
</head>
<body>
  <div class="page-wrap">
    <div class="paper">
      <h1>${escapeHtml(title)}</h1>
      <div class="subtitle">${escapeHtml(subtitle)}</div>
      <pre>${escapeHtml(body)}</pre>
    </div>
  </div>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.focus();
        window.print();
      }, 200);
    });
    window.addEventListener('afterprint', function() {
      setTimeout(function() { window.close(); }, 100);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════
export function printKitchenA4(
  order: Order,
  lang: Language,
  layout: TicketLayout
): void {
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

  const ctx: RenderCtx = {
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

  const body = renderLayout(layout, ctx);
  const html = buildHtml({
    title: `Заказ #${order.order_number}`,
    subtitle: 'Кухонный тикет',
    body,
    layout,
  });

  openPrintWindow(html);
}

export function printReceiptA4(
  order: Order,
  lang: Language,
  layout: TicketLayout
): void {
  const orderLabel = lang === 'ru' ? 'ЗАКАЗ' : 'ORDER';
  const totalLabel = lang === 'ru' ? 'ИТОГО' : 'TOTAL';
  const thanks     = lang === 'ru' ? 'СПАСИБО!' : 'THANK YOU!';

  const time = new Date(order.created_at).toLocaleString(
    lang === 'ru' ? 'ru-RU' : 'en-US'
  );

  const ctx: RenderCtx = {
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

  const body = renderLayout(layout, ctx);
  const html = buildHtml({
    title: `Чек #${order.order_number}`,
    subtitle: 'Кассовый чек',
    body,
    layout,
  });

  openPrintWindow(html);
}

// ─── Открытие окна печати ───────────────────────────────────────────────────
function openPrintWindow(html: string): void {
  const w = window.open('', '_blank', 'width=800,height=1000');
  if (!w) {
    alert(
      'Браузер заблокировал всплывающее окно печати.\n' +
        'Разреши pop-up для этого сайта.'
    );
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}