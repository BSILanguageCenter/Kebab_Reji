import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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

// ============================================================
// Загрузка .env из КОРНЯ проекта (на уровень выше server/)
// ============================================================
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

console.log('[env] Читаю .env из:', envPath);
console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? 'OK' : '❌ НЕТ');
console.log(
  '  SUPABASE_KEY:',
  process.env.SUPABASE_KEY
    ? 'OK (' + process.env.SUPABASE_KEY.length + ' симв.)'
    : '❌ НЕТ'
);
console.log('  PORT:', process.env.PORT ?? '3001 (по умолчанию)');

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
    clients: io.engine.clientsCount,
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

// ============================================================
// ЕДИНЫЙ BROADCAST — один listener на весь io
// ============================================================
store.on('orders-changed', () => {
  io.emit('orders', store.getAllOrders());
});

store.on('menu-changed', () => {
  io.emit('menu', store.getMenu());
});

// ============================================================
// СЧЁТЧИК ПОДКЛЮЧЁННЫХ КЛИЕНТОВ
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

  // Отправляем снимок при подключении
  socket.emit('init', {
    orders: store.getAllOrders(),
    menu: store.getMenu(),
  });

  // Отправляем всем актуальный счётчик клиентов
  broadcastClientsCount();

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
    // Обновляем счётчик у остальных после того, как Socket.IO обновит свой счётчик
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