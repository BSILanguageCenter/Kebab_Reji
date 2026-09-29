import { useEffect, useState } from 'react';
import { useI18n } from '@/locale';
import {
  emitGetPrinterSettings,
  emitSavePrinterSettings,
  emitTestPrinter,
} from '@/lib/socket';
import {
  Printer,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
} from 'lucide-react';
import type { PrinterSettings } from '@/types/database';

const DEFAULT: PrinterSettings = {
  kitchen_enabled: false,
  kitchen_ip: '',
  kitchen_port: 9100,
  kitchen_width: 32,
  cashier_enabled: false,
  cashier_ip: '',
  cashier_port: 9100,
  cashier_width: 32,
  encoding: 'cp866',
};

export function PrinterSettingsPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'kitchen' | 'cashier' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );

  useEffect(() => {
    emitGetPrinterSettings()
      .then((s) => setSettings({ ...DEFAULT, ...s }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await emitSavePrinterSettings(settings);
      setSettings({ ...DEFAULT, ...saved });
      setMsg({ kind: 'ok', text: t('printerSaved') });
    } catch (e) {
      setMsg({
        kind: 'err',
        text: e instanceof Error ? e.message : t('unknownError'),
      });
    } finally {
      setSaving(false);
    }
  };

  const test = async (target: 'kitchen' | 'cashier') => {
    setTesting(target);
    setMsg(null);
    try {
      const res = await emitTestPrinter(target, settings);
      if (res.success) {
        setMsg({ kind: 'ok', text: t('printerTestSuccess') });
      } else {
        setMsg({ kind: 'err', text: res.error ?? t('printerTestFailed') });
      }
    } catch (e) {
      setMsg({
        kind: 'err',
        text: e instanceof Error ? e.message : t('printerTestFailed'),
      });
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Hint */}
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
          <Lightbulb className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 leading-snug">
            {t('printerHint')}
          </p>
        </div>

        {msg && (
          <div
            className={`flex items-center gap-2 p-3 rounded-xl border-2 ${
              msg.kind === 'ok'
                ? 'bg-green-50 border-green-300 text-green-800'
                : 'bg-red-50 border-red-300 text-red-800'
            }`}
          >
            {msg.kind === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="text-sm font-medium">{msg.text}</span>
          </div>
        )}

        {/* Kitchen */}
        <PrinterBlock
          title={t('kitchenPrinter')}
          icon="kitchen"
          enabled={settings.kitchen_enabled}
          onToggle={(v) => setSettings((s) => ({ ...s, kitchen_enabled: v }))}
          ip={settings.kitchen_ip}
          port={settings.kitchen_port}
          width={settings.kitchen_width}
          onIp={(v) => setSettings((s) => ({ ...s, kitchen_ip: v }))}
          onPort={(v) => setSettings((s) => ({ ...s, kitchen_port: v }))}
          onWidth={(v) => setSettings((s) => ({ ...s, kitchen_width: v }))}
          onTest={() => test('kitchen')}
          testing={testing === 'kitchen'}
        />

        {/* Cashier */}
        <PrinterBlock
          title={t('cashierPrinter')}
          icon="cashier"
          enabled={settings.cashier_enabled}
          onToggle={(v) => setSettings((s) => ({ ...s, cashier_enabled: v }))}
          ip={settings.cashier_ip}
          port={settings.cashier_port}
          width={settings.cashier_width}
          onIp={(v) => setSettings((s) => ({ ...s, cashier_ip: v }))}
          onPort={(v) => setSettings((s) => ({ ...s, cashier_port: v }))}
          onWidth={(v) => setSettings((s) => ({ ...s, cashier_width: v }))}
          onTest={() => test('cashier')}
          testing={testing === 'cashier'}
        />

        {/* Encoding + Save */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              {t('printerEncoding')}
            </label>
            <select
              value={settings.encoding}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  encoding: e.target.value as PrinterSettings['encoding'],
                }))
              }
              className="form-input"
            >
              <option value="cp866">CP866 (DOS Cyrillic) — рекоменд.</option>
              <option value="cp1251">CP1251 (Windows Cyrillic)</option>
            </select>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] shadow-md shadow-orange-500/20"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrinterBlock({
  title,
  icon,
  enabled,
  onToggle,
  ip,
  port,
  width,
  onIp,
  onPort,
  onWidth,
  onTest,
  testing,
}: {
  title: string;
  icon: 'kitchen' | 'cashier';
  enabled: boolean;
  onToggle: (v: boolean) => void;
  ip: string;
  port: number;
  width: number;
  onIp: (v: string) => void;
  onPort: (v: number) => void;
  onWidth: (v: number) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const { t } = useI18n();
  const accent =
    icon === 'kitchen'
      ? 'from-yellow-400 to-amber-500'
      : 'from-cyan-400 to-blue-500';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center shadow-md`}
        >
          <Printer className="w-5 h-5 text-white" />
        </div>
        <h3 className="text-base font-black text-gray-900 flex-1">{title}</h3>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            enabled ? 'bg-orange-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${
              enabled ? 'translate-x-6' : ''
            }`}
          />
        </button>
      </div>

      <div className={`grid grid-cols-12 gap-2 ${enabled ? '' : 'opacity-50'}`}>
        <div className="col-span-7">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            {t('printerIp')}
          </label>
          <input
            type="text"
            value={ip}
            disabled={!enabled}
            onChange={(e) => onIp(e.target.value)}
            placeholder="192.168.1.50"
            className="form-input font-mono"
          />
        </div>
        <div className="col-span-5">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            {t('printerPort')}
          </label>
          <input
            type="number"
            value={port}
            disabled={!enabled}
            onChange={(e) => onPort(Number(e.target.value) || 9100)}
            className="form-input"
          />
        </div>

        <div className="col-span-7">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            {t('printerWidth')}
          </label>
          <select
            value={width}
            disabled={!enabled}
            onChange={(e) => onWidth(Number(e.target.value) || 32)}
            className="form-input"
          >
            <option value={32}>58 мм (32 симв.)</option>
            <option value={42}>80 мм (42 симв.)</option>
            <option value={48}>80 мм (48 симв.)</option>
          </select>
        </div>

        <div className="col-span-5 flex items-end">
          <button
            type="button"
            onClick={onTest}
            disabled={!enabled || testing}
            className="w-full py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98]"
          >
            {testing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Printer className="w-3.5 h-3.5" />
            )}
            {t('printerTest')}
          </button>
        </div>
      </div>
    </div>
  );
}