import net from 'net';
import { printViaBridge } from './printer-bridge-client.js';

// ============================================================
// ⚙️ НАЗВАНИЯ НА ЧЕКАХ — меняй здесь
// ============================================================
/** Название заведения на клиентском чеке (рулон и A4, тест) */
const RECEIPT_TITLE = 'Kebab Fast';

/** Заголовок кухонного чека (рулон + A4) */
const KITCHEN_TITLE = 'K I T C H E N';

// ============================================================
// ESC/POS
// ============================================================
const ESC = 0x1b;
const GS = 0x1d;

const cmdInit = () => Buffer.from([ESC, 0x40]);
const cmdCodePage = (encoding) =>
  Buffer.from([ESC, 0x74, encoding === 'cp1251' ? 0x46 : 0x11]);
const cmdAlign = (align) => {
  const a = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return Buffer.from([ESC, 0x61, a]);
};
const cmdBold = (on) => Buffer.from([ESC, 0x45, on ? 1 : 0]);
const cmdDoubleSize = (on) => Buffer.from([ESC, 0x21, on ? 0x30 : 0x00]);
const cmdFeed = (lines = 3) => Buffer.from([ESC, 0x64, Math.min(255, lines)]);
const cmdCut = () => Buffer.from([GS, 0x56, 0x00]);

const cmdUnderline = (on) => Buffer.from([ESC, 0x2d, on ? 1 : 0]);

// ============================================================
// Кодировки
// ============================================================
function encodeCp866(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c >= 0x0410 && c <= 0x042f) bytes.push(0x80 + (c - 0x0410));
    else if (c >= 0x0430 && c <= 0x043f) bytes.push(0xa0 + (c - 0x0430));
    else if (c >= 0x0440 && c <= 0x044f) bytes.push(0xe0 + (c - 0x0440));
    else if (c === 0x0401) bytes.push(0xf0);
    else if (c === 0x0451) bytes.push(0xf1);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function encodeCp1251(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c >= 0x0410 && c <= 0x042f) bytes.push(0xc0 + (c - 0x0410));
    else if (c >= 0x0430 && c <= 0x044f) bytes.push(0xe0 + (c - 0x0430));
    else if (c === 0x0401) bytes.push(0xa8);
    else if (c === 0x0451) bytes.push(0xb8);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function encodeText(text, encoding) {
  return encoding === 'cp1251' ? encodeCp1251(text) : encodeCp866(text);
}

function textLine(text, encoding) {
  return Buffer.concat([encodeText(text, encoding), Buffer.from([0x0a])]);
}

function center(text, width) {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function formatTime(iso) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ============================================================
// Хелперы delta
// ============================================================
function splitDelta(items) {
  const removed = (items ?? []).filter((i) => i.is_removed);
  const added = (items ?? []).filter((i) => i.is_added_later && !i.is_removed);
  return { removed, added };
}

// ============================================================
// Билдеры — РУЛОН
// ============================================================
export function buildKitchenBuffer(order, width, encoding) {
  const chunks = [];
  const div = '-'.repeat(width);
  const divH = '='.repeat(width);

  chunks.push(cmdInit(), cmdCodePage(encoding), cmdAlign('center'));
  chunks.push(cmdBold(true));
  chunks.push(textLine(divH, encoding));
  chunks.push(textLine(KITCHEN_TITLE, encoding));
  chunks.push(textLine(divH, encoding));
  chunks.push(cmdBold(false), textLine('', encoding));

  chunks.push(cmdDoubleSize(true));
  chunks.push(textLine(`#${order.order_number}`, encoding));
  chunks.push(cmdDoubleSize(false));

  chunks.push(textLine('', encoding));
  chunks.push(textLine(formatTime(order.created_at), encoding));
  chunks.push(textLine('', encoding));
  chunks.push(cmdAlign('left'), textLine(div, encoding));

  const active = (order.order_items ?? []).filter((i) => !i.is_removed);
  if (active.length === 0) {
    chunks.push(textLine(center('(empty)', width), encoding));
  } else {
    for (const item of active) {
      let name = item.name;
      if (item.variant) name += ` [${item.variant}]`;
      chunks.push(cmdBold(true));
      chunks.push(textLine(`${item.quantity}x ${name}`, encoding));
      chunks.push(cmdBold(false));
      for (const opt of item.options ?? []) {
        if (opt.type === 'variant') continue;
        const q = opt.quantity > 1 ? ` x${opt.quantity}` : '';
        chunks.push(textLine(`    + ${opt.name}${q}`, encoding));
      }
      chunks.push(textLine('', encoding));
    }
  }

  chunks.push(textLine(div, encoding));

  if (order.comment && order.comment.trim()) {
    chunks.push(textLine('', encoding), cmdBold(true));
    chunks.push(textLine(`!!! ${order.comment}`, encoding));
    chunks.push(cmdBold(false), textLine('', encoding));
    chunks.push(textLine(div, encoding));
  }

  chunks.push(textLine('', encoding), cmdAlign('center'));
  chunks.push(textLine(divH, encoding));
  chunks.push(cmdFeed(3), cmdCut());

  return Buffer.concat(chunks);
}

// ============================================================
// DELTA — рулон
// ============================================================
export function buildKitchenDeltaBuffer(order, width, encoding) {
  const { removed, added } = splitDelta(order.order_items);

  if (removed.length === 0 && added.length === 0) {
    return null;
  }

  const chunks = [];
  const div = '-'.repeat(width);
  const divH = '='.repeat(width);

  chunks.push(cmdInit(), cmdCodePage(encoding), cmdAlign('center'));
  chunks.push(cmdBold(true));
  chunks.push(textLine(divH, encoding));
  chunks.push(textLine('*** ИЗМЕНЕНИЕ ***', encoding));
  chunks.push(textLine(divH, encoding));
  chunks.push(cmdBold(false));

  chunks.push(cmdDoubleSize(true));
  chunks.push(textLine(`#${order.order_number}`, encoding));
  chunks.push(cmdDoubleSize(false));

  chunks.push(textLine('', encoding));
  chunks.push(textLine(formatTime(new Date().toISOString()), encoding));
  chunks.push(textLine('', encoding));

  chunks.push(cmdAlign('left'), textLine(div, encoding));

  if (removed.length > 0) {
    chunks.push(cmdBold(true));
    chunks.push(textLine('УБРАТЬ:', encoding));
    chunks.push(cmdBold(false));

    for (const item of removed) {
      let name = item.name;
      if (item.variant) name += ` [${item.variant}]`;

      chunks.push(cmdUnderline(true), cmdBold(true));
      chunks.push(textLine(`  ${item.quantity}x ${name}`, encoding));
      chunks.push(cmdBold(false));

      for (const opt of item.options ?? []) {
        if (opt.type === 'variant') continue;
        const q = opt.quantity > 1 ? ` x${opt.quantity}` : '';
        chunks.push(textLine(`      + ${opt.name}${q}`, encoding));
      }

      chunks.push(cmdUnderline(false));
    }
    chunks.push(textLine('', encoding));
  }

  if (added.length > 0) {
    chunks.push(cmdBold(true));
    chunks.push(textLine('ДОБАВИТЬ:', encoding));
    chunks.push(cmdBold(false));

    for (const item of added) {
      let name = item.name;
      if (item.variant) name += ` [${item.variant}]`;

      chunks.push(cmdBold(true));
      chunks.push(textLine(`  ${item.quantity}x ${name}`, encoding));
      chunks.push(cmdBold(false));

      for (const opt of item.options ?? []) {
        if (opt.type === 'variant') continue;
        const q = opt.quantity > 1 ? ` x${opt.quantity}` : '';
        chunks.push(textLine(`      + ${opt.name}${q}`, encoding));
      }
    }
    chunks.push(textLine('', encoding));
  }

  chunks.push(textLine(div, encoding));

  if (order.comment && order.comment.trim()) {
    chunks.push(textLine('', encoding), cmdBold(true));
    chunks.push(textLine(`ЗАМЕТКА: ${order.comment}`, encoding));
    chunks.push(cmdBold(false), textLine('', encoding));
    chunks.push(textLine(div, encoding));
  }

  chunks.push(textLine('', encoding), cmdAlign('center'));
  chunks.push(textLine(divH, encoding));
  chunks.push(cmdFeed(3), cmdCut());

  return Buffer.concat(chunks);
}

export function buildCustomerBuffer(order, etaMinutes, width, encoding) {
  const chunks = [];
  const divH = '='.repeat(width);

  chunks.push(cmdInit(), cmdCodePage(encoding), cmdAlign('center'));
  chunks.push(cmdBold(true));
  chunks.push(textLine(divH, encoding));
  chunks.push(textLine(RECEIPT_TITLE, encoding));
  chunks.push(textLine(divH, encoding));
  chunks.push(cmdBold(false));
  chunks.push(textLine('', encoding), textLine('', encoding));

  chunks.push(cmdDoubleSize(true));
  chunks.push(textLine(`#${order.order_number}`, encoding));
  chunks.push(cmdDoubleSize(false));
  chunks.push(textLine('', encoding));

  if (etaMinutes && etaMinutes > 0) {
    chunks.push(cmdBold(true));
    chunks.push(textLine(`~${etaMinutes} min`, encoding));
    chunks.push(cmdBold(false), textLine('', encoding));
  }

  chunks.push(textLine('', encoding), textLine(divH, encoding));
  chunks.push(cmdFeed(3), cmdCut());

  return Buffer.concat(chunks);
}

// ============================================================
// A4
// ============================================================
function a4Line(text, encoding) {
  return Buffer.concat([encodeText(text, encoding), Buffer.from([0x0d, 0x0a])]);
}

function a4Center(text, width) {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function strikeText(text) {
  return `[~УДАЛЕНО~] ${text}`;
}

export function buildKitchenA4Buffer(order, encoding = 'cp1251') {
  const W = 80;
  const div = '-'.repeat(W);
  const divH = '='.repeat(W);
  const chunks = [];

  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line(a4Center(KITCHEN_TITLE, W), encoding));
  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(
    a4Line(a4Center(`ЗАКАЗ  # ${order.order_number}`, W), encoding)
  );
  chunks.push(a4Line('', encoding));
  chunks.push(
    a4Line(
      a4Center(
        `${formatTime(order.created_at)}   ·   ${
          order.order_type === 'INSIDE' ? 'В ЗАЛЕ' : 'С СОБОЙ'
        }`,
        W
      ),
      encoding
    )
  );
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line(div, encoding));
  chunks.push(a4Line('', encoding));

  const active = (order.order_items ?? []).filter((i) => !i.is_removed);

  if (active.length === 0) {
    chunks.push(a4Line(a4Center('(пусто)', W), encoding));
  } else {
    for (const item of active) {
      let name = item.name;
      if (item.variant) name += `  [${item.variant}]`;
      chunks.push(a4Line(`${item.quantity} x   ${name}`, encoding));
      for (const opt of item.options ?? []) {
        if (opt.type === 'variant') continue;
        const q = opt.quantity > 1 ? ` x${opt.quantity}` : '';
        chunks.push(a4Line(`         + ${opt.name}${q}`, encoding));
      }
      chunks.push(a4Line('', encoding));
    }
  }

  chunks.push(a4Line(div, encoding));

  if (order.comment && order.comment.trim()) {
    chunks.push(a4Line('', encoding));
    chunks.push(a4Line(`ПРИМЕЧАНИЕ:  ${order.comment}`, encoding));
    chunks.push(a4Line('', encoding));
    chunks.push(a4Line(div, encoding));
  }

  chunks.push(a4Line('', encoding));
  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(Buffer.from([0x0c]));

  return Buffer.concat(chunks);
}

export function buildKitchenA4DeltaBuffer(order, encoding = 'cp1251') {
  const { removed, added } = splitDelta(order.order_items);

  if (removed.length === 0 && added.length === 0) {
    return null;
  }

  const W = 80;
  const div = '-'.repeat(W);
  const divH = '='.repeat(W);
  const chunks = [];

  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line(a4Center('*** ИЗМЕНЕНИЕ ЗАКАЗА ***', W), encoding));
  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(
    a4Line(a4Center(`ЗАКАЗ  # ${order.order_number}`, W), encoding)
  );
  chunks.push(
    a4Line(a4Center(formatTime(new Date().toISOString()), W), encoding)
  );
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line(div, encoding));
  chunks.push(a4Line('', encoding));

  if (removed.length > 0) {
    chunks.push(a4Line('УБРАТЬ:', encoding));
    for (const item of removed) {
      let name = item.name;
      if (item.variant) name += `  [${item.variant}]`;
      chunks.push(
        a4Line(`   ${item.quantity} x   ${strikeText(name)}`, encoding)
      );
      for (const opt of item.options ?? []) {
        if (opt.type === 'variant') continue;
        const q = opt.quantity > 1 ? ` x${opt.quantity}` : '';
        chunks.push(
          a4Line(`         + ${strikeText(opt.name + q)}`, encoding)
        );
      }
    }
    chunks.push(a4Line('', encoding));
  }

  if (added.length > 0) {
    chunks.push(a4Line('ДОБАВИТЬ:', encoding));
    for (const item of added) {
      let name = item.name;
      if (item.variant) name += `  [${item.variant}]`;
      chunks.push(a4Line(`   ${item.quantity} x   ${name}`, encoding));
      for (const opt of item.options ?? []) {
        if (opt.type === 'variant') continue;
        const q = opt.quantity > 1 ? ` x${opt.quantity}` : '';
        chunks.push(a4Line(`         + ${opt.name}${q}`, encoding));
      }
    }
    chunks.push(a4Line('', encoding));
  }

  chunks.push(a4Line(div, encoding));

  if (order.comment && order.comment.trim()) {
    chunks.push(a4Line('', encoding));
    chunks.push(a4Line(`ПРИМЕЧАНИЕ:  ${order.comment}`, encoding));
    chunks.push(a4Line('', encoding));
    chunks.push(a4Line(div, encoding));
  }

  chunks.push(a4Line('', encoding));
  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(Buffer.from([0x0c]));

  return Buffer.concat(chunks);
}

// ============================================================
// Тестовый буфер
// ============================================================
function buildTestBuffer(target, settings) {
  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  const encoding = settings.encoding || 'cp866';

  if (slot?.paper === 'a4') {
    const W = 80;
    const divH = '='.repeat(W);
    const label = target === 'kitchen' ? 'ПРИНТЕР КУХНИ' : 'ПРИНТЕР КАССЫ';
    const lines = [
      divH,
      a4Center(RECEIPT_TITLE, W),
      divH,
      '',
      a4Center(label, W),
      a4Center('ТЕСТ ПЕЧАТИ — OK', W),
      '',
      new Date().toLocaleString('ru-RU'),
      '',
      divH,
      '',
    ];
    return Buffer.concat([
      ...lines.map((l) => a4Line(l, 'cp1251')),
      Buffer.from([0x0c]),
    ]);
  }

  const w = slot?.width || 32;
  const divH = '='.repeat(w);
  const label = target === 'kitchen' ? 'KITCHEN PRINTER' : 'CASHIER PRINTER';

  return Buffer.concat([
    cmdInit(),
    cmdCodePage(encoding),
    cmdAlign('center'),
    cmdBold(true),
    textLine(divH, encoding),
    textLine(RECEIPT_TITLE, encoding),
    textLine(divH, encoding),
    cmdBold(false),
    textLine('', encoding),
    textLine(label, encoding),
    textLine('TEST PRINT OK', encoding),
    textLine('', encoding),
    textLine(new Date().toLocaleString('ru-RU'), encoding),
    textLine('', encoding),
    textLine(divH, encoding),
    cmdFeed(3),
    cmdCut(),
  ]);
}

// ============================================================
// TCP
// ============================================================
function sendToPrinter(ip, port, buffer, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let finished = false;
    let writeDone = false;

    const finish = (err) => {
      if (finished) return;
      finished = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('error', (e) => finish(e));
    socket.once('timeout', () =>
      finish(new Error('Превышено время ожидания принтера'))
    );
    socket.once('close', () => {
      if (writeDone) finish();
    });

    socket.connect(port, ip, () => {
      console.log(`[printer] TCP connected to ${ip}:${port}`);
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        writeDone = true;
        console.log(
          `[printer] TCP wrote ${buffer.length} bytes → ${ip}:${port}`
        );
        socket.end();
        setTimeout(() => {
          if (!finished) {
            console.log('[printer] force close (timeout)');
            finish();
          }
        }, 3000);
      });
    });
  });
}

// ============================================================
// Универсальный роутер
// ============================================================
async function printToSlot(slot, buffer, target, settings, opts = {}) {
  if (!slot || !slot.enabled) {
    return { success: true, skipped: true };
  }

  const datatype =
    typeof opts.datatype === 'string' ? opts.datatype : 'RAW';

  if (slot.source === 'windows') {
    if (!slot.printer_name) {
      return { success: false, error: 'Windows-принтер не выбран' };
    }
    try {
      const r = await printViaBridge(slot.printer_name, buffer, { datatype });
      console.log(
        `[printer] ✓ ${target} → windows bridge "${slot.printer_name}" ` +
          `(${r.bytes} bytes, ${datatype})`
      );
      return { success: true };
    } catch (e) {
      console.error(`[printer] ✗ ${target} windows bridge:`, e.message);
      return { success: false, error: e.message };
    }
  }

  if (slot.source === 'usb') {
    return { success: true, skipped: true, note: 'usb-client-side' };
  }

  if (!slot.ip) {
    return { success: false, error: 'IP принтера не указан' };
  }
  try {
    await sendToPrinter(slot.ip, slot.port || 9100, buffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// Публичный API
// ============================================================
export async function printKitchenTicket(order, settings) {
  console.log(
    `[printer] printKitchenTicket #${order?.order_number ?? '?'}`
  );
  const slot = settings.kitchen;
  const isA4 = slot?.paper === 'a4';
  const encoding = isA4 ? 'cp1251' : settings.encoding || 'cp866';

  const buffer = isA4
    ? buildKitchenA4Buffer(order, encoding)
    : buildKitchenBuffer(order, slot?.width || 32, encoding);

  return printToSlot(slot, buffer, 'kitchen', settings, {
    datatype: isA4 ? 'TEXT' : 'RAW',
  });
}

export async function printKitchenDelta(order, settings) {
  console.log(
    `[printer] printKitchenDelta #${order?.order_number ?? '?'}`
  );

  const slot = settings.kitchen;
  if (!slot || !slot.enabled) {
    console.log('[printer] delta: kitchen disabled → skip');
    return { success: true, skipped: true };
  }

  const isA4 = slot?.paper === 'a4';
  const encoding = isA4 ? 'cp1251' : settings.encoding || 'cp866';

  const buffer = isA4
    ? buildKitchenA4DeltaBuffer(order, encoding)
    : buildKitchenDeltaBuffer(order, slot?.width || 32, encoding);

  if (!buffer) {
    console.log('[printer] delta: нет изменений — пропускаю');
    return { success: true, skipped: true, note: 'no-changes' };
  }

  return printToSlot(slot, buffer, 'kitchen-delta', settings, {
    datatype: isA4 ? 'TEXT' : 'RAW',
  });
}

export function buildCustomerA4Buffer(order, etaMinutes, encoding = 'cp1251') {
  const W = 80;
  const divH = '='.repeat(W);
  const chunks = [];

  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line(a4Center(RECEIPT_TITLE, W), encoding));
  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(
    a4Line(a4Center(`Ваш номер:  #${order.order_number}`, W), encoding)
  );
  chunks.push(a4Line('', encoding));

  if (etaMinutes && etaMinutes > 0) {
    chunks.push(
      a4Line(a4Center(`Примерное время: ~${etaMinutes} мин`, W), encoding)
    );
  }

  chunks.push(a4Line('', encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(a4Line(divH, encoding));
  chunks.push(a4Line('', encoding));
  chunks.push(Buffer.from([0x0c]));

  return Buffer.concat(chunks);
}

export async function printCustomerTicket(order, etaMinutes, settings) {
  console.log(
    `[printer] printCustomerTicket #${order?.order_number ?? '?'} eta=${etaMinutes}`
  );
  const slot = settings.cashier;
  const isA4 = slot?.paper === 'a4';
  const encoding = isA4 ? 'cp1251' : settings.encoding || 'cp866';

  const buffer = isA4
    ? buildCustomerA4Buffer(order, etaMinutes, encoding)
    : buildCustomerBuffer(order, etaMinutes, slot?.width || 32, encoding);

  return printToSlot(slot, buffer, 'cashier', settings, {
    datatype: isA4 ? 'TEXT' : 'RAW',
  });
}

export async function testPrinter(target, settings) {
  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  console.log(`[printer] testPrinter target=${target}`);

  if (!slot || !slot.enabled) {
    return { success: false, error: 'Принтер не включён' };
  }

  const buffer = buildTestBuffer(target, settings);
  console.log(`[printer] test buffer: ${buffer.length} bytes`);
  return printToSlot(slot, buffer, `test/${target}`, settings, {
    datatype: slot.paper === 'a4' ? 'TEXT' : 'RAW',
  });
}

// ============================================================
// base64 для WebUSB
// ============================================================
export function buildTicketBase64(target, order, etaMinutes, settings) {
  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  const width = slot?.width || 32;
  const encoding = settings.encoding || 'cp866';

  const buf =
    target === 'kitchen'
      ? buildKitchenBuffer(order, width, encoding)
      : buildCustomerBuffer(order, etaMinutes || 0, width, encoding);

  return buf.toString('base64');
}

export function buildTestBufferBase64(target, settings) {
  return buildTestBuffer(target, settings).toString('base64');
}

export function buildKitchenDeltaBase64(order, settings) {
  const slot = settings.kitchen;
  const width = slot?.width || 32;
  const encoding = settings.encoding || 'cp866';
  const buf = buildKitchenDeltaBuffer(order, width, encoding);
  if (!buf) return null;
  return buf.toString('base64');
}