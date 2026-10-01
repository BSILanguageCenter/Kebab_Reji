// ⚠️ ЭТОТ ИМПОРТ ДОЛЖЕН БЫТЬ ПЕРВЫМ
import './env.js';

import express from 'express';
import cors from 'cors';
import net from 'net';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { store } from './store.js';
import {
  bootstrapFromSupabase,
  startSyncLoop,
  isSupabaseOnline,
  getSupabaseClient,
} from './supabase-sync.js';
import {
  initHost,
  getHostInfo,
  getNextOrderNumber,
  bumpNextOrderNumber,
} from './host.js';
import {
  printKitchenTicket,
  printKitchenDelta,
  printCustomerTicket,
  testPrinter,
  buildTicketBase64,
  buildTestBufferBase64,
  buildKitchenDeltaBase64,
} from './printer.js';
import { scanNetworkForPrinters } from './printer-discovery.js';
import {
  isBridgeAvailable,
  listBridgePrinters,
} from './printer-bridge-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const SERVER_VERSION = 'v6-printers-delta';

// ============================================================
// PYTHON BRIDGE
// ============================================================
let bridgeProcess = null;

function findPythonBinary() {
  const candidates =
    process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 3000 });
      return cmd;
    } catch {
      /* continue */
    }
  }
  return null;
}

function startPrinterBridge() {
  const bridgePath = join(__dirname, 'printer_bridge.py');
  if (!existsSync(bridgePath)) {
    console.log('[bridge] printer_bridge.py не найден — пропускаю');
    return;
  }

  const python = findPythonBinary();
  if (!python) {
    console.warn('[bridge] Python не найден — Windows-принтеры недоступны');
    return;
  }

  try {
    bridgeProcess = spawn(python, ['-u', bridgePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    console.error('[bridge] spawn error:', e.message);
    return;
  }

  bridgeProcess.stdout.on('data', (d) => process.stdout.write(`${d}`));
  bridgeProcess.stderr.on('data', (d) => process.stderr.write(`${d}`));
  bridgeProcess.on('error', (e) => {
    console.error(`[bridge] process error: ${e.message}`);
    bridgeProcess = null;
  });
  bridgeProcess.on('exit', (code, signal) => {
    console.log(`[bridge] exited (code=${code}, signal=${signal})`);
    bridgeProcess = null;
  });

  console.log(`[bridge] запущен через "${python}"`);
}

function stopPrinterBridge() {
  if (bridgeProcess) {
    try {
      bridgeProcess.kill();
    } catch {
      /* ignore */
    }
    bridgeProcess = null;
  }
}

process.on('exit', stopPrinterBridge);
process.on('SIGINT', () => {
  stopPrinterBridge();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopPrinterBridge();
  process.exit(0);
});

// ============================================================
// Layout
// ============================================================
let globalLayoutSettings = null;

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const stats = store.getStats();
  const hostInfo = getHostInfo();
  res.json({
    ok: true,
    version: SERVER_VERSION,
    online: isSupabaseOnline(),
    orders: stats.totalOrders,
    unsynced: stats.unsyncedCount,
    clients: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    bridge: bridgeProcess !== null,
    host: {
      uuid: hostInfo.hostUuid,
      number: hostInfo.hostNumber,
      rangeStart: hostInfo.rangeStart,
      rangeEnd: hostInfo.rangeEnd,
      nextOrderNumber: hostInfo.nextOrderNumber,
    },
  });
});

app.get('/api/printer/status', async (_req, res) => {
  const settings = store.getPrinterSettings();

  const checkSlot = (slot) =>
    new Promise((resolve) => {
      if (!slot || !slot.enabled) {
        return resolve({ status: 'disabled' });
      }
      if (slot.source === 'usb') {
        return resolve({ status: 'usb-client-side' });
      }
      if (slot.source === 'windows') {
        return resolve({
          status: 'windows',
          printer_name: slot.printer_name || '(не выбран)',
        });
      }
      if (!slot.ip) {
        return resolve({ status: 'no-ip' });
      }
      const socket = new net.Socket();
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(
          ok
            ? { status: 'reachable', target: `${slot.ip}:${slot.port || 9100}` }
            : { status: 'unreachable', error: err }
        );
      };
      socket.setTimeout(2500);
      socket.once('error', (e) => finish(false, e.message));
      socket.once('timeout', () => finish(false, 'timeout'));
      socket.connect(slot.port || 9100, slot.ip, () => finish(true));
    });

  const [kitchen, cashier] = await Promise.all([
    checkSlot(settings.kitchen),
    checkSlot(settings.cashier),
  ]);

  res.json({
    version: SERVER_VERSION,
    bridge_running: bridgeProcess !== null,
    settings,
    connectivity: { kitchen, cashier },
  });
});

// ============================================================
// HTTP + SOCKET.IO
// ============================================================
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000,
});

store.on('orders-changed', () => {
  io.emit('orders', store.getAllOrders());
});

store.on('menu-changed', () => {
  io.emit('menu', store.getMenu());
});

function broadcastClientsCount() {
  const count = io.engine.clientsCount;
  io.emit('clients-count', count);
  console.log(`[ws] clients-count: ${count}`);
}

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', (socket) => {
  console.log(`[ws] + ${socket.id} (всего: ${io.engine.clientsCount})`);

  try {
    socket.emit('init', {
      orders: store.getAllOrders(),
      menu: store.getMenu(),
    });
  } catch (e) {
    console.error('[ws] init error:', e);
  }

  if (globalLayoutSettings) {
    socket.emit('layout-settings', globalLayoutSettings);
  }

  broadcastClientsCount();

  // ---------- LAYOUT ----------
  socket.on('layout-settings', (settings) => {
    try {
      if (!settings || typeof settings !== 'object') return;
      globalLayoutSettings = settings;
      socket.broadcast.emit('layout-settings', settings);
    } catch (e) {
      console.error('[ws] layout-settings error:', e);
    }
  });

  // ---------- ЗАКАЗЫ ----------
  socket.on('create-order', (order, ack) => {
    try {
      const orderNumber = getNextOrderNumber();
      const created = store.createOrder({
        ...order,
        order_number: orderNumber,
      });
      bumpNextOrderNumber(orderNumber);
      if (typeof ack === 'function') ack({ ok: true, order: created });
    } catch (e) {
      console.error('[ws] create-order error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('update-status', ({ orderId, status }, ack) => {
    try {
      const updated = store.updateStatus(orderId, status);
      if (typeof ack === 'function') ack({ ok: true, order: updated });
    } catch (e) {
      console.error('[ws] update-status error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('update-order', (order, ack) => {
    try {
      const updated = store.updateOrder(order.id, order);
      if (typeof ack === 'function') ack({ ok: true, order: updated });
    } catch (e) {
      console.error('[ws] update-order error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('force-sync', (_payload, ack) => {
    try {
      const stats = store.getStats();
      if (typeof ack === 'function') ack(stats);
    } catch (e) {
      console.error('[ws] force-sync error:', e);
      if (typeof ack === 'function') ack({ unsyncedCount: 0, totalOrders: 0 });
    }
  });

  // ---------- ПРИНТЕРЫ ----------
  socket.on('printer-settings-get', (_p, ack) => {
    try {
      const settings = store.getPrinterSettings();
      if (typeof ack === 'function') ack({ ok: true, settings });
    } catch (e) {
      console.error('[ws] printer-settings-get error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('printer-settings-save', (settings, ack) => {
    try {
      const saved = store.savePrinterSettings(settings ?? {});
      io.emit('printer-settings', saved);
      if (typeof ack === 'function') ack({ ok: true, settings: saved });
    } catch (e) {
      console.error('[ws] printer-settings-save error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('printer-scan', async (_p, ack) => {
    console.log('[ws] printer-scan: начало...');
    try {
      const network = await scanNetworkForPrinters(9100);

      let windows = [];
      try {
        if (await isBridgeAvailable()) {
          const list = await listBridgePrinters();
          windows = list.map((p) => ({
            id: `win:${p.name}`,
            source: 'windows',
            name: p.name,
            printer_name: p.name,
            port: p.port,
            driver: p.driver,
            is_default: p.is_default,
          }));
          console.log(
            `[ws] printer-scan: bridge → ${windows.length} windows printers`
          );
        }
      } catch (e) {
        console.warn('[ws] printer-scan bridge error:', e.message);
      }

      const printers = [...network, ...windows];
      console.log(
        `[ws] printer-scan: network=${network.length}, windows=${windows.length}, total=${printers.length}`
      );
      if (typeof ack === 'function') ack({ ok: true, printers });
    } catch (e) {
      console.error('[ws] printer-scan error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  // ---------- ПОЛНЫЙ ЧЕК КУХНИ ----------
  socket.on('printer-print-kitchen', async (order, ack) => {
    console.log(
      `[ws] printer-print-kitchen #${order?.order_number ?? '?'}`
    );
    try {
      const res = await printKitchenTicket(order, store.getPrinterSettings());
      console.log('[ws] printer-print-kitchen result:', JSON.stringify(res));
      if (typeof ack === 'function') ack(res);
    } catch (e) {
      console.error('[ws] printer-print-kitchen error:', e);
      if (typeof ack === 'function')
        ack({ success: false, error: e.message });
    }
  });

  // ---------- DELTA-ЧЕК КУХНИ ----------
  socket.on('printer-print-kitchen-delta', async (order, ack) => {
    console.log(
      `[ws] printer-print-kitchen-delta #${order?.order_number ?? '?'}`
    );
    try {
      const res = await printKitchenDelta(order, store.getPrinterSettings());
      console.log(
        '[ws] printer-print-kitchen-delta result:',
        JSON.stringify(res)
      );
      if (typeof ack === 'function') ack(res);
    } catch (e) {
      console.error('[ws] printer-print-kitchen-delta error:', e);
      if (typeof ack === 'function')
        ack({ success: false, error: e.message });
    }
  });

  // ---------- ЧЕК КЛИЕНТУ ----------
  socket.on('printer-print-customer', async ({ order, etaMinutes }, ack) => {
    try {
      const res = await printCustomerTicket(
        order,
        etaMinutes,
        store.getPrinterSettings()
      );
      if (typeof ack === 'function') ack(res);
    } catch (e) {
      console.error('[ws] printer-print-customer error:', e);
      if (typeof ack === 'function')
        ack({ success: false, error: e.message });
    }
  });

  // ---------- ТЕСТ ----------
  socket.on('printer-test', async ({ target, settings }, ack) => {
    console.log(`[ws] printer-test target=${target}`);
    try {
      const res = await testPrinter(target, settings ?? {});
      console.log('[ws] printer-test result:', JSON.stringify(res));
      if (typeof ack === 'function') ack(res);
    } catch (e) {
      console.error('[ws] printer-test error:', e);
      if (typeof ack === 'function')
        ack({ success: false, error: e.message });
    }
  });

  // ---------- BUILD (WebUSB) ----------
  socket.on('printer-build', ({ target, order, etaMinutes }, ack) => {
    try {
      const settings = store.getPrinterSettings();
      const buffer = buildTicketBase64(
        target,
        order,
        etaMinutes || 0,
        settings
      );
      if (typeof ack === 'function') ack({ ok: true, buffer });
    } catch (e) {
      console.error('[ws] printer-build error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('printer-build-test', ({ target }, ack) => {
    try {
      const settings = store.getPrinterSettings();
      const buffer = buildTestBufferBase64(target, settings);
      if (typeof ack === 'function') ack({ ok: true, buffer });
    } catch (e) {
      console.error('[ws] printer-build-test error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('printer-build-delta', (order, ack) => {
    try {
      const settings = store.getPrinterSettings();
      const buffer = buildKitchenDeltaBase64(order, settings);
      if (typeof ack === 'function') ack({ ok: true, buffer });
    } catch (e) {
      console.error('[ws] printer-build-delta error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[ws] - ${socket.id} (всего: ${io.engine.clientsCount})`);
    setTimeout(() => broadcastClientsCount(), 100);
  });
});

// ============================================================
// СТАРТ
// ============================================================
async function main() {
  startPrinterBridge();
  await new Promise((r) => setTimeout(r, 1500));

  try {
    await bootstrapFromSupabase();
  } catch (e) {
    console.error(
      '[boot] Bootstrap упал, продолжаем в offline-режиме:',
      e.message
    );
  }

  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      await initHost(supabase, store);
    } else {
      console.warn('[boot] Нет Supabase-клиента — host не инициализирован');
    }
  } catch (e) {
    console.error('[boot] Не удалось инициализировать хост:', e.message);
  }

  startSyncLoop();

  httpServer.listen(PORT, '0.0.0.0', () => {
    const hostInfo = getHostInfo();
    const p = store.getPrinterSettings();

    const describe = (slot) => {
      if (!slot.enabled) return 'OFF';
      if (slot.source === 'usb') return `USB (client-side)`;
      if (slot.source === 'windows')
        return `WINDOWS "${slot.printer_name || '?'}" (${slot.paper})`;
      return `NETWORK ${slot.ip}:${slot.port} (${slot.paper})`;
    };

    console.log('');
    console.log(`🚀 Kebab POS local server (${SERVER_VERSION})`);
    console.log(`   HTTP:      http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(
      `   Bridge:    ${bridgeProcess ? '✓ работает' : '✗ не запущен'}`
    );
    console.log('');
    console.log(`   Кухня: ${describe(p.kitchen)}`);
    console.log(`   Касса: ${describe(p.cashier)}`);
    console.log('');
  });
}

main();