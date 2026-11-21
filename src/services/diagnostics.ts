// src/services/diagnostics.ts
/**
 * Сверка заказов по всем хранилищам: локально (localStorage), Supabase,
 * Google Sheets, Firebase RTDB. Плюс очереди и состояние realtime.
 * Всё пишется в консоль ([diag]) и возвращается для показа в окне.
 */
import type { MenuItem, Order } from '@/types/database';
import {
  getAllOrders,
  getMenu,
  getMenuSyncState,
  todayStr,
} from '@/lib/localStore';
import { fetchAllProductsFromDb } from './supabaseDb';
import { supabase as supabaseClient } from '@/lib/supabase';
import { getQueueSnapshot } from './syncQueue';
import { getPendingDeletions } from './deletedOrders';
import {
  countOrdersInDb,
  fetchOrdersRange,
  getRealtimeInfo,
  pendingOrdersCount,
} from './supabaseOrders';
import { fetchFirebaseDiag } from './firebaseSync';
import { fetchSheetsDiag, isSheetsEnabled } from './googleSheetsSync';

export type SourceKey = 'local' | 'supabase' | 'sheets' | 'firebase';

export interface DiagSource {
  key: SourceKey;
  label: string;
  status: 'ok' | 'error' | 'off';
  error?: string;
  total: number | null;
  today: number | null;
  info: Array<[string, string]>;
  todayIds: string[];
}

export interface DiagDiff {
  key: SourceKey;
  label: string;
  /** есть локально, нет в источнике */
  missing: string[];
  /** есть в источнике, нет локально */
  extra: string[];
}

export interface DiagMenu {
  local: number;
  cloud: number | null;
  error?: string;
  flushing: boolean;
  pendingChanged: number;
  pendingRemoved: number;
  /** есть локально, нет в Supabase */
  onlyLocal: string[];
  /** есть в Supabase, нет локально */
  onlyCloud: string[];
  /** есть и там, и там, но содержимое разное */
  different: string[];
}

export interface DiagReport {
  menu: DiagMenu;
  at: string;
  day: string;
  online: boolean;
  sources: DiagSource[];
  diffs: DiagDiff[];
  labels: Record<string, string>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ago(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return `${Math.round(s / 3600)} ч назад`;
}

export async function runDiagnostics(): Promise<DiagReport> {
  const now = new Date();
  const day = todayStr(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const isToday = (o: Order) => todayStr(new Date(o.created_at)) === day;
  const labels: Record<string, string> = {};
  const remember = (list: Order[]) => {
    for (const o of list) {
      if (!labels[o.id]) {
        labels[o.id] = `№${o.order_number ?? '?'} · ${o.id.slice(0, 8)}`;
      }
    }
  };

  // ---------- локально ----------
  const localAll = getAllOrders();
  const localToday = localAll.filter(isToday);
  remember(localAll);
  const q = getQueueSnapshot();
  const local: DiagSource = {
    key: 'local',
    label: 'Локально (это устройство)',
    status: 'ok',
    total: localAll.length,
    today: localToday.length,
    todayIds: localToday.map((o) => o.id),
    info: [
      [
        'Очередь Google Sheets',
        `ожид. ${q.pending} · отпр. ${q.syncing} · ошибок ${q.failed} · готово ${q.synced}`,
      ],
      ['Очередь → Supabase (outbox)', String(pendingOrdersCount())],
      ['Ждут удаления из облака', String(getPendingDeletions().length)],
    ],
  };

  // ---------- облака параллельно ----------
  const [sbR, shR, fbR, mnR] = await Promise.allSettled([
    withTimeout(
      Promise.all([
        countOrdersInDb(),
        fetchOrdersRange(start.toISOString(), end.toISOString()),
      ]),
      25_000
    ),
    isSheetsEnabled()
      ? withTimeout(fetchSheetsDiag(start.toISOString()), 30_000)
      : Promise.resolve(null),
    withTimeout(fetchFirebaseDiag(500), 20_000),
    withTimeout(fetchAllProductsFromDb(), 20_000),
  ]);

  // Supabase
  const { data: sessData } = await supabaseClient.auth.getSession();
  const rt = getRealtimeInfo();
  const supabase: DiagSource = {
    key: 'supabase',
    label: 'Supabase (основная БД)',
    status: 'ok',
    total: null,
    today: null,
    todayIds: [],
    info: [
      [
        'Сессия Supabase',
        sessData.session
          ? `${sessData.session.user.email} (authenticated)`
          : 'anon (не вошли)',
      ],
      ['Realtime', rt.status],
      ['События realtime', `${rt.events} (последнее: ${ago(rt.lastEventAt)})`],
    ],
  };
  if (sbR.status === 'fulfilled') {
    const [total, todayList] = sbR.value;
    remember(todayList);
    supabase.total = total;
    supabase.today = todayList.length;
    supabase.todayIds = todayList.map((o) => o.id);
  } else {
    supabase.status = 'error';
    supabase.error = errMsg(sbR.reason);
  }

  // Google Sheets
  const sheets: DiagSource = {
    key: 'sheets',
    label: 'Google Sheets (копия)',
    status: 'ok',
    total: null,
    today: null,
    todayIds: [],
    info: [],
  };
  if (shR.status === 'fulfilled') {
    if (shR.value === null) {
      sheets.status = 'off';
      sheets.info.push(['Синхронизация', 'не настроена']);
    } else {
      const v = shR.value;
      const todayList = v.changed.filter(isToday);
      remember(todayList);
      sheets.total = v.totalOrders;
      sheets.today = todayList.length;
      sheets.todayIds = todayList.map((o) => o.id);
      const cur = `${String(now.getMonth() + 1).padStart(2, '0')}.${String(
        now.getFullYear()
      ).slice(-2)}`;
      const m = v.months.find((x) => x.month === cur);
      sheets.info.push(['Версия скрипта', v.version]);
      sheets.info.push([`Строк в листе ${cur}`, String(m?.orders ?? 0)]);
      sheets.info.push([
        'Листов по месяцам',
        v.months.map((x) => `${x.month}: ${x.orders}`).join(' · ') || '—',
      ]);
    }
  } else {
    sheets.status = 'error';
    sheets.error = errMsg(shR.reason);
  }

  // Firebase
  const firebase: DiagSource = {
    key: 'firebase',
    label: 'Firebase Realtime DB',
    status: 'ok',
    total: null,
    today: null,
    todayIds: [],
    info: [],
  };
  if (fbR.status === 'fulfilled') {
    const v = fbR.value;
    const todayList = v.orders.filter(isToday);
    remember(todayList);
    firebase.total = v.orders.length;
    firebase.today = todayList.length;
    firebase.todayIds = todayList.map((o) => o.id);
    if (v.ordersCapped) {
      firebase.info.push(['Внимание', 'прочитано не больше 500 заказов']);
    }
    const by: Record<string, number> = {};
    for (const op of v.queue) by[op.syncStatus] = (by[op.syncStatus] ?? 0) + 1;
    firebase.info.push([
      'sync_queue',
      `${v.queue.length}${v.queueCapped ? '+' : ''}` +
        (v.queue.length
          ? ' (' +
            Object.entries(by)
              .map(([k, n]) => `${k}: ${n}`)
              .join(', ') +
            ')'
          : ''),
    ]);
  } else {
    firebase.status = 'error';
    firebase.error = errMsg(fbR.reason);
  }

  const sources = [local, supabase, sheets, firebase];

  // ---------- меню: локально ↔ Supabase ----------
  const localMenu = getMenu().items;
  const ms = getMenuSyncState();
  const menu: DiagMenu = {
    local: localMenu.length,
    cloud: null,
    flushing: ms.flushing,
    pendingChanged: ms.pendingChanged,
    pendingRemoved: ms.pendingRemoved,
    onlyLocal: [],
    onlyCloud: [],
    different: [],
  };
  if (mnR.status === 'fulfilled') {
    const cloudMenu: MenuItem[] = mnR.value;
    menu.cloud = cloudMenu.length;
    const cm = new Map<string, MenuItem>(cloudMenu.map((i) => [i.id, i]));
    const lm = new Map<string, MenuItem>(
      localMenu.map((i: MenuItem) => [i.id, i])
    );
    for (const [id, it] of lm) {
      const c = cm.get(id);
      if (!c) menu.onlyLocal.push(it.name);
      else if (JSON.stringify(c) !== JSON.stringify(it)) {
        menu.different.push(it.name);
      }
    }
    for (const [id, it] of cm) if (!lm.has(id)) menu.onlyCloud.push(it.name);
  } else {
    menu.error = errMsg(mnR.reason);
  }

  // ---------- сверка «за сегодня» с локальными ----------
  const localSet = new Set(local.todayIds);
  const diffs: DiagDiff[] = [];
  for (const s of [supabase, sheets, firebase]) {
    if (s.status !== 'ok') continue;
    const set = new Set(s.todayIds);
    diffs.push({
      key: s.key,
      label: s.label,
      missing: local.todayIds.filter((id) => !set.has(id)),
      extra: s.todayIds.filter((id) => !localSet.has(id)),
    });
  }

  const report: DiagReport = {
    menu,
    at: now.toISOString(),
    day,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    sources,
    diffs,
    labels,
  };

  // ---------- лог ----------
  console.group(`[diag] ${day} — сверка заказов`);
  console.table(
    sources.map((s) => ({
      источник: s.label,
      статус: s.status,
      всего: s.total,
      сегодня: s.today,
      ошибка: s.error ?? '',
    }))
  );
  for (const s of sources) {
    console.log(`[diag] ${s.label}`, Object.fromEntries(s.info));
  }
  for (const d of diffs) {
    console.log(
      `[diag] ${d.label}: нет в источнике ${d.missing.length}, лишних ${d.extra.length}`,
      {
        missing: d.missing.map((id) => labels[id] ?? id),
        extra: d.extra.map((id) => labels[id] ?? id),
      }
    );
  }
  console.log('[diag] меню', menu);
  console.groupEnd();

  return report;
}
