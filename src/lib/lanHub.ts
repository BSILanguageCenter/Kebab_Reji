// src/lib/lanHub.ts
const PY_SERVER = 'http://127.0.0.1:9999';

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════
export interface LanAnnounce {
  name: string;
  ip: string;
  port: number;
  has_password: boolean;
  clients: number;
}

export interface MyLanStatus {
  active: boolean;
  name: string;
  ip: string | null;
  port: number;
  has_password: boolean;
  clients: number;
}

export interface JoinedLan {
  name: string;
  ip: string;
  port: number;
  has_password: boolean;
}

export type LanMessage =
  | { type: 'hello'; peer: string; password?: string }
  | { type: 'hello-ok'; peer_id: string; hub: string; clients: number }
  | { type: 'auth-failed' }
  | { type: 'ping' }
  | { type: 'client-count'; count: number }
  | { type: 'data-changed'; event: string }
  | { type: string; [key: string]: unknown };

export interface LanState {
  role: 'hub' | 'client' | 'none';
  connected: boolean;
  hub: LanAnnounce | null;
  clients: number;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════════════════════
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let pollTimer: number | null = null;

const messageListeners = new Set<(msg: LanMessage) => void>();
const stateListeners = new Set<(state: LanState) => void>();

let currentState: LanState = {
  role: 'none',
  connected: false,
  hub: null,
  clients: 0,
  error: null,
};

const STORAGE_KEY_HUB = 'my_lan_hub';         // { name, password, ip }
const STORAGE_KEY_JOINED = 'joined_lan';      // { name, ip, port, has_password }

function notifyState() {
  stateListeners.forEach((cb) => cb(currentState));
}

function setState(patch: Partial<LanState>) {
  currentState = { ...currentState, ...patch };
  notifyState();
}

// ═══════════════════════════════════════════════════════════════════════════
// HUB (моё устройство как точка сбора)
// ═══════════════════════════════════════════════════════════════════════════
export async function createLan(
  name: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${PY_SERVER}/lan/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (!data.success) {
      return { ok: false, error: data.error || 'failed' };
    }
    localStorage.setItem(
      STORAGE_KEY_HUB,
      JSON.stringify({ name, password, ip: data.ip })
    );
    // Хаб не подключается к своему WS — просто хранит состояние
    setState({
      role: 'hub',
      connected: true,
      hub: {
        name,
        ip: data.ip,
        port: 9998,
        has_password: !!password,
        clients: 0,
      },
      clients: 0,
      error: null,
    });
    startHubPolling();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function stopMyLan(): Promise<void> {
  stopHubPolling();
  try {
    await fetch(`${PY_SERVER}/lan/stop`, { method: 'POST' });
  } catch {
    /* ignore */
  }
  localStorage.removeItem(STORAGE_KEY_HUB);
  setState({ role: 'none', connected: false, hub: null, clients: 0 });
}

async function refreshHubStatus() {
  try {
    const res = await fetch(`${PY_SERVER}/lan/status`);
    if (!res.ok) return;
    const data = (await res.json()) as MyLanStatus;
    if (data.active) {
      setState({
        role: 'hub',
        connected: true,
        hub: {
          name: data.name,
          ip: data.ip ?? '',
          port: data.port,
          has_password: data.has_password,
          clients: data.clients,
        },
        clients: data.clients,
      });
    }
  } catch {
    /* ignore */
  }
}

function startHubPolling() {
  stopHubPolling();
  pollTimer = window.setInterval(refreshHubStatus, 3000);
}
function stopHubPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════
export async function discoverLans(): Promise<LanAnnounce[]> {
  const res = await fetch(`${PY_SERVER}/lan/discover`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    success: boolean;
    lans?: LanAnnounce[];
    error?: string;
  };
  if (!data.success) throw new Error(data.error || 'discover failed');
  return data.lans ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT (я подключаюсь к чужому хабу)
// ═══════════════════════════════════════════════════════════════════════════
export function getJoinedLan(): JoinedLan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_JOINED);
    if (!raw) return null;
    return JSON.parse(raw) as JoinedLan;
  } catch {
    return null;
  }
}

export function joinLan(lan: LanAnnounce, password: string): void {
  const joined: JoinedLan = {
    name: lan.name,
    ip: lan.ip,
    port: lan.port,
    has_password: lan.has_password,
  };
  localStorage.setItem(STORAGE_KEY_JOINED, JSON.stringify(joined));
  localStorage.setItem('joined_lan_password', password);
  disconnectLan();
  connectToLan();
}

export function leaveLan(): void {
  localStorage.removeItem(STORAGE_KEY_JOINED);
  localStorage.removeItem('joined_lan_password');
  disconnectLan();
  setState({ role: 'none', connected: false, hub: null, clients: 0 });
}

export function connectToLan(): void {
  const joined = getJoinedLan();
  if (!joined) {
    setState({ role: 'none', connected: false, hub: null });
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) return;

  const url = `ws://${joined.ip}:${joined.port}/sync`;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    const password = localStorage.getItem('joined_lan_password') || '';
    ws?.send(
      JSON.stringify({
        type: 'hello',
        peer: getPeerId(),
        password,
      })
    );
  };

  ws.onmessage = (event) => {
    let msg: LanMessage;
    try {
      msg = JSON.parse(event.data) as LanMessage;
    } catch {
      return;
    }

    if (msg.type === 'auth-failed') {
      setState({
        role: 'client',
        connected: false,
        error: 'Неверный пароль',
      });
      leaveLan();
      return;
    }

    if (msg.type === 'hello-ok') {
      const hubMsg = msg as Extract<LanMessage, { type: 'hello-ok' }>;
      setState({
        role: 'client',
        connected: true,
        hub: {
          name: joined.name,
          ip: joined.ip,
          port: joined.port,
          has_password: joined.has_password,
          clients: hubMsg.clients,
        },
        clients: hubMsg.clients,
        error: null,
      });
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        sendLanMessage({ type: 'ping' });
      }, 25000);
    }

    if (msg.type === 'client-count') {
      const countMsg = msg as Extract<LanMessage, { type: 'client-count' }>;
      setState({ clients: countMsg.count });
    }

    messageListeners.forEach((cb) => cb(msg));
  };

  ws.onclose = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (currentState.role === 'client') {
      setState({ connected: false });
      scheduleReconnect();
    }
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
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectToLan();
  }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// ПУБЛИЧНЫЙ API
// ═══════════════════════════════════════════════════════════════════════════
export function getLanStatus(): LanState {
  return currentState;
}

export function onLanStatusChange(cb: (s: LanState) => void): () => void {
  stateListeners.add(cb);
  cb(currentState);
  return () => {
    stateListeners.delete(cb);
  };
}

export function onLanMessage(cb: (msg: LanMessage) => void): () => void {
  messageListeners.add(cb);
  return () => {
    messageListeners.delete(cb);
  };
}

export function sendLanMessage(msg: LanMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════
export function initLan(): void {
  // Проверяем: если я был хабом — восстановить polling
  const hubRaw = localStorage.getItem(STORAGE_KEY_HUB);
  if (hubRaw) {
    startHubPolling();
    refreshHubStatus();
  }
  // Если я был клиентом — переподключиться
  const joined = getJoinedLan();
  if (joined) {
    connectToLan();
  }
}

function getPeerId(): string {
  let id = localStorage.getItem('peer_id');
  if (!id) {
    id = 'peer-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('peer_id', id);
  }
  return id;
}