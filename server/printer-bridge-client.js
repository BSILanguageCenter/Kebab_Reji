import http from 'http';

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 9999;

/**
 * Универсальный HTTP-запрос к Python-бриджу.
 *
 * @param {string} method   GET / POST
 * @param {string} path     /health, /printers, /print
 * @param {object} headers  заголовки
 * @param {Buffer|null} body
 * @param {number} timeoutMs — ЧИСЛО (не объект!)
 */
function httpRequest(method, path, headers = {}, body = null, timeoutMs = 5000) {
  // Защита: если случайно пришёл объект вместо числа — ставим дефолт
  const safeTimeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? timeoutMs
      : 5000;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
        method,
        path,
        headers,
        timeout: safeTimeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, raw, json: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Bridge timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ============================================================
// Проверка доступности бриджа
// ============================================================
export async function isBridgeAvailable() {
  try {
    const res = await httpRequest('GET', '/health', {}, null, 1500);
    return res.status === 200 && res.json?.ok === true;
  } catch {
    return false;
  }
}

// ============================================================
// Список принтеров Windows
// ============================================================
export async function listBridgePrinters() {
  const res = await httpRequest('GET', '/printers', {}, null, 4000);
  if (res.status !== 200 || !res.json?.ok) {
    throw new Error(res.json?.error || 'bridge error');
  }
  return res.json.printers ?? [];
}

// ============================================================
// Печать
//
// @param {string} printerName — имя принтера в Windows
// @param {Buffer} buffer      — сырые байты
// @param {object} opts
//   opts.datatype = 'RAW'  — для ESC/POS (Xprinter, Epson TM)
//   opts.datatype = 'TEXT' — для A4-документа (Epson L4160)
//   opts.timeoutMs
// ============================================================
export async function printViaBridge(printerName, buffer, opts = {}) {
  // Явная деструктуризация — избегаем передачи объекта целиком
  const datatype =
    typeof opts.datatype === 'string' ? opts.datatype : 'RAW';
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? opts.timeoutMs
      : 15_000;

  const res = await httpRequest(
    'POST',
    '/print',
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
      'X-Printer-Name': String(printerName || ''),
      'X-Datatype': datatype,
    },
    buffer,
    timeoutMs
  );

  if (res.status !== 200 || !res.json?.ok) {
    throw new Error(res.json?.error || 'bridge print failed');
  }
  return res.json;
}