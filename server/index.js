// ⚠️ ЭТОТ ИМПОРТ ДОЛЖЕН БЫТЬ ПЕРВЫМ — он загружает .env и делает fallback
import './env.js';

import express from 'express';
import cors from 'cors';
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

const PORT = process.env.PORT || 3001;

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
    online: isSupabaseOnline(),
    orders: stats.totalOrders,
    unsynced: stats.unsyncedCount,
    clients: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
    host: {
      uuid: hostInfo.hostUuid,
      number: hostInfo.hostNumber,
      rangeStart: hostInfo.rangeStart,
      rangeEnd: hostInfo.rangeEnd,
      nextOrderNumber: hostInfo.nextOrderNumber,
    },
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

// ============================================================
// ЕДИНЫЙ BROADCAST
// ============================================================
store.on('orders-changed', () => {
  io.emit('orders', store.getAllOrders());
});

store.on('menu-changed', () => {
  io.emit('menu', store.getMenu());
});

// ============================================================
// СЧЁТЧИК КЛИЕНТОВ
// ============================================================
function broadcastClientsCount() {
  const count = io.engine.clientsCount;
  io.emit('clients-count', count);
  console.log(`[ws] clients-count: ${count}`);
}

// ============================================================
// ПОДКЛЮЧЕНИЕ КЛИЕНТОВ
// ============================================================
io.on('connection', (socket) => {
  console.log(`[ws] + ${socket.id} (всего: ${io.engine.clientsCount})`);

  socket.emit('init', {
    orders: store.getAllOrders(),
    menu: store.getMenu(),
  });

  broadcastClientsCount();

  // ---------- СОЗДАНИЕ ЗАКАЗА ----------
  socket.on('create-order', (order, ack) => {
    try {
      // Получаем номер от host.js (учитывает диапазон и глобальный max)
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

  // ---------- ОБНОВЛЕНИЕ СТАТУСА ----------
  socket.on('update-status', ({ orderId, status }, ack) => {
    try {
      const updated = store.updateStatus(orderId, status);
      if (typeof ack === 'function') ack({ ok: true, order: updated });
    } catch (e) {
      console.error('[ws] update-status error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  // ---------- РЕДАКТИРОВАНИЕ ЗАКАЗА ----------
  socket.on('update-order', (order, ack) => {
    try {
      const updated = store.updateOrder(order.id, order);
      if (typeof ack === 'function') ack({ ok: true, order: updated });
    } catch (e) {
      console.error('[ws] update-order error:', e);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  // ---------- ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ ----------
  socket.on('force-sync', (_payload, ack) => {
    const stats = store.getStats();
    if (typeof ack === 'function') ack(stats);
  });

  // ---------- ОТКЛЮЧЕНИЕ ----------
  socket.on('disconnect', () => {
    console.log(`[ws] - ${socket.id} (всего: ${io.engine.clientsCount})`);
    setTimeout(() => broadcastClientsCount(), 100);
  });
});

// ============================================================
// СТАРТ
// ============================================================
async function main() {
  try {
    await bootstrapFromSupabase();
  } catch (e) {
    console.error(
      '[boot] Bootstrap упал, продолжаем в offline-режиме:',
      e.message
    );
  }

  // ============================================================
  // ИНИЦИАЛИЗАЦИЯ ХОСТА — регистрация, диапазон, heartbeat
  // ============================================================
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
    console.log('');
    console.log('🚀 Kebab POS local server');
    console.log(`   HTTP:      http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   В сети:    http://<YOUR-LAN-IP>:${PORT}`);
    console.log('');
    console.log(`   Host #${hostInfo.hostNumber}`);
    console.log(`   Диапазон заказов: ${hostInfo.rangeStart}–${hostInfo.rangeEnd}`);
    console.log(`   Следующий заказ:  ${hostInfo.nextOrderNumber}`);
    console.log('');
  });
}

main();