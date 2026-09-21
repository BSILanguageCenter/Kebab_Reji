import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Order } from '@/lib/types';

interface ReadyNotification {
  orderNumber: number;
  shown: boolean;
}

export function useReadyOrders() {
  const [readyOrders, setReadyOrders] = useState<ReadyNotification[]>([]);

  useEffect(() => {
    const channel = supabase
      .channel('pos-ready-orders')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'status=eq.ready' },
        (payload) => {
          const order = payload.new as Order;
          if (order.status === 'ready') {
            setReadyOrders((prev) => {
              if (prev.some((r) => r.orderNumber === order.order_number)) return prev;
              return [...prev, { orderNumber: order.order_number, shown: true }];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const dismiss = (orderNumber: number) => {
    setReadyOrders((prev) => prev.filter((r) => r.orderNumber !== orderNumber));
  };

  return { readyOrders, dismiss };
}
