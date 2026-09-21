// src/lib/deviceInfo.ts
import { supabase } from '@/lib/supabase';

const SERVER_URL = 'http://127.0.0.1:9999';
const STORAGE_KEY_MY_IP = 'device_my_ip';
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

// ═══════════════════════════════════════════════════════════════════════════
// МОЙ IP — через локальный Python-сервер
// ═══════════════════════════════════════════════════════════════════════════
let cachedIp: string | null = null;

export async function getMyIp(force = false): Promise<string | null> {
  if (!force && cachedIp) return cachedIp;

  // Проверяем память сессии
  const stored = localStorage.getItem(STORAGE_KEY_MY_IP);
  if (!force && stored) {
    cachedIp = stored;
    return stored;
  }

  try {
    const res = await fetch(`${SERVER_URL}/network-info`);
    if (!res.ok) return null;
    const data = (await res.json()) as NetworkInfo;
    const ip = data.primary_ip;
    if (ip) {
      cachedIp = ip;
      localStorage.setItem(STORAGE_KEY_MY_IP, ip);
    }
    return ip;
  } catch (e) {
    console.warn('[deviceInfo] getMyIp failed:', e);
    return null;
  }
}

export function getCachedIp(): string | null {
  return cachedIp || localStorage.getItem(STORAGE_KEY_MY_IP);
}

// ═══════════════════════════════════════════════════════════════════════════
// СОХРАНЁННЫЕ IP УСТРОЙСТВ В SUPABASE (restaurant_settings)
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

  // Не найдено — считаем неизвестным
  saveMyRole('unknown');
  return {
    role: 'unknown',
    myIp,
    hubIp: ips.cashier_ip, // fallback — пробуем подключиться к кассе
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