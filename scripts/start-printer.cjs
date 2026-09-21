// scripts/start-printer.cjs
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'print_server.py');

// Проверка: есть ли сам файл print_server.py
if (!fs.existsSync(scriptPath)) {
  console.warn('[PRINTER] print_server.py не найден — печать отключена');
  process.exit(0);
}

// Ищем рабочую команду Python в системе
const candidates =
  process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];

let pythonCmd = null;
for (const cmd of candidates) {
  try {
    const test = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (test.status === 0) {
      pythonCmd = cmd;
      break;
    }
  } catch {
    /* пробуем следующий */
  }
}

if (!pythonCmd) {
  console.warn('');
  console.warn('╔══════════════════════════════════════════════════════════╗');
  console.warn('║  Python не найден в PATH — печать будет недоступна.     ║');
  console.warn('║                                                          ║');
  console.warn('║  Установи Python 3: https://python.org                  ║');
  console.warn('║  Затем выполни:                                         ║');
  console.warn('║    pip install -r requirements.txt                       ║');
  console.warn('╚══════════════════════════════════════════════════════════╝');
  console.warn('');
  process.exit(0);
}

console.log(`[PRINTER] Запускаю: ${pythonCmd} print_server.py`);
console.log('');

const child = spawn(pythonCmd, [scriptPath], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});

child.on('error', (err) => {
  console.error('[PRINTER] Ошибка запуска Python:', err.message);
});

child.on('exit', (code, signal) => {
  if (signal) return; // убит родителем — нормально
  if (code !== 0) {
    console.warn(`[PRINTER] print_server.py завершился с кодом ${code}`);
  }
  // Выходим с 0 — Vite должен продолжать работать
  process.exit(0);
});

// Пробрасываем Ctrl+C в дочерний процесс
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    child.kill(sig);
    setTimeout(() => process.exit(0), 300);
  });
});