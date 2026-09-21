// src/components/SyncIndicator.tsx
import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Radio } from 'lucide-react';
import { getLanStatus, onLanStatusChange, type LanStatus } from '@/lib/lanSync';
import { getCachedIp } from '@/lib/deviceInfo';
import NetworkSettingsModal from './NetworkSettingsModal';

export default function SyncIndicator() {
  const [status, setStatus] = useState<LanStatus>(() => getLanStatus());
  const [supabaseOk, setSupabaseOk] = useState(true);
  const [myIp, setMyIp] = useState<string | null>(getCachedIp());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsub = onLanStatusChange(setStatus);
    return unsub;
  }, []);

  useEffect(() => {
    const update = () => setSupabaseOk(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Обновляем myIp периодически, чтобы тултип был актуальным
  useEffect(() => {
    const update = () => setMyIp(getCachedIp());
    const t = setInterval(update, 5000);
    return () => clearInterval(t);
  }, []);

  // ─── Иконка и цвет ──────────────────────────────────────────────────────
  let icon = <Wifi size={16} />;
  let colorCls = 'bg-green-100 text-green-700';

  if (!supabaseOk && !status.connected) {
    icon = <WifiOff size={16} />;
    colorCls = 'bg-red-100 text-red-600';
  } else if (status.connected && supabaseOk) {
    icon = <Radio size={16} />;
    colorCls = 'bg-green-100 text-green-700';
  } else if (status.connected) {
    icon = <Radio size={16} />;
    colorCls = 'bg-amber-100 text-amber-700';
  } else if (supabaseOk) {
    icon = <Wifi size={16} />;
    colorCls = 'bg-blue-100 text-blue-700';
  }

  const tooltip = `Мой IP: ${myIp || '—'}\n${
    status.connected ? `LAN: ${status.hubIp}` : 'LAN не подключён'
  }\n\nКлик — настройка связи`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={tooltip}
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95 ${colorCls}`}
      >
        <div className="relative">
          {icon}
          <span
            className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-white ${
              status.connected && supabaseOk
                ? 'bg-green-500'
                : status.connected || supabaseOk
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
          />
        </div>
      </button>

      {open && <NetworkSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}