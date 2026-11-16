const STORAGE_KEY = 'kebab-pos-data-v1';

export interface StorageInfo {
  usedBytes: number;
  totalBytes: number;
  usedPct: number;
  usedMB: string;
  totalMB: string;
  imagesCount: number;
  imagesBytes: number;
}

/**
 * Типичный лимит localStorage в браузерах — 5 МБ.
 * Chrome может дать до 10, Firefox 5–10, Safari ~5.
 * Используем 5 МБ как «безопасный» лимит для индикатора.
 */
const FALLBACK_TOTAL = 5 * 1024 * 1024;

function byteLength(str: string): number {
  // В UTF-16 каждый символ в localStorage занимает 2 байта (в Chrome/Firefox)
  // Но для data URL (base64) все символы ASCII, поэтому по факту length == bytes.
  // Для точности используем Blob.
  try {
    return new Blob([str]).size;
  } catch {
    return str.length;
  }
}

export function getStorageInfo(): StorageInfo {
  let usedBytes = 0;
  let imagesCount = 0;
  let imagesBytes = 0;
  const totalBytes = FALLBACK_TOTAL;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      usedBytes = byteLength(raw);

      try {
        const data = JSON.parse(raw) as {
          menuItems?: Array<Record<string, unknown>>;
        };
        if (Array.isArray(data.menuItems)) {
          for (const item of data.menuItems) {
            const pushImage = (url: unknown) => {
              if (typeof url === 'string' && url.length > 0) {
                imagesCount++;
                imagesBytes += url.length;
              }
            };

            pushImage(item.image_url);

            if (Array.isArray(item.variants)) {
              for (const v of item.variants as Array<Record<string, unknown>>) {
                pushImage(v.image_url);
              }
            }

            const setMain = item.set_main as
              | Record<string, unknown>
              | undefined;
            if (setMain && Array.isArray(setMain.variants)) {
              for (const v of setMain.variants as Array<
                Record<string, unknown>
              >) {
                pushImage(v.image_url);
              }
            }

            if (Array.isArray(item.set_extra_groups)) {
              for (const g of item.set_extra_groups as Array<
                Record<string, unknown>
              >) {
                if (Array.isArray(g.options)) {
                  for (const o of g.options as Array<
                    Record<string, unknown>
                  >) {
                    const optItem = o.item as
                      | Record<string, unknown>
                      | undefined;
                    if (optItem) pushImage(optItem.image_url);
                  }
                }
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const usedPct =
    totalBytes > 0 ? Math.min(100, (usedBytes / totalBytes) * 100) : 0;

  return {
    usedBytes,
    totalBytes,
    usedPct,
    usedMB: (usedBytes / (1024 * 1024)).toFixed(2),
    totalMB: (totalBytes / (1024 * 1024)).toFixed(0),
    imagesCount,
    imagesBytes,
  };
}

/**
 * Проверяет, влезет ли ещё одно фото заданного размера.
 * Возвращает `ok: false`, если изображение может переполнить localStorage.
 */
export function canFitImage(imageBytes: number): {
  ok: boolean;
  freeBytes: number;
  message?: string;
} {
  const info = getStorageInfo();
  const freeBytes = Math.max(0, info.totalBytes - info.usedBytes);

  if (imageBytes > freeBytes * 0.85) {
    return {
      ok: false,
      freeBytes,
      message:
        `Недостаточно места (свободно ${(freeBytes / 1024).toFixed(0)} КБ, ` +
        `нужно ${(imageBytes / 1024).toFixed(0)} КБ). ` +
        `Удалите старые фото или сделайте экспорт.`,
    };
  }

  return { ok: true, freeBytes };
}
