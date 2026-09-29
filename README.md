# r44

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-wefeqrsp)


npm install
npm install socket.io-client
npm install -D concurrently
cd server
npm install
pip install pywin32
python -m pip install pywin32
cd ..
ls


pip install pywin32
python server/printer_bridge.py

VITE_SUPABASE_URL=https://ecoudnfpgibkvyjtazvu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_CgpCgeHbrKWpwos-eS_mEw_De_JHs9s
PORT=3001
SUPABASE_URL=https://ecoudnfpgibkvyjtazvu.supabase.co
SUPABASE_KEY=sb_publishable_CgpCgeHbrKWpwos-eS_mEw_De_JHs9s
sds

Kebab_Reji/
│
├── .env                          ← создать вручную (см. шаг 5)
├── .gitignore
├── index.html
├── package.json                  ← зависимости фронта
├── tsconfig.json
├── vite.config.ts
│
├── server/                       ← Node.js сервер
│   ├── package.json              ← зависимости сервера
│   ├── env.js                    ← чтение .env
│   ├── index.js                  ← Express + Socket.IO + автозапуск Python
│   ├── db.js                     ← SQLite (node:sqlite) + схема
│   ├── store.js                  ← CRUD + EventEmitter
│   ├── host.js                   ← host.id, диапазоны номеров
│   ├── supabase-sync.js          ← синк с облаком
│   ├── printer.js                ← ESC/POS буферы + TCP печать
│   ├── printer-discovery.js      ← сканирование LAN на :9100
│   ├── printer-bridge-client.js  ← клиент к Python bridge
│   ├── printer_bridge.py         ← 🐍 Python-мост (win32print)
│   └── data/                     ← создаётся автоматически
│       ├── pos.db
│       └── host.id
│
└── src/                          ← React-фронт
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── vite-env.d.ts
    │
    ├── components/               ← переиспользуемые UI
    │   ├── ConfirmDialog.tsx
    │   ├── ClearCartDialog.tsx
    │   ├── PageActions.tsx
    │   ├── PanelSettings.tsx
    │   ├── ProductBuilderDialog.tsx
    │   └── Resizer.tsx
    │
    ├── lib/                      ← клиенты и утилиты
    │   ├── socket.ts
    │   ├── layoutSettings.ts
    │   ├── printer-discovery.ts
    │   ├── usb-printer.ts
    │   ├── supabase.ts
    │   └── traffic.ts
    │
    ├── locale/                   ← i18n
    │   ├── config.ts
    │   ├── index.tsx
    │   ├── lg.ts
    │   ├── ru.ts
    │   └── en.ts
    │
    ├── pages/
    │   ├── App.tsx
    │   ├── CashierPage.tsx
    │   ├── KitchenPage.tsx
    │   ├── QueuePage.tsx
    │   ├── ManagerPage.tsx
    │   └── Manager/
    │       ├── MenuProduct.tsx
    │       ├── StatistikProduct.tsx
    │       └── PrinterSettings.tsx
    │
    ├── services/
    │   ├── printer.ts
    │   ├── menu.ts
    │   ├── orders.ts
    │   ├── statistics.ts
    │   ├── kitchen.ts
    │   └── undo.ts
    │
    └── types/
        └── database.ts