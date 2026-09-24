import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_ID_PATH = path.join(__dirname, 'host.id');

const RANGE_SIZE = 500;
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 минут

let supabaseRef = null;
let storeRef = null;

let hostUuid = null;
let hostNumber = 1;
let rangeStart = 100;
let rangeEnd = 599;
let nextOrderNumber = 100;

// ============================================================
// Persistent UUID — сохраняется в файле host.id
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
  await recalculateRange();

  console.log(
    `[host] Хост #${hostNumber}, диапазон: ${rangeStart}–${rangeEnd}, следующий заказ: ${nextOrderNumber}`
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
// Пересчёт позиции и диапазона
// ============================================================
async function recalculateRange() {
  // Все хосты, отсортированные по first_seen_at
  const { data: hosts, error } = await supabaseRef
    .from('pos_hosts')
    .select('*')
    .order('first_seen_at', { ascending: true });

  if (error || !hosts) {
    console.error('[host] Не удалось получить список хостов:', error?.message);
    return;
  }

  // Ищем свою позицию
  const myIndex = hosts.findIndex((h) => h.host_uuid === hostUuid);
  if (myIndex === -1) {
    console.warn('[host] Себя не нашёл в списке — повторная регистрация');
    await registerHost();
    return;
  }

  const newHostNumber = myIndex + 1;
  const newRangeStart = 100 + (newHostNumber - 1) * RANGE_SIZE;
  const newRangeEnd = newRangeStart + RANGE_SIZE - 1;

  // Обновляем локальные переменные
  const numberChanged = hostNumber !== newHostNumber;
  hostNumber = newHostNumber;
  rangeStart = newRangeStart;
  rangeEnd = newRangeEnd;

  // Обновляем в Supabase, если номер поменялся
  if (numberChanged || hosts[myIndex].host_number !== newHostNumber) {
    await supabaseRef
      .from('pos_hosts')
      .update({
        host_number: newHostNumber,
        last_seen_at: new Date().toISOString(),
      })
      .eq('host_uuid', hostUuid);
  } else {
    // Просто обновляем heartbeat
    await supabaseRef
      .from('pos_hosts')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('host_uuid', hostUuid);
  }

  // Определяем следующий номер: MAX(order_number) + 1 из Supabase
  const { data: maxRow } = await supabaseRef
    .from('orders')
    .select('order_number')
    .order('order_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const globalMax = maxRow?.order_number ?? 99;

  // Если глобальный max меньше нашего диапазона → начинаем с rangeStart
  // Иначе продолжаем с globalMax + 1
  nextOrderNumber = Math.max(globalMax + 1, rangeStart);

  // Передаём в store
  if (storeRef && typeof storeRef.setNextOrderNumber === 'function') {
    storeRef.setNextOrderNumber(nextOrderNumber);
  }
}

// ============================================================
// Heartbeat раз в 5 минут
// ============================================================
function startHeartbeat() {
  setInterval(async () => {
    try {
      await recalculateRange();
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
    rangeStart,
    rangeEnd,
    nextOrderNumber,
  };
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
  await recalculateRange();
}