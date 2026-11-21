// src/services/layoutStyle.ts
import { uuid } from '@/lib/uuid';
import { tr, dateLocale } from '@/locale/format';
import { supabase } from '@/lib/supabase';
import type { LayoutSettings } from '@/lib/layoutSettings';

const TABLE = 'app_settings';
const KEY_PREFIX = 'layout_style:';
const LEGACY_KEY = 'menu_layout'; // старое имя (миграция)

// ============================================================
// ТИПЫ
// ============================================================
export interface SavedStyle {
  id: string;
  name: string;
  /** Стиль режима «все блюда» (у старых стилей — единственный стиль) */
  layout: LayoutSettings;
  /** Стиль режима «одна иконка». Нет у стилей, сохранённых до разделения режимов */
  layoutSingle?: LayoutSettings;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Используй SavedStyle */
export interface SavedLayoutStyle {
  layout: LayoutSettings;
  updatedAt: string;
}

// ============================================================
// READ — все стили
// ============================================================
export async function fetchAllStyles(): Promise<SavedStyle[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('key, data, created_at, updated_at')
    .or(`key.like.${KEY_PREFIX}%,key.eq.${LEGACY_KEY}`)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Supabase fetch styles failed: ${error.message}`);
  }
  if (!data) return [];

  return data
    .map((row): SavedStyle | null => {
      const key = row.key as string;
      const payload = row.data as {
        name?: string;
        layout?: LayoutSettings;
        layoutSingle?: LayoutSettings;
      };
      if (!payload?.layout) return null;

      const isLegacy = key === LEGACY_KEY;
      const id = isLegacy ? 'legacy' : key.slice(KEY_PREFIX.length);
      const fallbackName = isLegacy
        ? `${tr('styleLegacy')} (${new Date(row.updated_at as string).toLocaleDateString(dateLocale())})`
        : `${tr('styleNamePrefix')} ${new Date(row.updated_at as string).toLocaleDateString(dateLocale())}`;

      return {
        id,
        name: payload.name?.trim() || fallbackName,
        layout: payload.layout,
        layoutSingle: payload.layoutSingle,
        createdAt: (row.created_at as string) ?? (row.updated_at as string),
        updatedAt: row.updated_at as string,
      };
    })
    .filter((s): s is SavedStyle => s !== null);
}

// ============================================================
// READ — один стиль
// ============================================================
export async function fetchStyleById(
  id: string
): Promise<SavedStyle | null> {
  const key = id === 'legacy' ? LEGACY_KEY : `${KEY_PREFIX}${id}`;

  const { data, error } = await supabase
    .from(TABLE)
    .select('key, data, created_at, updated_at')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase fetch style failed: ${error.message}`);
  }
  if (!data) return null;

  const payload = data.data as {
    name?: string;
    layout?: LayoutSettings;
    layoutSingle?: LayoutSettings;
  };
  if (!payload?.layout) return null;

  const fallbackName =
    id === 'legacy'
      ? tr('styleLegacy')
      : `${tr('styleNamePrefix')} ${id.slice(0, 6)}`;

  return {
    id,
    name: payload.name?.trim() || fallbackName,
    layout: payload.layout,
    layoutSingle: payload.layoutSingle,
    createdAt: (data.created_at as string) ?? (data.updated_at as string),
    updatedAt: data.updated_at as string,
  };
}

// ============================================================
// CREATE — сохранить новый стиль
// ============================================================
export async function saveStyle(
  name: string,
  layout: LayoutSettings,
  layoutSingle?: LayoutSettings
): Promise<SavedStyle> {
  const id = uuid();
  const now = new Date().toISOString();

  const fallbackName = `${tr('styleNamePrefix')} ${new Date().toLocaleString(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
  const cleanName = name.trim() || fallbackName;

  const { error } = await supabase.from(TABLE).upsert(
    {
      key: `${KEY_PREFIX}${id}`,
      data: { name: cleanName, layout, layoutSingle },
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'key' }
  );

  if (error) {
    throw new Error(`Supabase save style failed: ${error.message}`);
  }

  return {
    id,
    name: cleanName,
    layout,
    layoutSingle,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================
// UPDATE — переименовать
// ============================================================
export async function renameStyle(
  id: string,
  name: string
): Promise<void> {
  const existing = await fetchStyleById(id);
  if (!existing) throw new Error('Style not found');

  const key = id === 'legacy' ? LEGACY_KEY : `${KEY_PREFIX}${id}`;

  const { error } = await supabase.from(TABLE).upsert(
    {
      key,
      data: {
        name: name.trim(),
        layout: existing.layout,
        layoutSingle: existing.layoutSingle,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  if (error) {
    throw new Error(`Supabase rename style failed: ${error.message}`);
  }
}

// ============================================================
// DELETE
// ============================================================
export async function deleteStyle(id: string): Promise<void> {
  const key = id === 'legacy' ? LEGACY_KEY : `${KEY_PREFIX}${id}`;

  const { error } = await supabase.from(TABLE).delete().eq('key', key);

  if (error) {
    throw new Error(`Supabase delete style failed: ${error.message}`);
  }
}

// ============================================================
// LEGACY API (обратная совместимость)
// ============================================================

/** @deprecated Используй saveStyle(name, layout) */
export async function saveLayoutStyle(
  layout: LayoutSettings
): Promise<SavedStyle> {
  return saveStyle('', layout);
}

/** @deprecated Используй fetchAllStyles() или fetchStyleById() */
export async function fetchLayoutStyle(): Promise<SavedLayoutStyle | null> {
  const all = await fetchAllStyles();
  const first = all[0];
  if (!first) return null;
  return { layout: first.layout, updatedAt: first.updatedAt };
}
