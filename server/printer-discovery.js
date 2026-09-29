import net from 'net';
import os from 'os';

// ============================================================
// Определяем все локальные IPv4-интерфейсы
// ============================================================
function getLocalIPv4() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        result.push({
          iface: name,
          address: info.address,
          netmask: info.netmask,
        });
      }
    }
  }
  return result;
}

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}

function intToIp(n) {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.');
}

// ============================================================
// Проверка TCP-порта
// ============================================================
function checkPort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, ip, () => finish(true));
  });
}

// ============================================================
// Сканирование локальной сети на открытый порт принтера
// ============================================================
export async function scanNetworkForPrinters(port = 9100, opts = {}) {
  const {
    maxHosts = 512,
    timeoutMs = 200,
    batchSize = 64,
  } = opts;

  const locals = getLocalIPv4();
  const found = [];
  const seen = new Set();

  for (const net of locals) {
    const maskInt = ipToInt(net.netmask);
    const addrInt = ipToInt(net.address);
    const networkInt = (addrInt & maskInt) >>> 0;
    const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;

    const rangeSize = broadcastInt - networkInt - 1;
    if (rangeSize <= 0) continue;

    const limit = Math.min(rangeSize, maxHosts);
    const ips = [];
    for (let i = 1; i <= limit; i++) {
      const ip = intToIp((networkInt + i) >>> 0);
      if (ip === net.address) continue;
      ips.push(ip);
    }

    for (let i = 0; i < ips.length; i += batchSize) {
      const batch = ips.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (ip) => {
          const ok = await checkPort(ip, port, timeoutMs);
          return ok ? ip : null;
        })
      );
      for (const ip of results) {
        if (ip && !seen.has(ip)) {
          seen.add(ip);
          found.push({
            source: 'network',
            ip,
            port,
            name: `POS-${ip}`,
          });
        }
      }
    }
  }

  return found;
}