// src/pages/SettingsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { RestaurantSetting } from '@/lib/types';
import {
  Save,
  Palette,
  Printer,
  RefreshCw,
  Check,
  Loader2,
  ChefHat,
  Receipt as ReceiptIcon,
  Trash2,
  Database,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import {
  getAvailablePrinters,
  getPrinterInfo,
  setActivePrinter,
  setActiveWifiPrinter,
  discoverWifiPrinters,
  type PrinterRole,
  type PrinterInfo,
  type WifiPrinter,
} from '@/lib/LocalPrinterService';
import { getCacheInfo, refreshMenu } from '@/lib/menuCache';
import {
  getOrdersCacheInfo,
  invalidateOrdersCache,
} from '@/lib/ordersCache';

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState(false);

  // ─── Принтеры (системные) ───────────────────────────────────────────────
  const [printers, setPrinters] = useState<string[]>([]);
  const [kitchenPrinter, setKitchenPrinter] = useState<string | null>(null);
  const [receiptPrinter, setReceiptPrinter] = useState<string | null>(null);
  const [kitchenInfo, setKitchenInfo] = useState<PrinterInfo | null>(null);
  const [receiptInfo, setReceiptInfo] = useState<PrinterInfo | null>(null);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [savingRole, setSavingRole] = useState<PrinterRole | null>(null);
  const [savedRole, setSavedRole] = useState<PrinterRole | null>(null);

  // ─── Wi-Fi принтеры ─────────────────────────────────────────────────────
  const [wifiPrinters, setWifiPrinters] = useState<WifiPrinter[]>([]);
  const [searchingWifi, setSearchingWifi] = useState(false);
  const [wifiSearched, setWifiSearched] = useState(false);

  // ─── Кэш ────────────────────────────────────────────────────────────────
  const [menuCacheInfo, setMenuCacheInfo] = useState(() => getCacheInfo());
  const [ordersCacheInfo, setOrdersCacheInfo] = useState(() =>
    getOrdersCacheInfo()
  );
  const [refreshingMenu, setRefreshingMenu] = useState(false);

  useEffect(() => {
    supabase
      .from('restaurant_settings')
      .select('*')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          (data as RestaurantSetting[]).forEach((s) => {
            if (s.value) map[s.key] = s.value;
          });
          setSettings(map);
        }
      });

    loadPrinters();

    // Восстанавливаем типы принтеров из БД
    restorePrinterInfo();
  }, []);

  // ─── Принтеры: системные ────────────────────────────────────────────────
  const loadPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const data = await getAvailablePrinters();
      setPrinters(data.all);
      setKitchenPrinter(data.kitchen);
      setReceiptPrinter(data.receipt);
    } catch (e) {
      console.warn('[Settings] printers load failed:', e);
      setPrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  };

  const restorePrinterInfo = async () => {
    const roles: PrinterRole[] = ['kitchen', 'receipt'];
    for (const role of roles) {
      const { data } = await supabase
        .from('restaurant_settings')
        .select('key, value')
        .in('key', [
          `printer_${role}`,
          `printer_${role}_type`,
          `printer_${role}_kind`,
          `printer_${role}_columns`,
          `printer_${role}_ip`,
          `printer_${role}_port`,
          `printer_${role}_paper_size`,
        ]);
      if (!data) continue;
      const map: Record<string, string> = {};
      (data as { key: string; value: string | null }[]).forEach((r) => {
        if (r.value) map[r.key] = r.value;
      });
      const name = map[`printer_${role}`];
      if (!name) continue;
      const info: PrinterInfo = {
        name,
        type: (map[`printer_${role}_type`] as 'system' | 'wifi') || 'system',
        kind: (map[`printer_${role}_kind`] as 'thermal' | 'a4') || 'thermal',
        columns: parseInt(map[`printer_${role}_columns`] || '42', 10),
        paper_size: map[`printer_${role}_paper_size`] || '',
        ip: map[`printer_${role}_ip`],
        port: map[`printer_${role}_port`]
          ? parseInt(map[`printer_${role}_port`], 10)
          : undefined,
      };
      if (role === 'kitchen') {
        setKitchenPrinter(name);
        setKitchenInfo(info);
      } else {
        setReceiptPrinter(name);
        setReceiptInfo(info);
      }
    }
  };

  const handlePrinterChange = async (role: PrinterRole, name: string) => {
    if (!name) return;
    setSavingRole(role);
    try {
      const result = await setActivePrinter(role, name);
      if (result.ok) {
        const info = result.info ?? (await getPrinterInfo(name));
        if (role === 'kitchen') {
          setKitchenPrinter(name);
          if (info) setKitchenInfo(info);
        } else {
          setReceiptPrinter(name);
          if (info) setReceiptInfo(info);
        }
        setSavedRole(role);
        setTimeout(() => setSavedRole(null), 2000);
      } else {
        alert('Не удалось сохранить. Проверь Python-сервер.');
      }
    } finally {
      setSavingRole(null);
    }
  };

  const handleWifiPrinterSelect = async (
    role: PrinterRole,
    printer: WifiPrinter
  ) => {
    setSavingRole(role);
    try {
      const result = await setActiveWifiPrinter(role, printer);
      if (result.ok && result.info) {
        if (role === 'kitchen') {
          setKitchenPrinter(result.info.name);
          setKitchenInfo(result.info);
        } else {
          setReceiptPrinter(result.info.name);
          setReceiptInfo(result.info);
        }
        setSavedRole(role);
        setTimeout(() => setSavedRole(null), 2000);
      } else {
        alert('Не удалось сохранить Wi-Fi принтер');
      }
    } finally {
      setSavingRole(null);
    }
  };

  // ─── Wi-Fi поиск ────────────────────────────────────────────────────────
  const handleDiscoverWifi = async () => {
    setSearchingWifi(true);
    setWifiSearched(true);
    try {
      const list = await discoverWifiPrinters();
      setWifiPrinters(list);
      if (list.length === 0) {
        alert(
          'Wi-Fi принтеры не найдены.\n' +
            'Проверь, что принтер в одной сети и включён.'
        );
      }
    } catch (e) {
      alert('Ошибка поиска: ' + (e as Error).message);
    } finally {
      setSearchingWifi(false);
    }
  };

  // ─── Общие настройки ────────────────────────────────────────────────────
  const save = async () => {
    const entries = [
      { key: 'restaurant_name_ru', value: settings.restaurant_name_ru || '' },
      { key: 'restaurant_name_ja', value: settings.restaurant_name_ja || '' },
      {
        key: 'prep_warning_minutes',
        value: settings.prep_warning_minutes || '15',
      },
      { key: 'currency', value: 'JPY' },
    ];

    for (const e of entries) {
      await supabase
        .from('restaurant_settings')
        .upsert(
          { key: e.key, value: e.value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
    }

    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  };

  // ─── Кэш ────────────────────────────────────────────────────────────────
  const handleRefreshMenu = async () => {
    setRefreshingMenu(true);
    try {
      await refreshMenu();
      setMenuCacheInfo(getCacheInfo());
    } catch (e) {
      alert('Не удалось обновить меню: ' + (e as Error).message);
    } finally {
      setRefreshingMenu(false);
    }
  };

  const handleClearOrdersCache = () => {
    if (!confirm('Очистить кэш заказов?')) return;
    invalidateOrdersCache();
    setOrdersCacheInfo(getOrdersCacheInfo());
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">
        {t('settings.title')}
      </h2>

      {/* ═══ Вид чека ════════════════════════════════════════════════ */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">Вид чека</h3>
            <p className="mt-1 text-sm text-gray-500">
              Настроить, что и в каком порядке печатается на кухонном чеке и
              чеке оплаты
            </p>
          </div>
          <button
            onClick={() => navigate('/settings/tickets')}
            className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700"
          >
            <Palette size={16} />
            Настроить
          </button>
        </div>
      </div>

      {/* ═══ Язык ═══════════════════════════════════════════════════ */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-bold text-gray-900">
          {t('settings.language')}
        </h3>
        <div className="flex gap-2">
          {(['ru', 'ja'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-xl px-6 py-3 text-sm font-semibold ${
                lang === l
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {l === 'ru' ? 'Русский' : '日本語'}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ Общие ══════════════════════════════════════════════════ */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-bold text-gray-900">
          {t('settings.general')}
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">
              {t('settings.restaurantNameRu')}
            </label>
            <input
              type="text"
              value={settings.restaurant_name_ru || ''}
              onChange={(e) =>
                setSettings({ ...settings, restaurant_name_ru: e.target.value })
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">
              {t('settings.restaurantNameJa')}
            </label>
            <input
              type="text"
              value={settings.restaurant_name_ja || ''}
              onChange={(e) =>
                setSettings({ ...settings, restaurant_name_ja: e.target.value })
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">
              {t('settings.prepWarning')}
            </label>
            <input
              type="number"
              value={settings.prep_warning_minutes || '15'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  prep_warning_minutes: e.target.value,
                })
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </div>
        </div>
        <button
          onClick={save}
          className="mt-4 flex h-12 items-center gap-2 rounded-xl bg-orange-600 px-6 font-bold text-white hover:bg-orange-700"
        >
          <Save size={20} />
          {t('settings.save')}
        </button>
        {savedMsg && (
          <p className="mt-2 text-sm text-green-600">{t('settings.saved')}</p>
        )}
      </div>

      {/* ═══ Принтеры ═══════════════════════════════════════════════ */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-gray-900">Принтеры</h3>
            <p className="mt-1 text-sm text-gray-500">
              Системные (USB) или Wi-Fi принтеры в сети
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadPrinters}
              disabled={loadingPrinters}
              title="Обновить системные"
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              {loadingPrinters ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Системные
            </button>
            <button
              onClick={handleDiscoverWifi}
              disabled={searchingWifi}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {searchingWifi ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Wifi size={16} />
              )}
              {searchingWifi ? 'Поиск…' : 'Найти Wi-Fi'}
            </button>
          </div>
        </div>

        {/* Системные принтеры */}
        {printers.length === 0 && !loadingPrinters ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Системные принтеры не найдены. Проверь Python-сервер или ищи
            Wi-Fi принтеры кнопкой выше.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PrinterSelector
              icon={ChefHat}
              label="Принтер для кухни"
              description="На нём печатаются тикеты при отправке заказа"
              value={kitchenPrinter}
              info={kitchenInfo}
              options={printers}
              saving={savingRole === 'kitchen'}
              saved={savedRole === 'kitchen'}
              onChange={(name) => handlePrinterChange('kitchen', name)}
            />
            <PrinterSelector
              icon={ReceiptIcon}
              label="Принтер для чеков"
              description="На нём печатается чек клиенту при оплате"
              value={receiptPrinter}
              info={receiptInfo}
              options={printers}
              saving={savingRole === 'receipt'}
              saved={savedRole === 'receipt'}
              onChange={(name) => handlePrinterChange('receipt', name)}
            />
          </div>
        )}

        {/* Wi-Fi принтеры */}
        {wifiSearched && (
          <div className="mt-4 rounded-2xl border-2 border-blue-100 bg-blue-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Wifi size={18} className="text-blue-600" />
              <p className="text-sm font-bold text-blue-900">
                Найдено в Wi-Fi: {wifiPrinters.length}
              </p>
            </div>

            {wifiPrinters.length === 0 ? (
              <p className="text-sm text-blue-700">
                Ничего не найдено. Убедись, что принтер включён и в той же
                сети.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {wifiPrinters.map((p) => (
                  <div
                    key={`${p.ip}:${p.port}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-gray-900">
                        {p.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {p.ip}:{p.port} ·{' '}
                        {p.source === 'mdns' ? 'Bonjour' : 'сканирование'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => handleWifiPrinterSelect('kitchen', p)}
                        disabled={savingRole === 'kitchen'}
                        className="rounded-lg bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                      >
                        → Кухня
                      </button>
                      <button
                        onClick={() => handleWifiPrinterSelect('receipt', p)}
                        disabled={savingRole === 'receipt'}
                        className="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-200 disabled:opacity-50"
                      >
                        → Чеки
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Текущий Wi-Fi принтер, если выбран */}
        {(kitchenInfo?.type === 'wifi' || receiptInfo?.type === 'wifi') && (
          <div className="mt-4 rounded-xl bg-purple-50 p-3 text-sm text-purple-800">
            <p className="font-bold">Сейчас активны Wi-Fi принтеры:</p>
            {kitchenInfo?.type === 'wifi' && (
              <p className="mt-1">
                🍳 Кухня: <b>{kitchenInfo.name}</b> ({kitchenInfo.ip}:
                {kitchenInfo.port})
              </p>
            )}
            {receiptInfo?.type === 'wifi' && (
              <p className="mt-0.5">
                🧾 Чеки: <b>{receiptInfo.name}</b> ({receiptInfo.ip}:
                {receiptInfo.port})
              </p>
            )}
          </div>
        )}
      </div>

      {/* ═══ Хранилище ══════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
            <Database size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900">
              Хранилище данных
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Меню и последние заказы кэшируются локально для быстрой
              работы и оффлайн-режима
            </p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <CacheInfoCard
            title="Меню (блюда, категории, столы)"
            age={menuCacheInfo.age}
            count={undefined}
            color="orange"
          />
          <CacheInfoCard
            title="Последние заказы"
            age={ordersCacheInfo.age}
            count={ordersCacheInfo.count}
            color="blue"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleRefreshMenu}
            disabled={refreshingMenu}
            className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {refreshingMenu ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {refreshingMenu ? 'Обновление…' : 'Обновить меню'}
          </button>

          <button
            onClick={handleClearOrdersCache}
            className="flex items-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
          >
            <Trash2 size={16} />
            Очистить кэш заказов
          </button>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          Меню кэшируется на 24 часа, заказы — на 5 минут. При отсутствии
          интернета показываются последние сохранённые данные.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОДКОМПОНЕНТ — выбор системного принтера
// ═══════════════════════════════════════════════════════════════════════════
function PrinterSelector({
  icon: Icon,
  label,
  description,
  value,
  info,
  options,
  saving,
  saved,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  value: string | null;
  info?: PrinterInfo | null;
  options: string[];
  saving: boolean;
  saved: boolean;
  onChange: (name: string) => void;
}) {
  const isWifi = info?.type === 'wifi';

  const kindBadge = info
    ? isWifi
      ? {
          text: `Wi-Fi · ${info.ip}:${info.port}`,
          cls: 'bg-blue-100 text-blue-700',
        }
      : info.kind === 'a4'
      ? { text: 'A4 · офисный', cls: 'bg-blue-100 text-blue-700' }
      : {
          text: `${info.paper_size || 'Термо'} · ${info.columns} кол.`,
          cls: 'bg-orange-100 text-orange-700',
        }
    : null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
          <Icon size={20} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">{label}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
        {saved && (
          <div className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
            <Check size={12} />
            ОК
          </div>
        )}
      </div>

      <div className="relative">
        <select
          value={isWifi ? '' : value || ''}
          disabled={saving || options.length === 0}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border-2 border-gray-200 bg-white px-3 py-3 pr-10 text-sm font-medium text-gray-900 transition-all hover:border-orange-300 focus:border-orange-500 focus:outline-none disabled:opacity-60"
        >
          <option value="">
            {isWifi ? '— выбран Wi-Fi принтер ниже —' : '— не выбран —'}
          </option>
          {options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {saving ? (
            <Loader2 size={16} className="animate-spin text-orange-500" />
          ) : isWifi ? (
            <Wifi size={16} className="text-blue-600" />
          ) : value ? (
            <Check size={16} className="text-green-600" />
          ) : (
            <Printer size={16} className="text-gray-400" />
          )}
        </div>
      </div>

      {kindBadge && (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${kindBadge.cls}`}
          >
            {kindBadge.text}
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ПОДКОМПОНЕНТ — карточка кэша
// ═══════════════════════════════════════════════════════════════════════════
function CacheInfoCard({
  title,
  age,
  count,
  color,
}: {
  title: string;
  age: string;
  count: number | undefined;
  color: 'orange' | 'blue';
}) {
  const colors = {
    orange: {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      dot: 'bg-orange-400',
    },
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      dot: 'bg-blue-400',
    },
  }[color];

  return (
    <div className={`rounded-xl ${colors.bg} p-3`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
        <p className={`text-xs font-semibold ${colors.text}`}>{title}</p>
      </div>
      <p className="text-sm font-bold text-gray-900">Обновлено: {age}</p>
      {count !== undefined && (
        <p className="text-xs text-gray-500">
          {count > 0 ? `${count} заказов в кэше` : 'Пусто'}
        </p>
      )}
    </div>
  );
}