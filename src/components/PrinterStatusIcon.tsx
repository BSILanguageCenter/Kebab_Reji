// src/components/PrinterStatusIcon.tsx
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { getPrinterStatus } from '@/lib/LocalPrinterService';

export default function PrinterStatusIcon() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [title, setTitle] = useState('Проверка принтеров…');

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const status = await getPrinterStatus();
      if (cancelled) return;
      setConnected(status.connected);

      if (!status.kitchen && !status.receipt) {
        setTitle('Принтеры не выбраны. Настрой в разделе Настройки.');
      } else if (!status.kitchen) {
        setTitle('Кухонный принтер не выбран');
      } else if (!status.receipt) {
        setTitle('Принтер для чеков не выбран');
      } else {
        setTitle(`Кухня: ${status.kitchen}\nЧеки: ${status.receipt}`);
      }
    };

    check();
    const interval = setInterval(check, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Лоадинг
  if (connected === null) {
    return (
      <div
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100"
        title="Проверка принтеров…"
      >
        <Printer size={16} className="animate-pulse text-gray-400" />
      </div>
    );
  }

  return (
    <div
      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
        connected
          ? 'bg-green-100 text-green-700'
          : 'bg-red-100 text-red-600'
      }`}
      title={title}
    >
      <div className="relative">
        <Printer size={16} />
        <span
          className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-white ${
            connected ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
      </div>
    </div>
  );
}