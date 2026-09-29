import http from 'http';

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 9999;

function httpRequest(method, path, headers = {}, body = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT,
        method,
        path,
        headers,
        timeout: timeoutMs,
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

export async function isBridgeAvailable() {
  try {
    const res = await httpRequest('GET', '/health', {}, null, 1500);
    return res.status === 200 && res.json?.ok === true;
  } catch {
    return false;
  }
}

export async function listBridgePrinters() {
  const res = await httpRequest('GET', '/printers', {}, null, 4000);
  if (res.status !== 200 || !res.json?.ok) {
    throw new Error(res.json?.error || 'bridge error');
  }
  return res.json.printers ?? [];
}

export async function printViaBridge(printerName, buffer, timeoutMs = 10_000) {
  const res = await httpRequest(
    'POST',
    '/print',
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
      'X-Printer-Name': printerName,
    },
    buffer,
    timeoutMs
  );
  if (res.status !== 200 || !res.json?.ok) {
    throw new Error(res.json?.error || 'bridge print failed');
  }
  return res.json;
}