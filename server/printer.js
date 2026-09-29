import net from 'net';

// ============================================================
// ESC/POS константы
// ============================================================
const ESC = 0x1b;
const GS = 0x1d;

// ---------- Примитивы ESC/POS ----------
const cmdInit = () => Buffer.from([ESC, 0x40]);

const cmdCodePage = (encoding) => {
  // ESC t n
  // 17 (0x11) = CP866  ·  46 (0x46) = CP1251
  const page = encoding === 'cp1251' ? 0x46 : 0x11;
  return Buffer.from([ESC, 0x74, page]);
};

const cmdAlign = (align) => {
  const a = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return Buffer.from([ESC, 0x61, a]);
};

const cmdBold = (on) => Buffer.from([ESC, 0x45, on ? 1 : 0]);

const cmdDoubleSize = (on) =>
  // ESC ! n — битовая маска: 0x30 = 2x ширина + 2x высота
  Buffer.from([ESC, 0x21, on ? 0x30 : 0x00]);

const cmdFeed = (lines = 3) =>
  Buffer.from([ESC, 0x64, Math.min(255, lines)]);

const cmdCut = () => Buffer.from([GS, 0x56, 0x00]);

// ============================================================
// Кодирование текста
// ============================================================
function encodeText(text, encoding) {
  try {
    return encoding === 'cp1251'
      ? Buffer.from(text, 'win1251')
      : Buffer.from(text, 'cp866');
  } catch {
    return Buffer.from(text, 'utf8');
  }
}

function textLine(text, encoding) {
  return Buffer.concat([encodeText(text, encoding), Buffer.from([0x0a])]);
}

// ============================================================
// Форматирование
// ============================================================
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
// Кухонный чек → Buffer
// ============================================================
function buildKitchenTicket(order, width, encoding) {
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

// ============================================================
// Клиентский чек (номерок + ETA)
// ============================================================
function buildCustomerTicket(order, etaMinutes, width, encoding) {
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

// ============================================================
// Отправка по TCP (9100)
// ============================================================
function sendToPrinter(ip, port, buffer, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let finished = false;

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
    socket.once('error', finish);
    socket.once('timeout', () =>
      finish(new Error('Превышено время ожидания принтера'))
    );

    socket.connect(port, ip, () => {
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        // Дать принтеру обработать буфер перед закрытием сокета
        setTimeout(() => finish(), 300);
      });
    });
  });
}

// ============================================================
// Публичный API
// ============================================================
export async function printKitchenTicket(order, settings) {
  if (!settings.kitchen_enabled) return { success: true, skipped: true };
  if (!settings.kitchen_ip) {
    return { success: false, error: 'IP кухонного принтера не указан' };
  }
  try {
    const buffer = buildKitchenTicket(
      order,
      settings.kitchen_width || 32,
      settings.encoding || 'cp866'
    );
    await sendToPrinter(
      settings.kitchen_ip,
      settings.kitchen_port || 9100,
      buffer
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function printCustomerTicket(order, etaMinutes, settings) {
  if (!settings.cashier_enabled) return { success: true, skipped: true };
  if (!settings.cashier_ip) {
    return { success: false, error: 'IP принтера кассы не указан' };
  }
  try {
    const buffer = buildCustomerTicket(
      order,
      etaMinutes,
      settings.cashier_width || 32,
      settings.encoding || 'cp866'
    );
    await sendToPrinter(
      settings.cashier_ip,
      settings.cashier_port || 9100,
      buffer
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function testPrinter(target, settings) {
  const ip = target === 'kitchen' ? settings.kitchen_ip : settings.cashier_ip;
  const port =
    target === 'kitchen' ? settings.kitchen_port : settings.cashier_port;
  const width =
    target === 'kitchen' ? settings.kitchen_width : settings.cashier_width;
  const encoding = settings.encoding || 'cp866';

  if (!ip) return { success: false, error: 'IP не указан' };

  const label = target === 'kitchen' ? 'KITCHEN PRINTER' : 'CASHIER PRINTER';
  const w = width || 32;
  const divH = '='.repeat(w);

  const buffer = Buffer.concat([
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

  try {
    await sendToPrinter(ip, port || 9100, buffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}