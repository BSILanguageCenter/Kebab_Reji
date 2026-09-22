// src/components/SyncIndicator.tsx
import { useEffect, useState } from 'react';
import { Radio, WifiOff } from 'lucide-react';
import {
  getLanStatus,
  initLan,
  onLanStatusChange,
  type LanState,
} from '@/lib/lanHub';
import LanModal from './LanModal';

export default function SyncIndicator() {
  const [state, setState] = useState<LanState>(() => getLanStatus());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    initLan();
    return onLanStatusChange(setState);
  }, []);

  const isHub = state.role === 'hub' && !!state.hub;
  const isClient = state.role === 'client' && !!state.hub;
  const isOnline = state.connected && (isHub || isClient);

  // ─── Иконка и цвет ─────────────────────────────────────────────────────
  let icon = <WifiOff size={16} />;
  let colorCls = 'bg-amber-100 text-amber-700';
  let dotCls = 'bg-amber-500';

  if (isHub) {
    icon = <Radio size={16} />;
    colorCls = 'bg-purple-100 text-purple-700';
    dotCls = 'bg-purple-500';
  } else if (isClient && isOnline) {
    icon = <Radio size={16} />;
    colorCls = 'bg-green-100 text-green-700';
    dotCls = 'bg-green-500';
  } else if (isClient && !isOnline) {
    icon = <WifiOff size={16} />;
    colorCls = 'bg-red-100 text-red-600';
    dotCls = 'bg-red-500';
  }

  // ─── Тултип ────────────────────────────────────────────────────────────
  let tooltip = 'LAN не настроен\nКлик — открыть';
  if (isHub && state.hub) {
    tooltip =
      `Ваш LAN: ${state.hub.name}\n` +
      `${state.hub.ip}:${state.hub.port}\n` +
      `Устройств: ${state.clients}\n` +
      (state.hub.has_password ? '🔒 с паролем' : '🔓 открытый');
  } else if (isClient && state.hub) {
    tooltip =
      `Подключено к: ${state.hub.name}\n` +
      `${state.hub.ip}:${state.hub.port}\n` +
      `Устройств: ${state.clients}`;
  } else if (state.error) {
    tooltip = state.error;
  }

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
            className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-white ${dotCls}`}
          />
        </div>
      </button>

      {open && <LanModal onClose={() => setOpen(false)} />}
    </>
  );
}