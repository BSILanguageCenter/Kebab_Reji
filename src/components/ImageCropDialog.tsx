import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Check,
  ZoomIn,
  RotateCcw,
  FileImage,
  AlertTriangle,
} from 'lucide-react';

const CONTAINER_SIZE = 360;
const OUTPUT_SIZE = 768;
const JPEG_QUALITY = 0.82;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.01;

const UPSCALE_WARN_THRESHOLD = 512;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImageCropDialog({
  open,
  file,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);

  const [originalSize, setOriginalSize] = useState<number>(0);
  const [outputSize, setOutputSize] = useState<number>(0);
  const [measuring, setMeasuring] = useState(false);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    ox: number;
    oy: number;
  } | null>(null);

  // ---------- Загрузка файла ----------
  useEffect(() => {
    if (!file) {
      setImgUrl(null);
      setImgEl(null);
      setOriginalSize(0);
      setOutputSize(0);
      return;
    }
    setOriginalSize(file.size);
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ---------- Сброс при закрытии ----------
  useEffect(() => {
    if (!open) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setOutputSize(0);
    }
  }, [open]);

  // ============================================================
  // РАЗМЕРЫ
  // Используем naturalWidth / naturalHeight — это истинные размеры
  // ПОСЛЕ применения EXIF-поворота (все современные браузеры так делают).
  // ============================================================
  const imgW = imgEl?.naturalWidth ?? 1;
  const imgH = imgEl?.naturalHeight ?? 1;

  // Вписываем всё фото в квадрат (fit whole image)
  const baseScale = imgEl ? CONTAINER_SIZE / Math.max(imgW, imgH) : 1;

  // Зум, при котором картинка заполнит квадрат без белых полей
  const fillZoom = imgEl ? Math.max(imgW, imgH) / Math.min(imgW, imgH) : 1;

  // ============================================================
  // Отрисовка итогового канваса
  // ============================================================
  const renderToCanvas = useCallback(() => {
    if (!imgEl) return null;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Белый фон (для PNG с прозрачностью)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const ratio = OUTPUT_SIZE / CONTAINER_SIZE;
    const scale = baseScale * zoom * ratio;

    const drawW = imgW * scale;
    const drawH = imgH * scale;

    const centerX = OUTPUT_SIZE / 2 + offset.x * ratio;
    const centerY = OUTPUT_SIZE / 2 + offset.y * ratio;

    const dx = centerX - drawW / 2;
    const dy = centerY - drawH / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgEl, dx, dy, drawW, drawH);

    return canvas;
  }, [imgEl, imgW, imgH, zoom, offset, baseScale]);

  // ---------- Оценка размера файла ----------
  useEffect(() => {
    if (!open || !imgEl) return;
    let cancelled = false;
    setMeasuring(true);

    const timer = window.setTimeout(async () => {
      try {
        const canvas = renderToCanvas();
        if (!canvas) {
          if (!cancelled) setMeasuring(false);
          return;
        }
        const blob: Blob | null = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
        );
        if (!cancelled) {
          setOutputSize(blob?.size ?? 0);
          setMeasuring(false);
        }
      } catch {
        if (!cancelled) setMeasuring(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, imgEl, zoom, offset, renderToCanvas]);

  // ---------- Drag ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (!imgEl) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // ---------- Zoom колесом ----------
  const onWheel = (e: React.WheelEvent) => {
    if (!imgEl) return;
    e.preventDefault();
    const factor = 1 - e.deltaY * 0.0015;
    setZoom((z) =>
      Math.min(MAX_ZOOM, Math.max(1, +(z * factor).toFixed(3)))
    );
  };

  // ---------- Финал ----------
  const handleConfirm = useCallback(async () => {
    if (!imgEl) return;
    setProcessing(true);
    try {
      const canvas = renderToCanvas();
      if (!canvas) throw new Error('no canvas');

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
      );
      if (!blob) throw new Error('toBlob failed');

      const cropped = new File([blob], `cropped-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      });
      onConfirm(cropped);
    } catch (e) {
      console.error('[crop] error:', e);
    } finally {
      setProcessing(false);
    }
  }, [imgEl, renderToCanvas, onConfirm]);

  if (!open || !file || !imgUrl || !imgEl) return null;

  const compressionPercent =
    originalSize > 0 && outputSize > 0
      ? Math.round((1 - outputSize / originalSize) * 100)
      : 0;

  // Сколько пикселей оригинала попадает в итоговый квадрат
  const sourcePixelsInCrop = Math.round(CONTAINER_SIZE / (baseScale * zoom));
  const willUpscale = sourcePixelsInCrop < UPSCALE_WARN_THRESHOLD;
  const hasWhiteGap = zoom < fillZoom - 0.01;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={processing ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 shrink-0">
          <h3 className="text-lg font-black text-gray-900">Обрезка фото</h3>
          <button
            onClick={onCancel}
            disabled={processing}
            className="text-gray-500 hover:text-gray-900 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {/* Квадрат-превью */}
          <div
            className="relative mx-auto bg-white border-2 border-gray-300 rounded-xl overflow-hidden cursor-grab active:cursor-grabbing select-none"
            style={{
              width: CONTAINER_SIZE,
              height: CONTAINER_SIZE,
              touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {/*
              ВАЖНО: не задаём width/height в пикселях!
              Пусть img рендерится по своим naturalWidth × naturalHeight
              (после EXIF-поворота). Только transform: scale() уменьшает.
            */}
            <img
              src={imgUrl}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 'auto',
                height: 'auto',
                maxWidth: 'none',
                maxHeight: 'none',
                // Принудительно учитывать EXIF-ориентацию
                imageOrientation: 'from-image',
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${
                  baseScale * zoom
                })`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />

            {/* Сетка 1/3 */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-black/20" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-black/20" />
              <div className="absolute top-1/3 left-0 right-0 h-px bg-black/20" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-black/20" />
            </div>

            {hasWhiteGap && (
              <div className="pointer-events-none absolute bottom-1 left-1 right-1 text-center text-[9px] font-bold text-gray-500 bg-white/85 rounded px-1 py-0.5">
                Видно всё фото. Для заполнения квадрата увеличьте до{' '}
                {fillZoom.toFixed(2)}×
              </div>
            )}
          </div>

          {/* Зум */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <ZoomIn className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider flex-1">
                Масштаб
              </span>
              <span className="text-[11px] font-black text-orange-600 tabular-nums">
                {zoom.toFixed(2)}×
              </span>
            </div>

            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-orange-500 cursor-pointer"
            />

            <div className="flex gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  Math.abs(zoom - 1) < 0.05
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
                title="Показать всё фото"
              >
                Fit
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(+fillZoom.toFixed(2));
                  setOffset({ x: 0, y: 0 });
                }}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  Math.abs(zoom - fillZoom) < 0.05
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
                title={`Заполнить квадрат (${fillZoom.toFixed(2)}×)`}
              >
                Fill
              </button>
              {[2, 4, MAX_ZOOM].map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    Math.abs(zoom - z) < 0.05
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {z}×
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
              className="mt-2 w-full py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-bold text-gray-700 flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Сбросить
            </button>
          </div>

          {/* ИНФО О РАЗМЕРЕ */}
          <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileImage className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                Информация
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div className="text-gray-400 font-bold text-[9px] uppercase tracking-wider">
                  Оригинал
                </div>
                <div className="font-black text-gray-700 tabular-nums">
                  {imgW}×{imgH}
                </div>
                <div className="text-[10px] text-gray-500 tabular-nums">
                  {formatBytes(originalSize)}
                </div>
              </div>
              <div>
                <div className="text-gray-400 font-bold text-[9px] uppercase tracking-wider">
                  После обрезки
                </div>
                <div className="font-black text-orange-600 tabular-nums flex items-center gap-1.5">
                  {measuring ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                      <span className="text-gray-400">считаю…</span>
                    </>
                  ) : (
                    <>
                      {formatBytes(outputSize)}
                      {compressionPercent > 0 && (
                        <span className="text-[10px] font-bold text-green-600">
                          −{compressionPercent}%
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="text-[10px] text-gray-500">
                  {OUTPUT_SIZE}×{OUTPUT_SIZE}
                </div>
              </div>
            </div>

            <div className="mt-1.5 pt-1.5 border-t border-slate-200 text-[10px] text-gray-500 leading-snug flex items-center justify-between gap-2">
              <span>
                Кадр из оригинала:{' '}
                <b className="text-gray-700">
                  {sourcePixelsInCrop}×{sourcePixelsInCrop} px
                </b>
              </span>
              <span className="text-gray-400">
                JPEG {Math.round(JPEG_QUALITY * 100)}%
              </span>
            </div>
          </div>

          {willUpscale && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-800 leading-snug">
                Область кадра меньше {UPSCALE_WARN_THRESHOLD}×
                {UPSCALE_WARN_THRESHOLD} px — картинка будет растянута.
                Уменьшите масштаб, чтобы захватить больше оригинала.
              </p>
            </div>
          )}

          <p className="mt-2 text-[10px] text-gray-500 text-center leading-snug">
            При открытии видно всё фото (кнопка <b>Fit</b>). Кнопка{' '}
            <b>Fill</b> заполняет квадрат без белых полей. Крутите колесо
            мыши или ползунок, чтобы приблизить нужный кусок.
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex gap-2 shrink-0">
          <button
            onClick={onCancel}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold disabled:opacity-40"
          >
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Check className="w-4 h-4" />
            {processing ? 'Обработка...' : 'Готово'}
          </button>
        </div>
      </div>
    </div>
  );
}