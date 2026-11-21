// src/services/layoutSync.ts
// Облачная синхронизация АКТИВНОГО стиля (оба режима групп).
// Менеджер/админ меняет стиль в «Управлении меню» → стиль уходит в Supabase;
// касса (и любое другое устройство / профиль) подхватывает его при входе,
// при возвращении на вкладку и раз в минуту.
import { supabase } from '@/lib/supabase';
import {
  applyExternalLayout,
  getStoredLayout,
  onLocalLayoutChange,
  type LayoutSettings,
} from '@/lib/layoutSettings';
import {
  getViewPrefs,
  setViewPrefs,
  subscribeViewPrefs,
  type GroupView,
} from '@/lib/viewPrefs';

const TABLE = 'app_settings';
const KEY = 'layout_active';
const SYNCED_AT_KEY = 'kebab-pos-layout-synced-at';
const PULL_EVERY_MS = 60_000;
const PUSH_DEBOUNCE_MS = 1000;

interface ActivePayload {
  layout?: LayoutSettings;
  layoutSingle?: LayoutSettings;
  /**
   * Режим групп («все блюда» / «одна иконка»). От него зависит, какой
   * порядок карточек (sort_order или sort_order_single) показывает касса —
   * раньше режим был свой на каждом устройстве, и касса показывала
   * расстановку другого режима.
   */
  groupView?: GroupView;
  savedAt?: number;
}

function getSyncedAt(): number {
  try {
    const v = Number(localStorage.getItem(SYNCED_AT_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function setSyncedAt(v: number) {
  try {
    localStorage.setItem(SYNCED_AT_KEY, String(v));
  } catch {
    /* ignore */
  }
}

async function fetchRemote(): Promise<ActivePayload | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('key', KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.data as ActivePayload | undefined) ?? null;
}

async function pushNow(savedAt: number): Promise<void> {
  const payload: ActivePayload = {
    layout: getStoredLayout('all'),
    layoutSingle: getStoredLayout('single'),
    groupView: getViewPrefs().groupView,
    savedAt,
  };
  const { error } = await supabase.from(TABLE).upsert(
    {
      key: KEY,
      data: payload,
      updated_at: new Date(savedAt).toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

/**
 * Запускает синхронизацию. canPush = true для admin / manager:
 * только они «задают» стиль, остальные его наследуют.
 * Возвращает функцию остановки.
 */
/**
 * Вид и расположение продуктов теперь у КАЖДОГО устройства свои и живут только
 * в его localStorage (размеры, панели, режим групп, число колонок).
 * Облачная синхронизация стиля отключена; чтобы вернуть общий стиль,
 * поставьте false.
 */
const DEVICE_LOCAL_LAYOUT = true;

export function startLayoutSync(canPush: boolean): () => void {
  if (DEVICE_LOCAL_LAYOUT) return () => {};
  let stopped = false;
  let pushTimer: number | null = null;

  const pull = async () => {
    try {
      const remote = await fetchRemote();
      if (stopped) return;
      const localAt = getSyncedAt();

      if (!remote || !remote.layout) {
        // в облаке ещё ничего нет — первый запуск: менеджер публикует свой стиль
        if (canPush) {
          const at = Date.now();
          setSyncedAt(at);
          await pushNow(at);
        }
        return;
      }

      const remoteAt = remote.savedAt ?? 0;
      if (remoteAt > localAt) {
        applyExternalLayout(remote.layout, 'all');
        if (remote.layoutSingle) applyExternalLayout(remote.layoutSingle, 'single');
        if (remote.groupView === 'all' || remote.groupView === 'single') {
          setViewPrefs({ groupView: remote.groupView });
        }
        setSyncedAt(remoteAt);
      } else if (canPush && localAt > remoteAt) {
        // локальный стиль новее (прошлая отправка не удалась) — досылаем
        await pushNow(localAt);
      }
    } catch (e) {
      console.warn('[layoutSync] pull failed:', e);
    }
  };

  const schedulePush = () => {
    if (!canPush) return;
    const at = Date.now();
    setSyncedAt(at);
    if (pushTimer != null) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushTimer = null;
      pushNow(getSyncedAt()).catch((e) =>
        console.warn('[layoutSync] push failed (повторим позже):', e)
      );
    }, PUSH_DEBOUNCE_MS);
  };

  const unsubLocal = onLocalLayoutChange(() => schedulePush());
  // Менеджер переключил режим групп — публикуем и его
  let lastGroupView = getViewPrefs().groupView;
  const unsubView = subscribeViewPrefs(() => {
    const gv = getViewPrefs().groupView;
    if (gv === lastGroupView) return;
    lastGroupView = gv;
    schedulePush();
  });
  const onVisible = () => {
    if (document.visibilityState === 'visible') void pull();
  };
  document.addEventListener('visibilitychange', onVisible);
  const interval = window.setInterval(() => void pull(), PULL_EVERY_MS);
  void pull();

  return () => {
    stopped = true;
    unsubLocal();
    unsubView();
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(interval);
    if (pushTimer != null) window.clearTimeout(pushTimer);
  };
}
