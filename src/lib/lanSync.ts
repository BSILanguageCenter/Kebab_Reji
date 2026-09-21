// src/lib/lanSync.ts
import { getDeviceIps, getMyIp } from '@/lib/deviceInfo';

// ─── Константы ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'lan_sync_hub_ip';
const SYNC_PORT = 9998;

// ─── Состояние ──────────────────────────────────────────────────────────────
let ws: WebSocket | null = null;
let hubIp: string | null = null;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let isConnecting = false;

type MessageHandler = (msg: LanMessage) => void;
const listeners = new Set<MessageHandler>();

export interface LanMessage {
  type: string;
  [key: string]: unknown;
}

export interface LanStatus {
  connected: boolean;
  hubIp: string | null;
}

type StatusListener = (status: LanStatus) => void;
const statusListeners = new Set<StatusListener>();

let currentStatus: LanStatus = { connected: false, hubIp: null };

function notifyStatus() {
  statusListeners.forEach((cb) => cb(currentStatus));
}

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЙ API
// ═══════════════════════════════════════════════════════════════════════════
export function getLanStatus(): LanStatus {
  return currentStatus;
}

export function onLanStatusChange(cb: StatusListener): () => void {
  statusListeners.add(cb);
  cb(currentStatus);
  return () => {
    statusListeners.delete(cb);
  };
}

export function getHubIp(): string | null {
  return hubIp || localStorage.getItem(STORAGE_KEY);
}

export function setHubIp(ip: string): void {
  const clean = ip.trim();
  if (clean) {
    localStorage.setItem(STORAGE_KEY, clean);
    hubIp = clean;
  } else {
    localStorage.removeItem(STORAGE_KEY);
    hubIp = null;
  }
  disconnectLan();
  connectLan();
}

// ═══════════════════════════════════════════════════════════════════════════
// АВТООПРЕДЕЛЕНИЕ IP ХАБА ИЗ SUPABASE
// ═══════════════════════════════════════════════════════════════════════════
export async function autoDetectHub(): Promise<void> {
  try {
    const [myIp, ips] = await Promise.all([getMyIp(), getDeviceIps()]);

    if (!myIp) {
      console.log('[LAN] Не удалось определить мой IP');
      // Пробуем всё равно подключиться к сохранённому hub
      const saved = getHubIp();
      if (saved) {
        console.log(`[LAN] Использую сохранённый hub: ${saved}`);
      }
      return;
    }

    let targetHub: string | null = null;

    // Если я касса — я и есть хаб
    if (ips.cashier_ip && ips.cashier_ip === myIp) {
      console.log(`[LAN] Я касса (${myIp}) — запускаю hub локально`);
      if (getHubIp() !== myIp) {
        setHubIp(myIp);
      }
      return;
    }

    // Если я кухня — подключаюсь к кассе
    if (ips.kitchen_ip && ips.kitchen_ip === myIp && ips.cashier_ip) {
      console.log(
        `[LAN] Я кухня (${myIp}) — подключаюсь к кассе ${ips.cashier_ip}`
      );
      targetHub = ips.cashier_ip;
    } else if (ips.cashier_ip) {
      // Роль не определена, но касса известна — пробуем к ней
      console.log(`[LAN] Роль не определена, пробую кассу ${ips.cashier_ip}`);
      targetHub = ips.cashier_ip;
    }

    if (targetHub && targetHub !== getHubIp()) {
      console.log(`[LAN] Устанавливаю hub IP: ${targetHub}`);
      setHubIp(targetHub);
    } else if (targetHub) {
      // Тот же IP — просто переподключаемся на всякий случай
      connectLan();
    }
  } catch (e) {
    console.warn('[LAN] autoDetectHub failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОДКЛЮЧЕНИЕ / ОТКЛЮЧЕНИЕ
// ═══════════════════════════════════════════════════════════════════════════
export function connectLan(): void {
  if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;

  const ip = getHubIp();
  if (!ip) {
    console.log('[LAN] Hub IP не задан. Синхронизация отключена.');
    return;
  }

  isConnecting = true;
  const url = `ws://${ip}:${SYNC_PORT}/sync`;

  console.log(`[LAN] Подключаюсь к ${url}`);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn('[LAN] WebSocket construct failed:', e);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log(`[LAN] Подключено к ${ip}:${SYNC_PORT}`);
    isConnecting = false;
    currentStatus = { connected: true, hubIp: ip };
    notifyStatus();

    send({
      type: 'hello',
      peer: getPeerId(),
    });

    // Ping каждые 25 секунд, чтобы соединение не засыпало
    pingTimer = window.setInterval(() => {
      send({ type: 'ping' });
    }, 25000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as LanMessage;
      listeners.forEach((cb) => cb(msg));
    } catch (e) {
      console.warn('[LAN] Bad message:', e);
    }
  };

  ws.onerror = (e) => {
    console.warn('[LAN] WebSocket error:', e);
  };

  ws.onclose = () => {
    console.log('[LAN] Соединение закрыто');
    isConnecting = false;
    currentStatus = { connected: false, hubIp: ip };
    notifyStatus();
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    scheduleReconnect();
  };
}

export function disconnectLan(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  currentStatus = { connected: false, hubIp: getHubIp() };
  notifyStatus();
}

export function onLanMessage(cb: MessageHandler): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Отправить сообщение всем устройствам в LAN.
 * Если соединения нет — тихо игнорируем (Supabase Realtime всё равно сработает).
 */
export function sendLanMessage(msg: LanMessage): void {
  send(msg);
}

// ═══════════════════════════════════════════════════════════════════════════
// ВНУТРЕННЕЕ
// ═══════════════════════════════════════════════════════════════════════════
function send(msg: LanMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (e) {
    console.warn('[LAN] send failed:', e);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectLan();
  }, 3000);
}

function getPeerId(): string {
  let id = localStorage.getItem('peer_id');
  if (!id) {
    id = `peer-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('peer_id', id);
  }
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// АВТОЗАПУСК
// ═══════════════════════════════════════════════════════════════════════════
if (typeof window !== 'undefined') {
  setTimeout(async () => {
    // Сначала пробуем определить хаб из Supabase
    await autoDetectHub();
    // Затем подключаемся (если hubIp уже есть)
    connectLan();
  }, 800);
}