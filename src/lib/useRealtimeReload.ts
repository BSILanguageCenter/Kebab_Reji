import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Подписка на realtime-изменения с debounce.
 * Позволяет группировать пакеты событий (например, при создании заказа
 * с 5 позициями) в один вызов callback.
 */
export function useRealtimeReload(
  channelName: string,
  tables: string[],
  callback: () => void,
  delayMs = 300
) {
  const timerRef = useRef<number | null>(null);
  const callbackRef = useRef(callback);
  const tablesKey = tables.join(',');

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const tableList = tablesKey.split(',').filter(Boolean);
    let channel: RealtimeChannel = supabase.channel(channelName);

    for (const table of tableList) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            callbackRef.current();
          }, delayMs);
        }
      );
    }

    channel.subscribe();

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [channelName, delayMs, tablesKey]);
}