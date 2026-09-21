// src/hooks/useSync.ts
import { useEffect } from 'react';
import {
  onSyncEvent,
  notifyLocalChange,
  type SyncEvent,
} from '@/lib/realtimeSync';

/**
 * Подписка на события синхронизации.
 * @param events — какие события слушать (или все, если null)
 * @param callback — что делать при событии
 */
export function useSyncEvent(
  events: SyncEvent[] | SyncEvent | null,
  callback: (event: SyncEvent, source: 'local' | 'remote') => void
): void {
  useEffect(() => {
    const list =
      events === null ? null : Array.isArray(events) ? events : [events];

    const unsub = onSyncEvent((event, source) => {
      if (!list || list.includes(event)) {
        callback(event, source);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Сообщить всем устройствам (в LAN и Supabase), что данные изменились.
 */
export function notifyChange(event: SyncEvent): void {
  notifyLocalChange(event);
}