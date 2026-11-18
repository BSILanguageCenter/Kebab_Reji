// src/services/supabaseStorage.ts
import { supabase, MENU_IMAGES_BUCKET } from '@/lib/supabase';

/**
 * Загружает изображение в Supabase Storage и возвращает публичный URL.
 *
 * @param file      File или Blob для загрузки.
 * @param prefix    Опциональный префикс пути (например, id блюда).
 * @returns         Публичный URL изображения.
 */
export async function uploadImageToSupabase(
  file: File | Blob,
  prefix?: string
): Promise<string> {
  const ext = guessExt(file.type);
  const filename = `${prefix ? `${prefix}-` : ''}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const path = prefix ? `${prefix}/${filename}` : filename;

  const { error: uploadError } = await supabase.storage
    .from(MENU_IMAGES_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });

  if (uploadError) {
    throw new Error(
      `Supabase upload failed: ${uploadError.message}`
    );
  }

  const { data } = supabase.storage
    .from(MENU_IMAGES_BUCKET)
    .getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error('Supabase getPublicUrl returned no URL');
  }

  return data.publicUrl;
}

/**
 * Удаляет файл из Supabase Storage по публичному URL.
 * Извлекает путь из URL и вызывает remove().
 *
 * Не критично, если удаление не удалось (файл могли уже удалить).
 */
export async function deleteImageFromSupabase(
  publicUrl: string
): Promise<void> {
  const path = extractPathFromPublicUrl(publicUrl);
  if (!path) return;

  const { error } = await supabase.storage
    .from(MENU_IMAGES_BUCKET)
    .remove([path]);

  if (error) {
    console.warn(
      '[supabaseStorage] delete failed (non-fatal):',
      error.message
    );
  }
}

// ============================================================
// HELPERS
// ============================================================

function guessExt(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Публичный URL Supabase Storage выглядит так:
 *   https://xxx.supabase.co/storage/v1/object/public/menu-images/<path>
 * Нам нужен <path> — всё после /menu-images/.
 */
function extractPathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${MENU_IMAGES_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
