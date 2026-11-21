import { useCallback, useEffect, useState } from 'react';
import {
  ListChecks,
  X,
  RefreshCw,
  Copy,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
} from 'lucide-react';
import { useI18n } from '@/locale';
import {
  runDiagnostics,
  type DiagReport,
  type DiagSource,
} from '@/services/diagnostics';

const TEXT = {
  ru: {
    title: 'Диагностика заказов',
    refresh: 'Обновить',
    copy: 'Копировать',
    copied: 'Скопировано',
    loading: 'Проверяю все хранилища…',
    total: 'Всего',
    today: 'Сегодня',
    ok: 'ОК',
    error: 'Ошибка',
    off: 'Выключено',
    compare: 'Сверка за сегодня (относительно этого устройства)',
    same: 'совпадает',
    missing: 'нет в источнике',
    extra: 'лишние (нет локально)',
    offline: 'Нет сети — облачные источники недоступны',
    menu: 'Меню: локально ↔ Supabase',
    local: 'Локально',
    cloud: 'Supabase',
    queue: 'Очередь отправки меню',
    onlyLocal: 'только локально (не дошло до облака)',
    onlyCloud: 'только в облаке (не пришло в приложение)',
    different: 'отличаются',
  },
  en: {
    title: 'Orders diagnostics',
    refresh: 'Refresh',
    copy: 'Copy',
    copied: 'Copied',
    loading: 'Checking all storages…',
    total: 'Total',
    today: 'Today',
    ok: 'OK',
    error: 'Error',
    off: 'Off',
    compare: "Today's comparison (vs this device)",
    same: 'matches',
    missing: 'missing in source',
    extra: 'extra (not local)',
    offline: 'Offline — cloud sources unavailable',
    menu: 'Menu: local ↔ Supabase',
    local: 'Local',
    cloud: 'Supabase',
    queue: 'Menu upload queue',
    onlyLocal: 'local only (not uploaded)',
    onlyCloud: 'cloud only (not received)',
    different: 'different',
  },
} as const;

function StatusBadge({
  s,
  tx,
}: {
  s: DiagSource['status'];
  tx: (typeof TEXT)['ru'] | (typeof TEXT)['en'];
}) {
  if (s === 'ok')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {tx.ok}
      </span>
    );
  if (s === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
        <AlertTriangle className="w-3.5 h-3.5" />
        {tx.error}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
      <MinusCircle className="w-3.5 h-3.5" />
      {tx.off}
    </span>
  );
}

export function DiagnosticsButton() {
  const { lang } = useI18n();
  const tx = lang === 'ru' ? TEXT.ru : TEXT.en;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DiagReport | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setFatal(null);
    try {
      setReport(await runDiagnostics());
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void run();
  }, [open, run]);

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const idList = (ids: string[], labels: Record<string, string>) =>
    ids
      .slice(0, 8)
      .map((id) => labels[id] ?? id.slice(0, 8))
      .join(', ') + (ids.length > 8 ? ` … +${ids.length - 8}` : '');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={tx.title}
        aria-label={tx.title}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 active:scale-95 transition-all"
      >
        <ListChecks className="w-4 h-4 text-slate-700" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h3 className="text-lg font-black text-slate-900">{tx.title}</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void run()}
                  disabled={loading}
                  title={tx.refresh}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  onClick={() => void copy()}
                  disabled={!report}
                  title={copied ? tx.copied : tx.copy}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 disabled:opacity-50"
                >
                  {copied ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {loading && !report && (
                <p className="text-sm text-slate-500">{tx.loading}</p>
              )}
              {fatal && <p className="text-sm text-red-600">{fatal}</p>}
              {report && !report.online && (
                <p className="text-sm font-bold text-red-600">{tx.offline}</p>
              )}

              {report?.sources.map((s) => (
                <div
                  key={s.key}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-slate-900 text-sm">
                      {s.label}
                    </div>
                    <StatusBadge s={s.status} tx={tx} />
                  </div>
                  {s.status !== 'off' && s.status !== 'error' && (
                    <div className="mt-1 flex gap-4 text-sm text-slate-700">
                      <span>
                        {tx.total}: <b>{s.total ?? '—'}</b>
                      </span>
                      <span>
                        {tx.today}: <b>{s.today ?? '—'}</b>
                      </span>
                    </div>
                  )}
                  {s.error && (
                    <p className="mt-1 text-xs text-red-600 break-words">
                      {s.error}
                    </p>
                  )}
                  {s.info.length > 0 && (
                    <dl className="mt-2 space-y-0.5 text-xs">
                      {s.info.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <dt className="text-slate-500">{k}</dt>
                          <dd className="text-slate-800 text-right break-words">
                            {v}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}

              {report && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="font-bold text-slate-900 text-sm">
                    {tx.menu}
                  </div>
                  {report.menu.error ? (
                    <p className="mt-1 text-xs text-red-600 break-words">
                      {report.menu.error}
                    </p>
                  ) : (
                    <div className="mt-1 flex gap-4 text-sm text-slate-700">
                      <span>
                        {tx.local}: <b>{report.menu.local}</b>
                      </span>
                      <span>
                        {tx.cloud}: <b>{report.menu.cloud ?? '—'}</b>
                      </span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between gap-3 text-xs">
                    <span className="text-slate-500">{tx.queue}</span>
                    <span
                      className={
                        report.menu.pendingChanged + report.menu.pendingRemoved >
                        0
                          ? 'font-bold text-amber-700'
                          : 'text-slate-800'
                      }
                    >
                      {report.menu.pendingChanged} / {report.menu.pendingRemoved}
                      {report.menu.flushing ? ' …' : ''}
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs">
                    {report.menu.onlyLocal.length > 0 && (
                      <div className="text-amber-700">
                        {tx.onlyLocal} ({report.menu.onlyLocal.length}):{' '}
                        {report.menu.onlyLocal.slice(0, 8).join(', ')}
                      </div>
                    )}
                    {report.menu.onlyCloud.length > 0 && (
                      <div className="text-red-600">
                        {tx.onlyCloud} ({report.menu.onlyCloud.length}):{' '}
                        {report.menu.onlyCloud.slice(0, 8).join(', ')}
                      </div>
                    )}
                    {report.menu.different.length > 0 && (
                      <div className="text-amber-700">
                        {tx.different} ({report.menu.different.length}):{' '}
                        {report.menu.different.slice(0, 8).join(', ')}
                      </div>
                    )}
                    {!report.menu.error &&
                      report.menu.onlyLocal.length === 0 &&
                      report.menu.onlyCloud.length === 0 &&
                      report.menu.different.length === 0 && (
                        <div className="text-green-600">{tx.same}</div>
                      )}
                  </div>
                </div>
              )}

              {report && report.diffs.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="font-bold text-slate-900 text-sm mb-2">
                    {tx.compare}
                  </div>
                  <div className="space-y-2 text-xs">
                    {report.diffs.map((d) => {
                      const clean =
                        d.missing.length === 0 && d.extra.length === 0;
                      return (
                        <div key={d.key}>
                          <div className="font-semibold text-slate-800">
                            {d.label}:{' '}
                            {clean && (
                              <span className="text-green-600">{tx.same}</span>
                            )}
                          </div>
                          {d.missing.length > 0 && (
                            <div className="text-amber-700">
                              {tx.missing} ({d.missing.length}):{' '}
                              {idList(d.missing, report.labels)}
                            </div>
                          )}
                          {d.extra.length > 0 && (
                            <div className="text-red-600">
                              {tx.extra} ({d.extra.length}):{' '}
                              {idList(d.extra, report.labels)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
