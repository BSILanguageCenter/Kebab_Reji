// src/lib/lanHub.ts
import { supabase } from '@/lib/supabase';

const SETTINGS_TABLE = 'restaurant_settings';
const KEY_PREFIX = 'lan_hub_';
const HEARTBEAT_MS = 10_000;
const STALE_MS = 30_000;
const WS_PORT = 9998;

// ─── Типы сообщений LAN ─────────────────────────────────────────────────────
export type LanMessage =
  | { type: 'hello'; peer: string }
  | { type: 'ping' }
  | { type: 'data-changed'; event: string }
  | { type: 'sync-request' }
  | { type: string; [key: string]: unknown };

export interface LanHub {
  id: string;
  name: string;
  hubIp: string;
  port: number;
  createdAt: number;
  lastHeartbeat: number;
  isOwn: boolean;
}

export interface LanStatus {
  connected: boolean;
  hub: LanHub | null;
}

// ─── Состояние ──────────────────────────────────────────────────────────────
let myHubId: string | null = null;
let myHubIp: string | null = null;
let heartbeatTimer: number | null = null;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

const messageListeners = new Set<(msg: LanMessage) => void>();
const statusListeners = new Set<(s: LanStatus) => void>();
let currentStatus: LanStatus = { connected: false, hub: null };

function notifyStatus() {
  statusListeners.forEach((cb) => cb(currentStatus));
}

// ─── Мой LAN ────────────────────────────────────────────────────────────────
export function getMyHubId(): string | null {
  if (myHubId === null) myHubId = localStorage.getItem('my_lan_hub_id');
  return myHubId;
}

export function isHubOwner(): boolean {
  return !!getMyHubId();
}

async function fetchMyIpFromPython(): Promise<string | null> {
  try {
    const host = window.location.hostname;
    const base =
      host === 'localhost' || host === '127.0.0.1'
        ? 'http://127.0.0.1:9999'
        : `http://${host}:9999`;
    const res = await fetch(`${base}/network-info`);
    if (!res.ok) return null;
    const data = (await res.json()) as { primary_ip?: string };
    return data.primary_ip ?? null;
  } catch {
    return null;
  }
}

export async function createLan(
  name: string
): Promise<{ ok: boolean; hub?: LanHub; error?: string }> {
  const ip = await fetchMyIpFromPython();
  if (!ip) {
    return {
      ok: false,
      error:
        'Python-сервер не отвечает. LAN создаётся только на устройстве, где запущен Python.',
    };
  }

  const id = 'lan_' + Math.random().toString(36).slice(2, 10);
  const hub: LanHub = {
    id,
    name,
    hubIp: ip,
    port: WS_PORT,
    createdAt: Date.now(),
    lastHeartbeat: Date.now(),
    isOwn: true,
  };

  const { error } = await supabase.from(SETTINGS_TABLE).upsert(
    {
      key: KEY_PREFIX + id,
      value: JSON.stringify(hub),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  if (error) return { ok: false, error: error.message };

  myHubId = id;
  myHubIp = ip;
  localStorage.setItem('my_lan_hub_id', id);
  localStorage.setItem('my_lan_hub_ip', ip);
  localStorage.setItem('my_lan_name', name);
  startHeartbeat();

  return { ok: true, hub };
}

export async function deleteMyLan(): Promise<void> {
  const id = getMyHubId();
  if (!id) return;
  stopHeartbeat();
  await supabase.from(SETTINGS_TABLE).delete().eq('key', KEY_PREFIX + id);
  myHubId = null;
  myHubIp = null;
  localStorage.removeItem('my_lan_hub_id');
  localStorage.removeItem('my_lan_hub_ip');
  localStorage.removeItem('my_lan_name');
  localStorage.removeItem('joined_lan_hub');
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(async () => {
    const id = getMyHubId();
    const ip = myHubIp || localStorage.getItem('my_lan_hub_ip');
    if (!id || !ip) return;
    const hub: LanHub = {
      id,
      name: localStorage.getItem('my_lan_name') || 'LAN',
      hubIp: ip,
      port: WS_PORT,
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
      isOwn: true,
    };
    await supabase.from(SETTINGS_TABLE).upsert(
      {
        key: KEY_PREFIX + id,
        value: JSON.stringify(hub),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Список активных LAN ────────────────────────────────────────────────────
export async function listActiveLans(): Promise<LanHub[]> {
  const { data } = await supabase
    .from(SETTINGS_TABLE)
    .select('key, value')
    .like('key', KEY_PREFIX + '%');

  if (!data) return [];

  const now = Date.now();
  const myId = getMyHubId();
  const hubs: LanHub[] = [];

  for (const row of data as { key: string; value: string | null }[]) {
    if (!row.value) continue;
    try {
      const hub = JSON.parse(row.value) as LanHub;
      if (now - hub.lastHeartbeat < STALE_MS) {
        hubs.push({ ...hub, isOwn: hub.id === myId });
      }
    } catch {
      /* skip */
    }
  }

  return hubs.sort((a, b) => b.lastHeartbeat - a.lastHeartbeat);
}

// ─── Подключение к LAN ──────────────────────────────────────────────────────
export function joinLan(hub: LanHub): void {
  localStorage.setItem('joined_lan_hub', JSON.stringify(hub));
  disconnectLan();
  connectToLan();
}

export function getJoinedLan(): LanHub | null {
  try {
    const raw = localStorage.getItem('joined_lan_hub');
    if (!raw) return null;
    return JSON.parse(raw) as LanHub;
  } catch {
    return null;
  }
}

export function leaveLan(): void {
  localStorage.removeItem('joined_lan_hub');
  disconnectLan();
}

// ─── WebSocket ──────────────────────────────────────────────────────────────
export function getLanStatus(): LanStatus {
  return currentStatus;
}

export function onLanStatusChange(cb: (s: LanStatus) => void): () => void {
  statusListeners.add(cb);
  cb(currentStatus);
  return () => {
    statusListeners.delete(cb);
  };
}

// было: export function onLanMessage(cb: (msg: any) => void): () => void {
export function onLanMessage(cb: (msg: LanMessage) => void): () => void {
  messageListeners.add(cb);
  return () => {
    messageListeners.delete(cb);
  };
}

// было: export function sendLanMessage(msg: any): void {
export function sendLanMessage(msg: LanMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

export function connectToLan(): void {
  const hub = getJoinedLan();
  if (!hub) {
    currentStatus = { connected: false, hub: null };
    notifyStatus();
    return;
  }

  // Если это наш собственный хаб — не открываем WebSocket к себе
  if (hub.isOwn) {
    currentStatus = { connected: true, hub };
    notifyStatus();
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) return;

  const url = `ws://${hub.hubIp}:${hub.port}/sync`;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    currentStatus = { connected: true, hub };
    notifyStatus();
    ws?.send(JSON.stringify({ type: 'hello', peer: getPeerId() }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      messageListeners.forEach((cb) => cb(msg));
    } catch {
      /* ignore */
    }
  };

  ws.onclose = () => {
    currentStatus = { connected: false, hub };
    notifyStatus();
    scheduleReconnect();
  };

  ws.onerror = () => {
    /* onclose сработает следом */
  };
}

export function disconnectLan(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  currentStatus = { connected: false, hub: getJoinedLan() };
  notifyStatus();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectToLan();
  }, 3000);
}

function getPeerId(): string {
  let id = localStorage.getItem('peer_id');
  if (!id) {
    id = 'peer-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('peer_id', id);
  }
  return id;
}

// ─── Инициализация при старте ───────────────────────────────────────────────
export function initLan(): void {
  if (getMyHubId()) {
    myHubIp = localStorage.getItem('my_lan_hub_ip');
    startHeartbeat();
  }
  connectToLan();
}