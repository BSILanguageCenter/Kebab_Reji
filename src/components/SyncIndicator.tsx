// src/components/SyncIndicator.tsx
import { useEffect, useState } from 'react';
import { Radio, WifiOff } from 'lucide-react';
import { getLanStatus, initLan, onLanStatusChange } from '@/lib/lanHub';
import LanModal from './LanModal';

export default function SyncIndicator() {
  const [status, setStatus] = useState(() => getLanStatus());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    initLan();
    return onLanStatusChange(setStatus);
  }, []);

  const connected = status.connected;
  const hub = status.hub;

  const tooltip =
    connected && hub
      ? `LAN: ${hub.name}\n${hub.hubIp}:${hub.port}\n\nКлик — управление`
      : 'Не подключено к LAN\nКлик — выбрать сеть';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={tooltip}
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95 ${
          connected
            ? 'bg-green-100 text-green-700'
            : 'bg-amber-100 text-amber-700'
        }`}
      >
        <div className="relative">
          {connected ? <Radio size={16} /> : <WifiOff size={16} />}
          <span
            className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-white ${
              connected ? 'bg-green-500' : 'bg-amber-500'
            }`}
          />
        </div>
      </button>

      {open && <LanModal onClose={() => setOpen(false)} />}
    </>
  );
}