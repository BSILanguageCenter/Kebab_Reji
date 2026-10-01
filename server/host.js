import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// host.id хранится в server/data/host.id
// Папка data/ создаётся в db.js, который импортируется ДО host.js
// ============================================================
const HOST_ID_PATH = path.join(__dirname, 'data', 'host.id');

const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 минут

let supabaseRef = null;
let storeRef = null;

let hostUuid = null;
let hostNumber = 1;
let nextOrderNumber = 1;

// ============================================================
// Persistent UUID — сохраняется в файле server/data/host.id
// ============================================================
function loadOrCreateUuid() {
  try {
    if (fs.existsSync(HOST_ID_PATH)) {
      const stored = fs.readFileSync(HOST_ID_PATH, 'utf-8').trim();
      if (stored.length > 0) return stored;
    }
  } catch {
    // ignore
  }
  const newUuid = randomUUID();
  try {
    fs.writeFileSync(HOST_ID_PATH, newUuid, 'utf-8');
  } catch (e) {
    console.error('[host] Не удалось сохранить host.id:', e.message);
  }
  return newUuid;
}

// ============================================================
// Инициализация
// ============================================================
export async function initHost(supabase, store) {
  supabaseRef = supabase;
  storeRef = store;

  hostUuid = loadOrCreateUuid();
  console.log('[host] UUID:', hostUuid);

  await registerHost();
  await recalculateNextOrderNumber();

  console.log(
    `[host] Хост #${hostNumber}, следующий заказ: ${nextOrderNumber}`
  );

  startHeartbeat();
}

// ============================================================
// Регистрация в Supabase
// ============================================================
async function registerHost() {
  const hostName = os.hostname();

  const { error } = await supabaseRef
    .from('pos_hosts')
    .upsert(
      {
        host_uuid: hostUuid,
        host_name: hostName,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'host_uuid' }
    );

  if (error) {
    console.error('[host] Ошибка регистрации:', error.message);
    throw error;
  }
  console.log('[host] Зарегистрирован в Supabase как', hostName);
}

// ============================================================
// Пересчёт номера хоста и nextOrderNumber
//
// Новая логика: у каждого хоста СВОЙ независимый счётчик.
// nextOrderNumber = MAX(order_number этого хоста) + 1
// Диапазоны больше не используются.
// ============================================================
async function recalculateNextOrderNumber() {
  // Получаем список всех хостов для определения порядкового номера
  const { data: hosts, error } = await supabaseRef
    .from('pos_hosts')
    .select('*')
    .order('first_seen_at', { ascending: true });

  if (error || !hosts) {
    console.error('[host] Не удалось получить список хостов:', error?.message);
    // Всё равно пересчитываем локальный nextOrderNumber
    recalculateLocalNext();
    return;
  }

  const myIndex = hosts.findIndex((h) => h.host_uuid === hostUuid);
  if (myIndex === -1) {
    console.warn('[host] Себя не нашёл в списке — повторная регистрация');
    await registerHost();
    recalculateLocalNext();
    return;
  }

  const newHostNumber = myIndex + 1;
  const numberChanged = hostNumber !== newHostNumber;
  hostNumber = newHostNumber;

  // Обновляем номер хоста в Supabase (heartbeat + number)
  await supabaseRef
    .from('pos_hosts')
    .update({
      host_number: newHostNumber,
      last_seen_at: new Date().toISOString(),
    })
    .eq('host_uuid', hostUuid);

  if (numberChanged) {
    console.log(`[host] Мой номер изменился: #${newHostNumber}`);
  }

  recalculateLocalNext();
}

// ============================================================
// Локальный пересчёт nextOrderNumber
//
// MAX(order_number) среди МОИХ заказов (host_uuid = текущий).
// Если у меня ещё нет заказов — начинаем со 100.
// ============================================================
function recalculateLocalNext() {
  if (!storeRef) return;

  const localMax =
    typeof storeRef.getMaxOrderNumber === 'function'
      ? storeRef.getMaxOrderNumber(hostUuid)
      : 0;

  nextOrderNumber = localMax > 0 ? localMax + 1 : 100;

  if (typeof storeRef.setNextOrderNumber === 'function') {
    storeRef.setNextOrderNumber(nextOrderNumber);
  }
}

// ============================================================
// Heartbeat раз в 5 минут
// ============================================================
function startHeartbeat() {
  setInterval(async () => {
    try {
      await recalculateNextOrderNumber();
      console.log(
        `[host] Heartbeat OK: host #${hostNumber}, следующий заказ: ${nextOrderNumber}`
      );
    } catch (e) {
      console.error('[host] Heartbeat error:', e.message);
    }
  }, HEARTBEAT_INTERVAL);

  console.log(
    `[host] Heartbeat каждые ${HEARTBEAT_INTERVAL / 1000} сек запущен`
  );
}

// ============================================================
// Геттеры
// ============================================================
export function getHostInfo() {
  return {
    hostUuid,
    hostNumber,
    // Поля rangeStart/rangeEnd оставлены для обратной совместимости
    // с /health endpoint. Больше не используются для нумерации.
    rangeStart: 0,
    rangeEnd: 0,
    nextOrderNumber,
  };
}

export function getHostUuid() {
  return hostUuid;
}

export function getNextOrderNumber() {
  const current = nextOrderNumber;
  nextOrderNumber++;
  if (storeRef && typeof storeRef.setNextOrderNumber === 'function') {
    storeRef.setNextOrderNumber(nextOrderNumber);
  }
  return current;
}

/** Вызывается когда локальный заказ отправлен — увеличивает nextOrderNumber если нужно */
export function bumpNextOrderNumber(usedNumber) {
  if (usedNumber >= nextOrderNumber) {
    nextOrderNumber = usedNumber + 1;
    if (storeRef && typeof storeRef.setNextOrderNumber === 'function') {
      storeRef.setNextOrderNumber(nextOrderNumber);
    }
  }
}

/** Принудительный пересчёт (можно вызвать вручную) */
export async function forceRecalculate() {
  await recalculateNextOrderNumber();
}