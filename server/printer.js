import net from 'net';
import { printViaBridge } from './printer-bridge-client.js';

// ============================================================
// ESC/POS константы
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

// ============================================================
// Кодирование CP866 / CP1251
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
// Билдеры буферов
// ============================================================
export function buildKitchenBuffer(order, width, encoding) {
  const chunks = [];
  const div = '-'.repeat(width);
  const divH = '='.repeat(width);

  chunks.push(cmdInit(), cmdCodePage(encoding), cmdAlign('center'));
  chunks.push(cmdBold(true));
  chunks.push(textLine(divH, encoding));
  chunks.push(textLine('K I T C H E N', encoding));
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

export function buildCustomerBuffer(order, etaMinutes, width, encoding) {
  const chunks = [];
  const divH = '='.repeat(width);

  chunks.push(cmdInit(), cmdCodePage(encoding), cmdAlign('center'));
  chunks.push(cmdBold(true));
  chunks.push(textLine(divH, encoding));
  chunks.push(textLine('KEBAB POS', encoding));
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

function buildTestBuffer(target, settings) {
  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  const w = slot?.width || 32;
  const encoding = settings.encoding || 'cp866';
  const divH = '='.repeat(w);
  const label = target === 'kitchen' ? 'KITCHEN PRINTER' : 'CASHIER PRINTER';

  return Buffer.concat([
    cmdInit(),
    cmdCodePage(encoding),
    cmdAlign('center'),
    cmdBold(true),
    textLine(divH, encoding),
    textLine('KEBAB POS', encoding),
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
// TCP-отправка (для сетевых принтеров)
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
// Универсальный роутер — печать в один слот
// ============================================================
async function printToSlot(slot, buffer, target, settings) {
  if (!slot || !slot.enabled) {
    return { success: true, skipped: true };
  }

  // Windows USB через Python-бридж
  if (slot.source === 'windows') {
    if (!slot.printer_name) {
      return { success: false, error: 'Windows-принтер не выбран' };
    }
    try {
      const r = await printViaBridge(slot.printer_name, buffer);
      console.log(
        `[printer] ✓ ${target} → windows bridge "${slot.printer_name}" (${r.bytes} bytes)`
      );
      return { success: true };
    } catch (e) {
      console.error(`[printer] ✗ ${target} windows bridge:`, e.message);
      return { success: false, error: e.message };
    }
  }

  // WebUSB — печатает клиент, сервер пропускает
  if (slot.source === 'usb') {
    return { success: true, skipped: true, note: 'usb-client-side' };
  }

  // Сеть
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
  if (slot?.source === 'network' && slot?.ip) {
    const buffer = buildKitchenBuffer(
      order,
      slot.width || 32,
      settings.encoding || 'cp866'
    );
    return printToSlot(slot, buffer, 'kitchen', settings);
  }
  const buffer = buildKitchenBuffer(
    order,
    slot?.width || 32,
    settings.encoding || 'cp866'
  );
  return printToSlot(slot, buffer, 'kitchen', settings);
}

export async function printCustomerTicket(order, etaMinutes, settings) {
  console.log(
    `[printer] printCustomerTicket #${order?.order_number ?? '?'} eta=${etaMinutes}`
  );
  const slot = settings.cashier;
  const buffer = buildCustomerBuffer(
    order,
    etaMinutes,
    slot?.width || 32,
    settings.encoding || 'cp866'
  );
  return printToSlot(slot, buffer, 'cashier', settings);
}

export async function testPrinter(target, settings) {
  const slot = target === 'kitchen' ? settings.kitchen : settings.cashier;
  console.log(`[printer] testPrinter target=${target}`, JSON.stringify(slot));

  if (!slot || !slot.enabled) {
    return { success: false, error: 'Принтер не включён' };
  }

  const buffer = buildTestBuffer(target, settings);
  console.log(`[printer] test buffer: ${buffer.length} bytes`);
  return printToSlot(slot, buffer, `test/${target}`, settings);
}

// ============================================================
// Для WebUSB: отдать base64 ESC/POS буфера клиенту
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