// src/pages/TicketLayoutPage.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  Save,
  Check,
  Loader2,
  ChevronUp,
  ChevronDown,
  Printer,
  Info,
  Ruler,
  Receipt,
  ChefHat,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BLOCK_META,
  defaultLayoutFor,
  loadTicketLayout,
  saveTicketLayout,
  paperKindFromWidth,
  paperLabel,
  type LayoutKind,
  type TicketBlock,
  type TicketLayout,
  type PaperWidth,
} from '@/lib/ticketLayout';
import { invalidateLayoutCache } from '@/lib/LocalPrinterService';

// ═══════════════════════════════════════════════════════════════════════════
// ДЕМО-ДАННЫЕ
// ═══════════════════════════════════════════════════════════════════════════
const SAMPLE = {
  orderNumber: 128,
  tableName: 'Стол 5',
  takeaway: 'С СОБОЙ',
  time: '14:32',
  items: [
    { qty: 2, name: 'Кебаб с говядиной' },
    { qty: 1, name: 'Салат овощной' },
    { qty: 1, name: 'Чай зелёный' },
  ],
  notes: ['БЕЗ ЛУКА', 'ОСТРЫЙ'],
  total: 2450,
  thanks: 'СПАСИБО!',
};

const MONO =
  'ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace';

// ═══════════════════════════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ═══════════════════════════════════════════════════════════════════════════
function center(s: string, w: number) {
  if (s.length >= w) return s.slice(0, w);
  const pad = Math.floor((w - s.length) / 2);
  return ' '.repeat(pad) + s + ' '.repeat(w - s.length - pad);
}
function right(s: string, w: number) {
  if (s.length >= w) return s.slice(0, w);
  return ' '.repeat(w - s.length) + s;
}
function left(s: string, w: number) {
  return s.length >= w ? s.slice(0, w) : s.padEnd(w, ' ');
}
function formatLine(line: string, align: TicketBlock['align'], w: number): string {
  if (align === 'center') return center(line, w);
  if (align === 'right') return right(line, w);
  return left(line, w);
}

function getBlockLines(id: string, width: number): string[] {
  const s = SAMPLE;
  switch (id) {
    case 'header':      return [`ЗАКАЗ #${s.orderNumber}`];
    case 'table':       return [`СТОЛ: ${s.tableName}`];
    case 'time':        return [`ВРЕМЯ: ${s.time}`];
    case 'separator1':
    case 'separator2':
    case 'separator3':  return ['-'.repeat(width)];
    case 'items':       return s.items.map((i) => `${i.qty} x ${i.name}`);
    case 'notes':       return ['КОММЕНТАРИЙ:', ...s.notes];
    case 'total':       return [`ИТОГО: ¥${s.total.toLocaleString()}`];
    case 'thanks':      return [s.thanks];
    default:            return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// РЕНДЕР ОДНОЙ СТРОКИ
// ═══════════════════════════════════════════════════════════════════════════
function BlockLine({
  text,
  block,
  paperWidth,
  baseFontPx,
}: {
  text: string;
  block: TicketBlock;
  paperWidth: number;
  baseFontPx: number;
}) {
  const multiplier = block.size === 2 ? 2 : 1;
  const maxChars = Math.floor(paperWidth / multiplier);
  const cropped = text.slice(0, maxChars);
  const formatted = formatLine(cropped, block.align, maxChars);

  return (
    <div
      style={{
        width: `${maxChars}ch`,
        fontFamily: MONO,
        fontSize: `${baseFontPx * multiplier}px`,
        fontWeight: block.bold ? 700 : 400,
        whiteSpace: 'pre',
        overflow: 'hidden',
        lineHeight: multiplier === 2 ? 1.15 : 1.4,
        letterSpacing: 0,
        fontVariantLigatures: 'none',
      }}
    >
      {formatted}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНЫЙ КОМПОНЕНТ
// ═══════════════════════════════════════════════════════════════════════════
export default function TicketLayoutPage() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<LayoutKind>('kitchen');
  const [layout, setLayout] = useState<TicketLayout | null>(null);
  const [initialLayout, setInitialLayout] = useState<TicketLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLayout(null);
    setInitialLayout(null);
    loadTicketLayout(kind).then((l) => {
      if (!cancelled) {
        setLayout(l);
        setInitialLayout(JSON.parse(JSON.stringify(l)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const isDirty = useMemo(() => {
    if (!layout || !initialLayout) return false;
    return JSON.stringify(layout) !== JSON.stringify(initialLayout);
  }, [layout, initialLayout]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const updateBlock = (index: number, patch: Partial<TicketBlock>) => {
    if (!layout) return;
    const blocks = layout.blocks.map((b, i) =>
      i === index ? { ...b, ...patch } : b
    );
    setLayout({ ...layout, blocks });
  };

  const moveBlock = (from: number, to: number) => {
    if (!layout) return;
    if (to < 0 || to >= layout.blocks.length) return;
    const blocks = [...layout.blocks];
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    setLayout({ ...layout, blocks });
  };

  const setPaper = (w: PaperWidth) => {
    if (!layout) return;
    setLayout({ ...layout, paperWidth: w, paperKind: paperKindFromWidth(w) });
  };

  const resetToDefault = () => {
    if (isDirty && !confirm('Сбросить раскладку? Изменения не сохранены.')) return;
    setLayout(defaultLayoutFor(kind));
  };

  const handleSave = async () => {
    if (!layout || saving) return;
    setSaving(true);
    try {
      await saveTicketLayout(kind, layout);
      invalidateLayoutCache();
      setInitialLayout(JSON.parse(JSON.stringify(layout)));
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      alert('Не удалось сохранить: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (isDirty && !confirm('Выйти без сохранения?')) return;
    navigate('/settings');
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };
  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null) return;
    if (dragIndex !== index) moveBlock(dragIndex, index);
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-gray-400">
        <Loader2 size={24} className="animate-spin" />
        <span>Загрузка раскладки…</span>
      </div>
    );
  }

  const width = layout.paperWidth;
  // Для A4/A5 шрифт в превью меньше, чтобы влезло
  const baseFontPx = width >= 56 ? 10 : 12;
  const visibleBlocks = layout.blocks.filter((b) => b.enabled);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">
      {/* ═══ Шапка ══════════════════════════════════════════════════ */}
      <div className="shrink-0 border-b border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                Настройка вида чека
              </h1>
              <p className="text-xs text-gray-500">
                Расставь блоки в нужном порядке
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Не сохранено
              </span>
            )}
            {savedAt && (
              <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                <Check size={14} />
                Сохранено
              </span>
            )}
            <button
              onClick={resetToDefault}
              className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
            >
              <RotateCcw size={16} />
              Сбросить
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>

        <div className="flex gap-1 px-6 pb-3">
          <button
            onClick={() => setKind('kitchen')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
              kind === 'kitchen'
                ? 'bg-orange-100 text-orange-700 ring-2 ring-inset ring-orange-500'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <ChefHat size={16} />
            Чек на кухню
          </button>
          <button
            onClick={() => setKind('receipt')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
              kind === 'receipt'
                ? 'bg-orange-100 text-orange-700 ring-2 ring-inset ring-orange-500'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Receipt size={16} />
            Чек на оплату
          </button>
        </div>
      </div>

      {/* ═══ Контент ═════════════════════════════════════════════════ */}
      <div className="flex flex-1 gap-4 overflow-hidden p-6">
        {/* ─── Редактор блоков ──────────────────────────────────── */}
        <div className="flex w-[460px] shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Блоки чека</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Перетащи{' '}
                <GripVertical size={11} className="inline -mt-0.5" /> чтобы
                изменить порядок
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
              {visibleBlocks.length} / {layout.blocks.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex flex-col gap-2">
              {layout.blocks.map((block, index) => {
                const meta = BLOCK_META[block.id] || {
                  label: block.id,
                  desc: '',
                  icon: '▪',
                };
                const isDragging = dragIndex === index;
                const isOver = dragOverIndex === index && dragIndex !== index;

                const multiplier = block.size === 2 ? 2 : 1;
                const miniWidth = Math.floor(width / multiplier);
                const lines = getBlockLines(block.id, miniWidth);

                return (
                  <div
                    key={block.id + '-' + index}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`relative transition-all ${
                      isOver ? 'translate-y-1' : ''
                    }`}
                  >
                    {isOver && (
                      <div className="absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-orange-500" />
                    )}

                    <div
                      className={`rounded-xl border-2 transition-all ${
                        isDragging
                          ? 'border-orange-400 bg-orange-50 opacity-40'
                          : block.enabled
                          ? 'border-gray-200 bg-white hover:border-orange-300 hover:shadow-sm'
                          : 'border-dashed border-gray-200 bg-gray-50 opacity-60'
                      }`}
                    >
                      {/* Заголовок блока */}
                      <div className="flex items-center gap-2 p-3">
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragEnd={handleDragEnd}
                          className="cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical
                            size={18}
                            className="text-gray-300 hover:text-gray-500"
                          />
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-base">
                          {meta.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-gray-900">
                            {meta.label}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {meta.desc}
                          </p>
                        </div>

                        <div className="-my-1 flex flex-col">
                          <button
                            onClick={() => moveBlock(index, index - 1)}
                            disabled={index === 0}
                            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-20 disabled:hover:bg-transparent"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => moveBlock(index, index + 1)}
                            disabled={index === layout.blocks.length - 1}
                            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-20 disabled:hover:bg-transparent"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>

                        <button
                          onClick={() =>
                            updateBlock(index, { enabled: !block.enabled })
                          }
                          className={`rounded-lg p-1.5 transition-colors ${
                            block.enabled
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          }`}
                        >
                          {block.enabled ? (
                            <Eye size={16} />
                          ) : (
                            <EyeOff size={16} />
                          )}
                        </button>
                      </div>

                      {/* Мини-превью содержимого */}
                      {block.enabled && lines.length > 0 && (
                        <div className="overflow-hidden border-t border-gray-100 bg-gray-50/60 px-3 py-2">
                          {lines.slice(0, 2).map((line, i) => {
                            const cropped = line.slice(0, miniWidth);
                            const formatted = formatLine(
                              cropped,
                              block.align,
                              miniWidth
                            );
                            return (
                              <div
                                key={i}
                                style={{
                                  width: `${miniWidth}ch`,
                                  fontFamily: MONO,
                                  fontSize: `${
                                    baseFontPx * multiplier * 0.85
                                  }px`,
                                  fontWeight: block.bold ? 700 : 400,
                                  whiteSpace: 'pre',
                                  overflow: 'hidden',
                                  lineHeight:
                                    multiplier === 2 ? 1.1 : 1.35,
                                  color: '#6b7280',
                                }}
                              >
                                {formatted}
                              </div>
                            );
                          })}
                          {lines.length > 2 && (
                            <div className="text-center text-[10px] text-gray-400">
                              … +{lines.length - 2}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Настройки блока */}
                      {block.enabled && (
                        <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
                          <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
                            {(
                              [
                                {
                                  key: 'left',
                                  icon: AlignLeft,
                                  title: 'По левому краю',
                                },
                                {
                                  key: 'center',
                                  icon: AlignCenter,
                                  title: 'По центру',
                                },
                                {
                                  key: 'right',
                                  icon: AlignRight,
                                  title: 'По правому краю',
                                },
                              ] as const
                            ).map(({ key, icon: Icon, title }) => (
                              <button
                                key={key}
                                onClick={() => updateBlock(index, { align: key })}
                                title={title}
                                className={`rounded-md p-1.5 transition-all ${
                                  block.align === key
                                    ? 'bg-white text-orange-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                <Icon size={14} />
                              </button>
                            ))}
                          </div>

                          <button
                            onClick={() =>
                              updateBlock(index, { bold: !block.bold })
                            }
                            title="Жирный"
                            className={`rounded-lg p-1.5 transition-all ${
                              block.bold
                                ? 'bg-orange-100 text-orange-600'
                                : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            <Bold size={14} />
                          </button>

                          <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
                            {([1, 2] as const).map((s) => (
                              <button
                                key={s}
                                onClick={() => updateBlock(index, { size: s })}
                                title={s === 1 ? 'Обычный' : 'Двойной'}
                                className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition-all ${
                                  block.size === s
                                    ? 'bg-white text-orange-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                {s}x
                              </button>
                            ))}
                          </div>

                          <div className="flex-1" />

                          {block.bold && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                              BOLD
                            </span>
                          )}
                          {block.size === 2 && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                              ×2
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Ширина бумаги ──────────────────────────────────── */}
          <div className="border-t border-gray-100 bg-gray-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Ruler size={14} className="text-gray-500" />
              <label className="text-xs font-semibold text-gray-700">
                Ширина бумаги
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { w: 32 as PaperWidth, label: '58 мм', sub: 'Термо · 32 кол.' },
                  { w: 42 as PaperWidth, label: '80 мм', sub: 'Термо · 42 кол.' },
                  { w: 56 as PaperWidth, label: 'A5', sub: 'Офисный · 56 кол.' },
                  { w: 80 as PaperWidth, label: 'A4', sub: 'Офисный · 80 кол.' },
                ]
              ).map(({ w, label, sub }) => (
                <button
                  key={w}
                  onClick={() => setPaper(w)}
                  className={`flex flex-col items-start rounded-xl border-2 px-3 py-2 text-left transition-all ${
                    layout.paperWidth === w
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <span
                    className={`text-sm font-bold ${
                      layout.paperWidth === w
                        ? 'text-orange-700'
                        : 'text-gray-700'
                    }`}
                  >
                    {label}
                  </span>
                  <span className="text-[11px] text-gray-500">{sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Превью ──────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Предпросмотр</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Так будет выглядеть распечатанный чек
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              <Printer size={12} />
              {paperLabel(width)} ·{' '}
              {layout.paperKind === 'a4' ? 'A4' : 'Термо'}
            </div>
          </div>

          <div className="flex flex-1 items-start justify-center overflow-auto bg-gray-200/60 p-6">
            <div className="relative">
              {/* Зубчатый верх */}
              <div
                className="h-2 bg-white"
                style={{
                  maskImage:
                    'repeating-linear-gradient(to right, transparent 0 4px, black 4px 8px)',
                  WebkitMaskImage:
                    'repeating-linear-gradient(to right, transparent 0 4px, black 4px 8px)',
                }}
              />

              {/* Бумага */}
              <div
                className="bg-white shadow-xl"
                style={{
                  width: `calc(${width}ch * ${baseFontPx} / 12)`,
                  boxSizing: 'content-box',
                  padding: '20px 16px',
                  fontFamily: MONO,
                  fontSize: `${baseFontPx}px`,
                  color: '#111',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
                }}
              >
                {visibleBlocks.map((block, i) => {
                  const multiplier = block.size === 2 ? 2 : 1;
                  const maxChars = Math.floor(width / multiplier);
                  const lines = getBlockLines(block.id, maxChars);
                  if (lines.length === 0) return null;

                  return (
                    <div key={block.id + '-' + i} style={{ marginBottom: 2 }}>
                      {lines.map((line, li) => (
                        <BlockLine
                          key={li}
                          text={line}
                          block={block}
                          paperWidth={width}
                          baseFontPx={baseFontPx}
                        />
                      ))}
                    </div>
                  );
                })}

                <div style={{ height: '1.4em' }} />

                <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-400">
                  <div className="h-px flex-1 border-t border-dashed border-gray-300" />
                  <span>✂ отрезать</span>
                  <div className="h-px flex-1 border-t border-dashed border-gray-300" />
                </div>
              </div>

              {/* Зубчатый низ */}
              <div
                className="h-2 bg-white"
                style={{
                  maskImage:
                    'repeating-linear-gradient(to right, transparent 0 4px, black 4px 8px)',
                  WebkitMaskImage:
                    'repeating-linear-gradient(to right, transparent 0 4px, black 4px 8px)',
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2.5">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>
                Ширина: <b className="text-gray-700">{width}</b> колонок
              </span>
              <span>
                Включено: <b className="text-gray-700">{visibleBlocks.length}</b>{' '}
                из <b className="text-gray-700">{layout.blocks.length}</b>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Info size={12} />
              Данные для примера
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}