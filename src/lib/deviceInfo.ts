// src/lib/deviceInfo.ts
import { supabase } from '@/lib/supabase';

// ─── Адреса Python-сервера ──────────────────────────────────────────────────
// Если сайт открыт на компьютере, где запущен Python — 127.0.0.1.
// Если сайт открыт на другом устройстве (телефон) — используем IP того хоста,
// где сайт хостится (там же и Python).
function getPythonServerUrl(): string {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://127.0.0.1:9999';
  }
  return `http://${host}:9999`;
}

// ─── Ключи localStorage ────────────────────────────────────────────────────
const STORAGE_KEY_MY_IP_MANUAL = 'device_my_ip_manual'; // ← IP, заданный вручную
const STORAGE_KEY_MY_IP_AUTO = 'device_my_ip_auto';     // ← IP, полученный от Python
const STORAGE_KEY_MY_ROLE = 'device_my_role';

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════
export interface NetworkInfo {
  hostname: string;
  local_ips: string[];
  primary_ip: string | null;
  ports: { http: number; ws: number };
}

export interface DeviceIps {
  cashier_ip: string | null;
  kitchen_ip: string | null;
}

export type DeviceRole = 'cashier' | 'kitchen' | 'unknown';

export interface SyncStatus {
  ok: boolean;
  connected_clients: number;
  is_hub_active: boolean;
  message: string;
}

export interface MyIpInfo {
  ip: string | null;
  source: 'manual' | 'auto' | 'none';
  autoIp: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// МОЙ IP — приоритет: ручной → автоопределённый → null
// ═══════════════════════════════════════════════════════════════════════════
let cachedAutoIp: string | null = null;
let cachedManualIp: string | null = null;

export function getMyIpInfo(): MyIpInfo {
  // 1. Ручной IP (наивысший приоритет)
  if (cachedManualIp === null) {
    cachedManualIp = localStorage.getItem(STORAGE_KEY_MY_IP_MANUAL);
  }
  if (cachedManualIp) {
    return {
      ip: cachedManualIp,
      source: 'manual',
      autoIp: cachedAutoIp || localStorage.getItem(STORAGE_KEY_MY_IP_AUTO),
    };
  }

  // 2. Автоопределённый
  if (cachedAutoIp === null) {
    cachedAutoIp = localStorage.getItem(STORAGE_KEY_MY_IP_AUTO);
  }
  if (cachedAutoIp) {
    return {
      ip: cachedAutoIp,
      source: 'auto',
      autoIp: cachedAutoIp,
    };
  }

  return { ip: null, source: 'none', autoIp: null };
}

/**
 * Возвращает IP этого устройства.
 * Если задан вручную — возвращает его. Иначе — автоопределённый с Python.
 */
export async function getMyIp(force = false): Promise<string | null> {
  // Ручной всегда приоритетнее
  if (cachedManualIp === null) {
    cachedManualIp = localStorage.getItem(STORAGE_KEY_MY_IP_MANUAL);
  }
  if (cachedManualIp) return cachedManualIp;

  // Иначе — авто
  if (!force && cachedAutoIp) return cachedAutoIp;

  const stored = localStorage.getItem(STORAGE_KEY_MY_IP_AUTO);
  if (!force && stored) {
    cachedAutoIp = stored;
    return stored;
  }

  // Запрашиваем у Python
  try {
    const res = await fetch(`${getPythonServerUrl()}/network-info`);
    if (!res.ok) return null;
    const data = (await res.json()) as NetworkInfo;
    const ip = data.primary_ip;
    if (ip) {
      cachedAutoIp = ip;
      localStorage.setItem(STORAGE_KEY_MY_IP_AUTO, ip);
    }
    return ip;
  } catch (e) {
    console.warn('[deviceInfo] getMyIp failed:', e);
    return null;
  }
}

/**
 * Задать свой IP вручную.
 * Используется, когда автоопределение даёт неверный результат
 * (например, на телефоне Python не запущен, и он видит IP компьютера).
 */
export function setMyIpManually(ip: string | null): void {
  const clean = (ip || '').trim();
  if (clean) {
    localStorage.setItem(STORAGE_KEY_MY_IP_MANUAL, clean);
    cachedManualIp = clean;
  } else {
    localStorage.removeItem(STORAGE_KEY_MY_IP_MANUAL);
    cachedManualIp = null;
  }
}

export function getManualIp(): string | null {
  if (cachedManualIp === null) {
    cachedManualIp = localStorage.getItem(STORAGE_KEY_MY_IP_MANUAL);
  }
  return cachedManualIp;
}

export function getCachedIp(): string | null {
  return getMyIpInfo().ip;
}

// ═══════════════════════════════════════════════════════════════════════════
// СОХРАНЁННЫЕ IP УСТРОЙСТВ В SUPABASE
// ═══════════════════════════════════════════════════════════════════════════
const DB_KEY_CASHIER = 'device_cashier_ip';
const DB_KEY_KITCHEN = 'device_kitchen_ip';

export async function getDeviceIps(): Promise<DeviceIps> {
  try {
    const { data } = await supabase
      .from('restaurant_settings')
      .select('key, value')
      .in('key', [DB_KEY_CASHIER, DB_KEY_KITCHEN]);

    const map: Record<string, string> = {};
    (data ?? []).forEach((row: { key: string; value: string | null }) => {
      if (row.value) map[row.key] = row.value;
    });

    return {
      cashier_ip: map[DB_KEY_CASHIER] || null,
      kitchen_ip: map[DB_KEY_KITCHEN] || null,
    };
  } catch (e) {
    console.warn('[deviceInfo] getDeviceIps failed:', e);
    return { cashier_ip: null, kitchen_ip: null };
  }
}

export async function saveDeviceIps(
  ips: Partial<DeviceIps>
): Promise<boolean> {
  try {
    const updates: { key: string; value: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    if (ips.cashier_ip !== undefined) {
      updates.push({
        key: DB_KEY_CASHIER,
        value: ips.cashier_ip || '',
        updated_at: now,
      });
    }
    if (ips.kitchen_ip !== undefined) {
      updates.push({
        key: DB_KEY_KITCHEN,
        value: ips.kitchen_ip || '',
        updated_at: now,
      });
    }

    if (updates.length === 0) return true;

    const { error } = await supabase
      .from('restaurant_settings')
      .upsert(updates, { onConflict: 'key' });

    return !error;
  } catch (e) {
    console.error('[deviceInfo] saveDeviceIps failed:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ОПРЕДЕЛЕНИЕ РОЛИ ЭТОГО УСТРОЙСТВА
// ═══════════════════════════════════════════════════════════════════════════
export async function detectMyRole(): Promise<{
  role: DeviceRole;
  myIp: string | null;
  hubIp: string | null;
  ips: DeviceIps;
}> {
  const [myIp, ips] = await Promise.all([getMyIp(), getDeviceIps()]);

  if (!myIp) {
    return { role: 'unknown', myIp: null, hubIp: null, ips };
  }

  // Если мой IP = IP кассы → я касса (хаб)
  if (ips.cashier_ip && ips.cashier_ip === myIp) {
    saveMyRole('cashier');
    return { role: 'cashier', myIp, hubIp: myIp, ips };
  }

  // Если мой IP = IP кухни → я кухня (клиент), подключаюсь к кассе
  if (ips.kitchen_ip && ips.kitchen_ip === myIp) {
    saveMyRole('kitchen');
    return { role: 'kitchen', myIp, hubIp: ips.cashier_ip, ips };
  }

  // Не найдено
  saveMyRole('unknown');
  return {
    role: 'unknown',
    myIp,
    hubIp: ips.cashier_ip,
    ips,
  };
}

function saveMyRole(role: DeviceRole) {
  localStorage.setItem(STORAGE_KEY_MY_ROLE, role);
}

export function getCachedRole(): DeviceRole {
  return (
    (localStorage.getItem(STORAGE_KEY_MY_ROLE) as DeviceRole) || 'unknown'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// КОПИРОВАНИЕ IP В БУФЕР
// ═══════════════════════════════════════════════════════════════════════════
export async function copyMyIpToClipboard(): Promise<string | null> {
  const ip = await getMyIp(true);
  if (!ip) return null;

  try {
    await navigator.clipboard.writeText(ip);
    return ip;
  } catch (e) {
    // Fallback для HTTP
    try {
      const ta = document.createElement('textarea');
      ta.value = ip;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return ip;
    } catch {
      console.warn('[deviceInfo] copy failed:', e);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ПРОВЕРКА СВЯЗИ С HUB
// ═══════════════════════════════════════════════════════════════════════════
export async function testHubConnection(
  ip: string,
  port = 9999
): Promise<SyncStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`http://${ip}:${port}/sync-status`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        ok: false,
        connected_clients: 0,
        is_hub_active: false,
        message: `Сервер вернул ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      lan_sync_enabled: boolean;
      connected_clients: number;
      is_hub_active: boolean;
    };

    if (!data.lan_sync_enabled) {
      return {
        ok: false,
        connected_clients: 0,
        is_hub_active: false,
        message:
          'Python-сервер найден, но LAN-синхронизация выключена. Установи flask-sock: pip install flask-sock',
      };
    }

    return {
      ok: true,
      connected_clients: data.connected_clients,
      is_hub_active: data.is_hub_active,
      message:
        data.connected_clients === 0
          ? 'Сервер найден, но клиенты не подключены. Проверь роль и IP.'
          : `Сервер найден. Подключено устройств: ${data.connected_clients}`,
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return {
        ok: false,
        connected_clients: 0,
        is_hub_active: false,
        message: `Сервер ${ip}:${port} не отвечает (таймаут 3 сек)`,
      };
    }
    return {
      ok: false,
      connected_clients: 0,
      is_hub_active: false,
      message: `Не удалось связаться с ${ip}:${port}. Проверь IP и Wi-Fi.`,
    };
  }
}