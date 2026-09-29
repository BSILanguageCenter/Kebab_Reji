// ============================================================
// Счётчик HTTP-трафика Supabase (браузер).
//
// Оборачивает fetch, считает байты входящие / исходящие и
// количество запросов. WebSocket-трафик realtime сюда НЕ входит.
// ============================================================

interface TrafficStats {
  requests: number;
  bytesIn: number;
  bytesOut: number;
}

// ============================================================
// Расширение Window: ручной доступ из консоли браузера
//   __sbTraffic.getStats()
//   __sbTraffic.reset()
// ============================================================
declare global {
  interface Window {
    __sbTraffic?: {
      getStats: () => TrafficStats;
      reset: () => void;
    };
  }
}

const stats: TrafficStats = {
  requests: 0,
  bytesIn: 0,
  bytesOut: 0,
};

export function getTrafficStats(): TrafficStats {
  return { ...stats };
}

export function resetTrafficStats(): void {
  stats.requests = 0;
  stats.bytesIn = 0;
  stats.bytesOut = 0;
}

function estimateBodySize(body: BodyInit | null | undefined): number {
  if (!body) return 0;
  if (typeof body === 'string') {
    return new TextEncoder().encode(body).length;
  }
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).length;
  }
  if (body instanceof FormData) {
    let size = 0;
    body.forEach((value) => {
      if (typeof value === 'string') {
        size += new TextEncoder().encode(value).length;
      } else if (value instanceof Blob) {
        size += value.size;
      }
    });
    return size;
  }
  return 0;
}

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  stats.requests++;
  stats.bytesOut += estimateBodySize(init?.body);

  const res = await fetch(input, init);

  try {
    const clone = res.clone();
    const buf = await clone.arrayBuffer();
    stats.bytesIn += buf.byteLength;
  } catch {
    /* ignore */
  }

  return res;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

let loggerStarted = false;

/**
 * Запускает периодический лог в консоль.
 * Интервал по умолчанию 15 сек, лог молчит, если запросов ещё не было.
 */
export function startTrafficLogger(intervalMs = 15_000): void {
  if (typeof window === 'undefined') return;
  if (loggerStarted) return;
  loggerStarted = true;

  // Прикрепляем getStats в window — удобно дёрнуть вручную:
  //   __sbTraffic.getStats()
  //   __sbTraffic.reset()
  window.__sbTraffic = {
    getStats: () => ({ ...stats }),
    reset: resetTrafficStats,
  };

  setInterval(() => {
    if (stats.requests === 0) return;
    console.log(
      `%c[sb-traffic] ${stats.requests} req · ↓ ${formatBytes(
        stats.bytesIn
      )} · ↑ ${formatBytes(stats.bytesOut)}`,
      'color:#0ea5e9;font-weight:bold'
    );
  }, intervalMs);
}