/**
 * UUID v4 с fallback для браузеров без crypto.randomUUID.
 * Используется в sync queue и других местах, где нужен уникальный id.
 */
export function uuid(): string {
  // Современные браузеры
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      /* ignore */
    }
  }

  // Fallback (не криптографически стойкий, но уникальный)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
