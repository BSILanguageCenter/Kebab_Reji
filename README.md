# Kebab_Reji
#cvcS7oKDRJRY6r8F

════════════════════════════════════════════════════════════════════════
  ПРОГРАММЫ (устанавливаются один раз, скачиваются с интернета)
════════════════════════════════════════════════════════════════════════

▸ Node.js 20 LTS или новее
  https://nodejs.org/
  ⚠️  При установке на Windows — галочка «Add to PATH» включена по умолчанию
  Проверка: node --version   → v20.x или выше
            npm --version    → 10.x или выше

▸ Python 3.11 или новее
  https://python.org/
  ⚠️  При установке на Windows — ОБЯЗАТЕЛЬНО поставь галочку «Add Python to PATH»
  Проверка: python --version → Python 3.11.x или выше

После установки ПЕРЕЗАГРУЗИ компьютер (чтобы PATH обновился).


════════════════════════════════════════════════════════════════════════
  NPM-ПАКЕТЫ (Node.js зависимости проекта)
════════════════════════════════════════════════════════════════════════

Открой терминал в папке проекта и выполни ОДНУ команду:

  npm install

Эта команда сама установит всё из package.json:

  ├─ @point-of-sale/receipt-printer-encoder
  ├─ @supabase/supabase-js
  ├─ lucide-react
  ├─ react
  ├─ react-dom
  ├─ react-router-dom
  │
  ├─ @eslint/js
  ├─ @types/react
  ├─ @types/react-dom
  ├─ @vitejs/plugin-react
  ├─ autoprefixer
  ├─ concurrently
  ├─ eslint
  ├─ eslint-plugin-react-hooks
  ├─ eslint-plugin-react-refresh
  ├─ globals
  ├─ postcss
  ├─ tailwindcss
  ├─ typescript
  ├─ typescript-eslint
  └─ vite

Если хочешь вручную (по одной):

  npm install @point-of-sale/receipt-printer-encoder @supabase/supabase-js lucide-react react react-dom react-router-dom

  npm install -D @eslint/js @types/react @types/react-dom @vitejs/plugin-react autoprefixer concurrently eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals postcss tailwindcss typescript typescript-eslint vite


════════════════════════════════════════════════════════════════════════
  PYTHON-ПАКЕТЫ (зависимости print_server.py)
════════════════════════════════════════════════════════════════════════

Windows (одна команда):

  pip install flask flask-cors flask-sock pywin32

Mac / Linux (без pywin32):

  pip3 install flask flask-cors flask-sock

Расшифровка:

  ├─ flask        — HTTP-сервер для печати
  ├─ flask-cors   — разрешает запросы из браузера (CORS)
  ├─ flask-sock   — WebSocket для LAN-синхронизации
  └─ pywin32      — печать через Win32 Spooler (только Windows)


Если "pip is not recognized":

  python -m pip install flask flask-cors flask-sock pywin32


════════════════════════════════════════════════════════════════════════
  ФАЙЛ .env (КРИТИЧНО! Без него приложение не подключится к базе)
════════════════════════════════════════════════════════════════════════

В корне проекта должен лежать файл .env со следующим содержимым:

  VITE_SUPABASE_URL=https://ecoudnfpgibkvyjtazvu.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_CgpCgeHbrKWpwos-eS_mEw_De_JHs9s

Если файла нет — создай вручную в корне рядом с package.json.


════════════════════════════════════════════════════════════════════════
  ВСЁ ОДНОЙ СТРОКОЙ (Windows PowerShell)
════════════════════════════════════════════════════════════════════════

  npm install ; python -m pip install flask flask-cors flask-sock pywin32 ; npm run dev


════════════════════════════════════════════════════════════════════════
  ВСЁ ОДНОЙ СТРОКОЙ (Mac / Linux)
════════════════════════════════════════════════════════════════════════

  npm install && pip3 install flask flask-cors flask-sock && npm run dev


════════════════════════════════════════════════════════════════════════
  ЗАПУСК ПОСЛЕ УСТАНОВКИ
════════════════════════════════════════════════════════════════════════

  npm run dev

Ожидаемый вывод:

  [VITE]  VITE v5.4.8  ready in 212 ms
  [VITE]  ➜  Local:   http://localhost:5173/
  [VITE]  ➜  Network: http://192.168.X.XX:5173/
  [PY]    POS Print & Sync Server
  [PY]    ==============================================================
  [PY]      OS:        Windows
  [PY]      Print:     http://127.0.0.1:9999
  [PY]      LAN Sync:  ws://0.0.0.0:9998/sync
  [PY]      Мой IP:    192.168.X.XX
  [PY]    ==============================================================


════════════════════════════════════════════════════════════════════════
  ЧАСТЫЕ ОШИБКИ
════════════════════════════════════════════════════════════════════════

python is not recognized          │ Переустанови Python с галочкой "Add to PATH"
pip is not recognized             │ python -m pip install ...
npm is not recognized             │ Перезагрузи компьютер
ModuleNotFoundError: flask        │ pip install flask
ModuleNotFoundError: flask_sock   │ pip install flask-sock
import win32print fails           │ pip install pywin32 (только Windows)
VITE_SUPABASE_URL is undefined    │ Нет файла .env — создай вручную
Failed to fetch (в браузере)      │ Python-сервер не запущен
ReferenceError: require is not    │ Проверь scripts/start-printer.cjs
  defined                            (должен быть .cjs, не .js)


════════════════════════════════════════════════════════════════════════
  ЧЕК-ЛИСТ УСПЕШНОЙ УСТАНОВКИ
════════════════════════════════════════════════════════════════════════

□ Node.js установлен (node --version работает)
□ Python установлен (python --version работает)
□ npm install выполнен без ошибок
□ pip install выполнен без ошибок
□ Файл .env на месте с URL и ключом Supabase
□ npm run dev запускает и Vite, и Python
□ В логах [PY] виден мой IP
□ Браузер открывает http://localhost:5173
□ Приложение загружает категории и блюда
□ WiFi-иконка в шапке зелёная или синяя
════════════════════════════════════════════════════════════════════════

Итого, что нужно установить на новом устройстве:

Слой	Что	Команда
Программа	Node.js 20+	скачать с nodejs.org
Программа	Python 3.11+	скачать с python.org
Node-пакеты	~20 штук	npm install
Python-пакеты	4 штуки	pip install flask flask-cors flask-sock pywin32
Файл	.env	создать вручную
Запуск	—	npm run dev
После этого всё работает.

