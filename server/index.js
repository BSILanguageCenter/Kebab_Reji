// ⚠️ ЭТОТ ИМПОРТ ДОЛЖЕН БЫТЬ ПЕРВЫМ — он загружает .env
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
} from './supabase-sync.js';

const PORT = process.env.PORT || 3001;

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const stats = store.getStats();
  res.json({
    ok: true,
    online: isSupabaseOnline(),
    orders: stats.totalOrders,
    unsynced: stats.unsyncedCount,
    uptime: Math.floor(process.uptime()),
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

io.on('connection', (socket) => {
  console.log(`[ws] + ${socket.id} (всего: ${io.engine.clientsCount})`);

  // Отправляем полный снимок новому клиенту
  socket.emit('init', {
    orders: store.getAllOrders(),
    menu: store.getMenu(),
  });

  // Broadcast изменений
  const onOrdersChanged = () => {
    io.emit('orders', store.getAllOrders());
  };
  const onMenuChanged = () => {
    io.emit('menu', store.getMenu());
  };

  store.on('orders-changed', onOrdersChanged);
  store.on('menu-changed', onMenuChanged);

  // ---------- СОЗДАНИЕ ЗАКАЗА ----------
  socket.on('create-order', (order, ack) => {
    try {
      const created = store.createOrder(order);
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
    store.off('orders-changed', onOrdersChanged);
    store.off('menu-changed', onMenuChanged);
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

  startSyncLoop();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🚀 Kebab POS local server');
    console.log(`   HTTP:      http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   В сети:    http://<YOUR-LAN-IP>:${PORT}`);
    console.log('');
  });
}

main();