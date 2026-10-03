import { useEffect, useState, useCallback } from 'react';
import { useI18n } from '@/locale';
import {
  emitGetPrinterSettings,
  emitSavePrinterSettings,
  emitTestPrinter,
  emitBuildTestTicket,
} from '@/lib/socket';
import {
  discoverAllPrinters,
  requestUsbPrinter,
  hasWebUsb,
  findUsbDeviceBySlot,
} from '@/lib/printer-discovery';
import { printBufferViaUsb, base64ToBytes } from '@/lib/usb-printer';
import {
  Printer,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  RefreshCw,
  Usb,
  Wifi,
  X,
  Search,
  Plus,
} from 'lucide-react';
import type {
  PrinterSettings,
  PrinterSlot,
  DiscoveredPrinter,
  PrinterResult,
} from '@/types/database';
import { DEFAULT_PRINTER_SLOT } from '@/types/database';

const DEFAULT_SETTINGS: PrinterSettings = {
  kitchen: { ...DEFAULT_PRINTER_SLOT },
  cashier: { ...DEFAULT_PRINTER_SLOT },
  encoding: 'cp866',
};

export function PrinterSettingsPage() {
  const { t } = useI18n();

  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'kitchen' | 'cashier' | null>(null);
  const [scanning, setScanning] = useState(false);

  const [usbPrinters, setUsbPrinters] = useState<DiscoveredPrinter[]>([]);
  const [networkPrinters, setNetworkPrinters] = useState<DiscoveredPrinter[]>(
    []
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await emitGetPrinterSettings();
      setSettings({
        kitchen: { ...DEFAULT_PRINTER_SLOT, ...s.kitchen },
        cashier: { ...DEFAULT_PRINTER_SLOT, ...s.cashier },
        encoding: s.encoding ?? 'cp866',
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('loadFailedShort'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await discoverAllPrinters();
        if (cancelled) return;
        setUsbPrinters(res.usb);
        setNetworkPrinters(res.network);
        if (res.networkError) setScanError(res.networkError);
        setHasScanned(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await discoverAllPrinters();
      setUsbPrinters(res.usb);
      setNetworkPrinters(res.network);
      if (res.networkError) setScanError(res.networkError);
      setHasScanned(true);
    } finally {
      setScanning(false);
    }
  }, []);

  const addUsbPrinter = async () => {
    const d = await requestUsbPrinter();
    if (d) {
      setUsbPrinters((prev) => {
        if (prev.some((p) => p.id === d.id)) return prev;
        return [...prev, d];
      });
    }
  };

  const assign = (target: 'kitchen' | 'cashier', p: DiscoveredPrinter) => {
    setMsg(null);
    setSettings((prev) => {
      const slot: PrinterSlot = {
        ...DEFAULT_PRINTER_SLOT,
        enabled: true,
        source: p.source,
        name: p.name,
        paper: 'roll',
        width: prev[target].width || 32,
      };

      if (p.source === 'network') {
        slot.ip = p.ip ?? '';
        slot.port = p.port ?? 9100;
      } else if (p.source === 'windows') {
        slot.printer_name = p.printer_name ?? p.name;
      } else {
        slot.usb_vendor_id = p.vendorId ?? null;
        slot.usb_product_id = p.productId ?? null;
        slot.usb_serial = p.serialNumber ?? '';
      }

      return { ...prev, [target]: slot };
    });
  };

  const unassign = (target: 'kitchen' | 'cashier') => {
    setMsg(null);
    setSettings((prev) => ({
      ...prev,
      [target]: { ...DEFAULT_PRINTER_SLOT, width: prev[target].width },
    }));
  };

  const toggleEnabled = (target: 'kitchen' | 'cashier') => {
    setSettings((prev) => ({
      ...prev,
      [target]: { ...prev[target], enabled: !prev[target].enabled },
    }));
  };

  const changePaper = (target: 'kitchen' | 'cashier', paper: 'roll' | 'a4') => {
    setSettings((prev) => ({
      ...prev,
      [target]: { ...prev[target], paper },
    }));
    setMsg(null);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await emitSavePrinterSettings(settings);
      setSettings({
        kitchen: { ...DEFAULT_PRINTER_SLOT, ...saved.kitchen },
        cashier: { ...DEFAULT_PRINTER_SLOT, ...saved.cashier },
        encoding: saved.encoding ?? 'cp866',
      });
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
      const saved = await emitSavePrinterSettings(settings);
      setSettings({
        kitchen: { ...DEFAULT_PRINTER_SLOT, ...saved.kitchen },
        cashier: { ...DEFAULT_PRINTER_SLOT, ...saved.cashier },
        encoding: saved.encoding ?? 'cp866',
      });

      const slot = target === 'kitchen' ? saved.kitchen : saved.cashier;

      if (!slot.enabled) {
        setMsg({ kind: 'err', text: t('printerDisabled') });
        return;
      }

      if (slot.source === 'usb') {
        if (!hasWebUsb()) {
          setMsg({ kind: 'err', text: t('webUsbNotSupported') });
          return;
        }
        console.log('[print-test] USB start', target, slot);
        const device = await findUsbDeviceBySlot(slot);
        if (!device) {
          setMsg({ kind: 'err', text: t('usbPrinterNotFound') });
          return;
        }
        const buildRes = await emitBuildTestTicket(target);
        if (!buildRes.ok || !buildRes.buffer) {
          setMsg({
            kind: 'err',
            text: buildRes.error || t('failedToBuildTest'),
          });
          return;
        }
        try {
          await printBufferViaUsb(device, base64ToBytes(buildRes.buffer));
          setMsg({ kind: 'ok', text: t('printerTestSuccess') });
        } catch (e) {
          setMsg({
            kind: 'err',
            text: e instanceof Error ? e.message : t('printerTestFailed'),
          });
        }
        return;
      }

      const res: PrinterResult = await emitTestPrinter(target, saved);
      if (res.success || res.skipped) {
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

  const allFound: DiscoveredPrinter[] = [...usbPrinters, ...networkPrinters];

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
          <Lightbulb className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 leading-snug">
            {t('printerHint')}
          </p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 p-3 rounded-xl border-2 bg-red-50 border-red-300 text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium flex-1">
              {t('printerLoadFailed')}: {loadError}
            </span>
            <button
              onClick={loadSettings}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-500 disabled:opacity-50 active:scale-[0.97]"
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {t('retry')}
            </button>
          </div>
        )}

        {loading && !loadError && (
          <div className="flex items-center gap-2 p-3 rounded-xl border bg-slate-50 border-slate-200 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">{t('loading')}</span>
          </div>
        )}

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
            <button
              onClick={() => setMsg(null)}
              className="ml-auto opacity-60 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="text-xs font-black text-gray-500 uppercase tracking-wider mb-3">
            {t('assignedPrinters')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AssignedSlot
              label={t('kitchenPrinter')}
              slot={settings.kitchen}
              accent="yellow"
              onToggle={() => toggleEnabled('kitchen')}
              onUnassign={() => unassign('kitchen')}
              onTest={() => test('kitchen')}
              onChangePaper={(p) => changePaper('kitchen', p)}
              testing={testing === 'kitchen'}
            />
            <AssignedSlot
              label={t('cashierPrinter')}
              slot={settings.cashier}
              accent="cyan"
              onToggle={() => toggleEnabled('cashier')}
              onUnassign={() => unassign('cashier')}
              onTest={() => test('cashier')}
              onChangePaper={(p) => changePaper('cashier', p)}
              testing={testing === 'cashier'}
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-wider flex-1">
              {t('foundPrinters')}
              {allFound.length > 0 && (
                <span className="ml-2 text-orange-600">
                  ({allFound.length})
                </span>
              )}
            </h3>

            <button
              onClick={addUsbPrinter}
              disabled={!hasWebUsb()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900 text-white text-[11px] font-bold hover:bg-gray-800 disabled:opacity-40 active:scale-[0.97] transition-all"
              title={
                hasWebUsb()
                  ? t('addUsbPrinter')
                  : t('webUsbNotSupportedBrowser')
              }
            >
              <Usb className="w-3.5 h-3.5" />
              {t('addUsbPrinter')}
            </button>

            <button
              onClick={scan}
              disabled={scanning}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-500 text-white text-[11px] font-bold hover:bg-orange-600 disabled:opacity-40 active:scale-[0.97] transition-all"
            >
              {scanning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              {scanning ? t('scanning') : t('scanNetwork')}
            </button>
          </div>

          {scanError && (
            <div className="mb-3 p-2 bg-yellow-50 border border-yellow-300 rounded-lg text-yellow-800 text-[11px]">
              {scanError}
            </div>
          )}

          {allFound.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              {scanning
                ? t('scanning')
                : hasScanned
                ? t('noPrintersFound')
                : t('clickScanHint')}
            </p>
          )}

          <div className="space-y-2">
            {allFound.map((p, idx) => (
              <PrinterRow
                key={`${p.id}-${idx}`}
                printer={p}
                onAssignKitchen={() => assign('kitchen', p)}
                onAssignCashier={() => assign('cashier', p)}
              />
            ))}
          </div>
        </div>

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

function AssignedSlot({
  label,
  slot,
  accent,
  onToggle,
  onUnassign,
  onTest,
  onChangePaper,
  testing,
}: {
  label: string;
  slot: PrinterSlot;
  accent: 'yellow' | 'cyan';
  onToggle: () => void;
  onUnassign: () => void;
  onTest: () => void;
  onChangePaper: (p: 'roll' | 'a4') => void;
  testing: boolean;
}) {
  const { t } = useI18n();
  const gradient =
    accent === 'yellow'
      ? 'from-yellow-400 to-amber-500'
      : 'from-cyan-400 to-blue-500';

  const isEmpty =
    !slot.name && !slot.ip && slot.usb_vendor_id == null && !slot.printer_name;

  const isA4 = slot.paper === 'a4';

  return (
    <div className="rounded-xl border-2 border-gray-200 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div
          className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow`}
        >
          <Printer className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            {label}
          </div>
          <div className="text-sm font-black text-gray-900 truncate">
            {isEmpty ? t('notAssigned') : slot.name || slot.ip || 'USB'}
          </div>
        </div>
        {!isEmpty && (
          <button
            type="button"
            onClick={onToggle}
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
              slot.enabled ? 'bg-orange-500' : 'bg-gray-300'
            }`}
            title={slot.enabled ? t('printerEnabled') : t('printerDisabled')}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow ${
                slot.enabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        )}
      </div>

      {!isEmpty && (
        <>
          <div className="text-[10px] text-gray-500 font-mono break-all leading-snug">
            {slot.source === 'windows' ? (
              <>Windows · {slot.printer_name}</>
            ) : slot.source === 'usb' ? (
              <>
                USB · VID:
                {slot.usb_vendor_id?.toString(16).padStart(4, '0')} · PID:
                {slot.usb_product_id?.toString(16).padStart(4, '0')}
                {slot.usb_serial && ` · ${slot.usb_serial.slice(0, 12)}`}
              </>
            ) : (
              <>
                {slot.ip}:{slot.port} · {slot.width} симв.
              </>
            )}
          </div>

          {slot.source !== 'usb' && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                {t('printerPaper')}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangePaper('roll')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-[0.97] ${
                    !isA4
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('printerPaperRoll')}
                </button>
                <button
                  type="button"
                  onClick={() => onChangePaper('a4')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-[0.97] ${
                    isA4
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t('printerPaperA4')}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onTest}
              disabled={!slot.enabled || testing}
              className="flex-1 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 active:scale-[0.97]"
            >
              {testing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Printer className="w-3 h-3" />
              )}
              {t('printerTest')}
            </button>
            <button
              type="button"
              onClick={onUnassign}
              className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-bold active:scale-[0.97]"
              title={t('unassignPrinter')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PrinterRow({
  printer,
  onAssignKitchen,
  onAssignCashier,
}: {
  printer: DiscoveredPrinter;
  onAssignKitchen: () => void;
  onAssignCashier: () => void;
}) {
  const { t } = useI18n();
  const isUsb = printer.source === 'usb';
  const isWindows = printer.source === 'windows';

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-orange-300 bg-white transition-colors">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          isUsb
            ? 'bg-gray-900 text-white'
            : isWindows
            ? 'bg-green-600 text-white'
            : 'bg-blue-100 text-blue-700'
        }`}
      >
        {isUsb ? (
          <Usb className="w-5 h-5" />
        ) : isWindows ? (
          <Printer className="w-5 h-5" />
        ) : (
          <Wifi className="w-5 h-5" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-gray-900 truncate">
          {printer.name}
        </div>
        <div className="text-[10px] text-gray-500 font-mono truncate">
          {isWindows ? (
            <>
              Windows · {printer.printer_name}
              {printer.driver && ` · ${printer.driver}`}
            </>
          ) : isUsb ? (
            <>
              USB · VID:
              {printer.vendorId?.toString(16).padStart(4, '0')} · PID:
              {printer.productId?.toString(16).padStart(4, '0')}
              {printer.serialNumber &&
                ` · ${printer.serialNumber.slice(0, 16)}`}
            </>
          ) : (
            <>
              {printer.ip}:{printer.port}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 shrink-0">
        <button
          onClick={onAssignKitchen}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-yellow-100 hover:bg-yellow-200 text-yellow-800 text-[11px] font-bold active:scale-[0.97] transition-colors"
          title={t('assignToKitchen')}
        >
          <Plus className="w-3 h-3" />
          {t('toKitchen')}
        </button>
        <button
          onClick={onAssignCashier}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-100 hover:bg-cyan-200 text-cyan-800 text-[11px] font-bold active:scale-[0.97] transition-colors"
          title={t('assignToCashier')}
        >
          <Plus className="w-3 h-3" />
          {t('toCashier')}
        </button>
      </div>
    </div>
  );
}