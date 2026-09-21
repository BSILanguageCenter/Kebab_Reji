import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';
import type { PrinterSetting, RestaurantSetting } from '@/lib/types';
import { Save, Printer, Plus, Trash2 } from 'lucide-react';

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [printers, setPrinters] = useState<PrinterSetting[]>([]);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    supabase.from('restaurant_settings').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        (data as RestaurantSetting[]).forEach((s) => {
          if (s.value) map[s.key] = s.value;
        });
        setSettings(map);
      }
    });
    supabase.from('printer_settings').select('*').then(({ data }) => setPrinters(data || []));
  }, []);

  const save = async () => {
    const entries = [
      { key: 'restaurant_name_ru', value: settings.restaurant_name_ru || '' },
      { key: 'restaurant_name_ja', value: settings.restaurant_name_ja || '' },
      { key: 'prep_warning_minutes', value: settings.prep_warning_minutes || '15' },
      { key: 'currency', value: 'JPY' },
    ];

    for (const e of entries) {
      await supabase
        .from('restaurant_settings')
        .upsert({ key: e.key, value: e.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }

    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  };

  const addPrinter = async () => {
    await supabase.from('printer_settings').insert({
      name: 'New Printer',
      type: 'mock',
      is_active: true,
      settings: {},
    });
    supabase.from('printer_settings').select('*').then(({ data }) => setPrinters(data || []));
  };

  const deletePrinter = async (id: string) => {
    await supabase.from('printer_settings').delete().eq('id', id);
    setPrinters((prev) => prev.filter((p) => p.id !== id));
  };

  const togglePrinter = async (printer: PrinterSetting) => {
    await supabase.from('printer_settings').update({ is_active: !printer.is_active }).eq('id', printer.id);
    setPrinters((prev) => prev.map((p) => (p.id === printer.id ? { ...p, is_active: !p.is_active } : p)));
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">{t('settings.title')}</h2>

      {/* Language */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-bold text-gray-900">{t('settings.language')}</h3>
        <div className="flex gap-2">
          {(['ru', 'ja'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-xl px-6 py-3 text-sm font-semibold ${
                lang === l ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {l === 'ru' ? 'Русский' : '日本語'}
            </button>
          ))}
        </div>
      </div>

      {/* General */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-bold text-gray-900">{t('settings.general')}</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('settings.restaurantNameRu')}</label>
            <input
              type="text"
              value={settings.restaurant_name_ru || ''}
              onChange={(e) => setSettings({ ...settings, restaurant_name_ru: e.target.value })}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('settings.restaurantNameJa')}</label>
            <input
              type="text"
              value={settings.restaurant_name_ja || ''}
              onChange={(e) => setSettings({ ...settings, restaurant_name_ja: e.target.value })}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('settings.prepWarning')}</label>
            <input
              type="number"
              value={settings.prep_warning_minutes || '15'}
              onChange={(e) => setSettings({ ...settings, prep_warning_minutes: e.target.value })}
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
        {savedMsg && <p className="mt-2 text-sm text-green-600">{t('settings.saved')}</p>}
      </div>

      {/* Printers */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{t('settings.printer')}</h3>
          <button
            onClick={addPrinter}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-gray-100 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-200"
          >
            <Plus size={18} />
            {t('settings.addPrinter')}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {printers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <Printer size={20} className="text-gray-500" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {p.type === 'mock' ? t('settings.mockType') : p.type}
                </p>
              </div>
              <button
                onClick={() => togglePrinter(p)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {p.is_active ? t('settings.printerActive') : 'OFF'}
              </button>
              <button onClick={() => deletePrinter(p.id)} className="text-gray-400 hover:text-red-500">
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
