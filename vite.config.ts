import { defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Получить локальный IPv4 адрес (для клиентов)
// Пропускает виртуальные адаптеры (Hotspot, VirtualBox, Docker, VMware)
// ============================================================
function getLocalIpv4(): string | null {
  const nets = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string }> = [];

  for (const name of Object.keys(nets)) {
    // Пропускаем виртуальные адаптеры по имени
    if (
      /vEthernet|Virtual|VMware|VirtualBox|Loopback|Wi-?Fi Direct|Direct|Мобильный|Hotspot/i.test(
        name
      )
    ) {
      continue;
    }

    for (const net of nets[name] ?? []) {
      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;

      const ip = net.address;

      // Пропускаем известные виртуальные диапазоны
      if (ip.startsWith('192.168.137.')) continue; // Windows Mobile Hotspot
      if (ip.startsWith('192.168.56.')) continue; // VirtualBox Host-Only
      if (ip.startsWith('192.168.99.')) continue; // Docker Toolbox
      if (ip.startsWith('172.17.')) continue; // Docker bridge
      if (ip.startsWith('169.254.')) continue; // APIPA (нет DHCP)
      if (ip.startsWith('10.0.75.')) continue; // Docker Desktop

      candidates.push({ name, address: ip });
    }
  }

  // Приоритет 1: интерфейс с именем "Ethernet"
  for (const c of candidates) {
    if (/^Ethernet( \d+)?$/i.test(c.name)) {
      return c.address;
    }
  }

  // Приоритет 2: реальная беспроводная сеть
  for (const c of candidates) {
    if (/Wireless|Wi-?Fi|Беспроводная/i.test(c.name)) {
      return c.address;
    }
  }

  // Приоритет 3: первый оставшийся
  return candidates[0]?.address ?? null;
}

// ============================================================
// Управление Node-сервером POS
// ============================================================
let serverProcess: ChildProcess | null = null;
let serverStarting = false;

function startPosServer(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (serverProcess) {
      resolve({ ok: true });
      return;
    }
    if (serverStarting) {
      resolve({ ok: false, error: 'Уже запускается' });
      return;
    }
    serverStarting = true;

    const serverDir = path.resolve(__dirname, 'server');
    const indexJs = path.join(serverDir, 'index.js');

    if (!existsSync(indexJs)) {
      serverStarting = false;
      resolve({ ok: false, error: 'server/index.js not found' });
      return;
    }

    const args = ['--experimental-sqlite', 'index.js'];

    try {
      console.log('[pos-server] Запускаю Node-сервер...');

      serverProcess = spawn(process.execPath, args, {
        cwd: serverDir,
        stdio: 'inherit',
      });

      serverProcess.on('exit', (code) => {
        console.log(`[pos-server] Процесс завершён с кодом ${code}`);
        serverProcess = null;
        serverStarting = false;
      });

      serverProcess.on('error', (err) => {
        console.error('[pos-server] Ошибка запуска:', err);
        serverProcess = null;
        serverStarting = false;
      });

      setTimeout(() => {
        serverStarting = false;
        resolve({ ok: true });
      }, 2000);
    } catch (e) {
      serverStarting = false;
      resolve({ ok: false, error: String(e) });
    }
  });
}

function stopPosServer(): void {
  if (!serverProcess) return;
  console.log('[pos-server] Останавливаю Node-сервер...');

  try {
    if (process.platform === 'win32' && serverProcess.pid) {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch (e) {
    console.error('[pos-server] Ошибка остановки:', e);
  }

  serverProcess = null;
}

function posServerPlugin() {
  return {
    name: 'pos-server-control',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        (
          req: IncomingMessage,
          res: ServerResponse,
          next: (err?: unknown) => void
        ) => {
          // ---------- Запуск сервера ----------
          if (req.url === '/api/server/start' && req.method === 'POST') {
            startPosServer().then((result) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
            });
            return;
          }

          // ---------- Остановка ----------
          if (req.url === '/api/server/stop' && req.method === 'POST') {
            stopPosServer();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          // ---------- Статус ----------
          if (req.url === '/api/server/status' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                running: !!serverProcess,
                starting: serverStarting,
              })
            );
            return;
          }

          // ---------- Локальный IP хоста ----------
          if (req.url === '/api/server/ip' && req.method === 'GET') {
            const ip = getLocalIpv4();
            console.log('[pos-server] Запрошен IP хоста:', ip);
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ip,
                port: 3001,
              })
            );
            return;
          }

          // ---------- Список всех IPv4 (для отладки) ----------
          if (req.url === '/api/server/ip-all' && req.method === 'GET') {
            const nets = os.networkInterfaces();
            const all: Array<{ name: string; address: string; internal: boolean }> =
              [];
            for (const name of Object.keys(nets)) {
              for (const net of nets[name] ?? []) {
                if (net.family === 'IPv4') {
                  all.push({
                    name,
                    address: net.address,
                    internal: net.internal,
                  });
                }
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ all, chosen: getLocalIpv4() }, null, 2));
            return;
          }

          next();
        }
      );

      server.httpServer?.on('close', () => {
        stopPosServer();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), posServerPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});