// src/lib/menuMigrations.ts
/**
 * Чистые (без побочных эффектов) миграции схемы меню.
 * Данные лежат в Supabase как JSONB (`products.data`), поэтому
 * менять таблицу не нужно — приводим сам JSON к актуальному виду.
 */
import type { HydratedProperty, MenuItem } from '@/types/database';

/**
 * Свойство теперь имеет ровно ОДНО значение.
 * Если значений несколько — оставляем «без …» (например «без капусты»),
 * иначе первое.
 */
export function pickSingleOption(options: string[] | undefined): string[] {
  const clean = (Array.isArray(options) ? options : [])
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter(Boolean);
  if (clean.length <= 1) return clean;
  const without = clean.find((o) => /^(без|without|no)(\s|$)/i.test(o));
  return [without ?? clean[0]];
}

function fixProperties(
  list: HydratedProperty[] | undefined
): HydratedProperty[] | undefined {
  if (!Array.isArray(list)) return list;
  if (!list.some((p) => Array.isArray(p.options) && p.options.length > 1)) {
    return list;
  }
  return list.map((p) =>
    Array.isArray(p.options) && p.options.length > 1
      ? { ...p, options: pickSingleOption(p.options) }
      : p
  );
}

function fixItem(it: MenuItem): MenuItem {
  let next = it;

  const props = fixProperties(it.properties);
  if (props !== it.properties) next = { ...next, properties: props };

  if (Array.isArray(it.variants)) {
    const variants = it.variants.map(fixItem);
    if (variants.some((v, i) => v !== it.variants![i])) {
      next = { ...next, variants };
    }
  }

  if (it.set_main) {
    const main = fixItem(it.set_main);
    if (main !== it.set_main) next = { ...next, set_main: main };
  }

  if (Array.isArray(it.set_extra_groups)) {
    let groupsChanged = false;
    const groups = it.set_extra_groups.map((g) => {
      let optsChanged = false;
      const options = (g.options ?? []).map((o) => {
        const fixed = fixItem(o.item);
        if (fixed === o.item) return o;
        optsChanged = true;
        return { ...o, item: fixed };
      });
      if (!optsChanged) return g;
      groupsChanged = true;
      return { ...g, options };
    });
    if (groupsChanged) next = { ...next, set_extra_groups: groups };
  }

  return next;
}

/**
 * Возвращает ТОТ ЖЕ массив, если менять нечего (важно, чтобы не
 * порождать лишние записи в Supabase и realtime-эхо).
 */
export function migrateMenuSchema(items: MenuItem[]): MenuItem[] {
  if (!Array.isArray(items)) return items;
  const out = items.map(fixItem);
  return out.some((x, i) => x !== items[i]) ? out : items;
}
