# pyright: reportAttributeAccessIssue=false, reportPossiblyUnboundVariable=false, reportUnknownMemberType=false, reportUnknownArgumentType=false
# print_server.py
import os
import platform
import subprocess
import json
import socket
import threading

from flask import Flask, request, jsonify
from flask_cors import CORS

# ─── WebSocket (опционально) ────────────────────────────────────────────────
Sock = None  # type: ignore
sock = None

try:
    from flask_sock import Sock  # type: ignore[no-redef]
    HAS_SOCK = True
except ImportError:
    HAS_SOCK = False
    print('[SYNC] flask-sock не установлен. LAN-синхронизация отключена.')
    print('[SYNC] Установи: pip install flask-sock')

app = Flask(__name__)
CORS(app)

if HAS_SOCK and Sock is not None:
    sock = Sock(app)

PORT = int(os.environ.get('PRINT_SERVER_PORT', '9999'))
SYNC_PORT = int(os.environ.get('SYNC_SERVER_PORT', '9998'))

# ─── Слоты принтеров ────────────────────────────────────────────────────────
ACTIVE_PRINTERS: dict[str, str | None] = {'kitchen': None, 'receipt': None}

MANUAL_KITCHEN = os.environ.get('PRINTER_KITCHEN', '').strip()
MANUAL_RECEIPT = os.environ.get('PRINTER_RECEIPT', '').strip()

PRINTER_KEYWORDS = [
    'pos', 'thermal', 'receipt', 'xprinter', 'epson', 'star', 'bixolon',
    'rongta', 'gprinter', 'hprt', 'zebra', '58', '80',
]

PRINTER_INFO_CACHE: dict[str, dict] = {}

# ═══════════════════════════════════════════════════════════════════════════
# LAN SYNC HUB — WebSocket для синхронизации устройств
# ═══════════════════════════════════════════════════════════════════════════
connected_clients: list = []
clients_lock = threading.Lock()


def broadcast_to_lan(message: dict, exclude_ws=None):
    """Рассылает сообщение всем подключённым ws-клиентам."""
    if not HAS_SOCK:
        return
    with clients_lock:
        dead = []
        for ws in connected_clients:
            if ws is exclude_ws:
                continue
            try:
                ws.send(json.dumps(message, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                connected_clients.remove(ws)
            except ValueError:
                pass


if HAS_SOCK and sock is not None:
    @sock.route('/sync')
    def sync_ws(ws):
        """WebSocket endpoint для LAN-синхронизации."""
        with clients_lock:
            connected_clients.append(ws)
            count = len(connected_clients)
        print(f'[SYNC] Клиент подключён ({count} всего)')

        # Оповещаем всех остальных, что состав клиентов изменился
        broadcast_to_lan({
            'type': 'clients-changed',
            'count': count,
        })

        try:
            while True:
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if msg.get('type') == 'hello':
                    broadcast_to_lan(
                        {
                            'type': 'peer-joined',
                            'peer': msg.get('peer', 'unknown'),
                        },
                        exclude_ws=ws,
                    )
                    continue

                broadcast_to_lan(msg, exclude_ws=ws)

        except Exception as e:
            print(f'[SYNC] Ошибка в WS: {e}')
        finally:
            with clients_lock:
                if ws in connected_clients:
                    connected_clients.remove(ws)
                count = len(connected_clients)
            print(f'[SYNC] Клиент отключён ({count} осталось)')

            # Оповещаем всех, что состав клиентов изменился
            broadcast_to_lan({
                'type': 'clients-changed',
                'count': count,
            })


# ═══════════════════════════════════════════════════════════════════════════
# СЕТЕВАЯ ИНФОРМАЦИЯ
# ═══════════════════════════════════════════════════════════════════════════
def get_local_ips() -> list[str]:
    """Возвращает список локальных IPv4-адресов этого компьютера."""
    # 1. Если задан MY_IP в env — используем его
    manual = os.environ.get('MY_IP', '').strip()
    if manual:
        return [manual]

    ips: list[str] = []

    # 2. getaddrinfo по hostname
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ip = str(info[4][0])
            if ':' not in ip and ip != '127.0.0.1' and ip not in ips:
                ips.append(ip)
    except Exception:
        pass

    # 3. UDP-сокет — правильный IP выходит вперёд
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(('8.8.8.8', 80))
        primary = s.getsockname()[0]
        s.close()
        if primary != '127.0.0.1':
            if primary in ips:
                ips.remove(primary)
            ips.insert(0, primary)
    except Exception:
        pass

    # 4. Fallback — PowerShell перебор всех интерфейсов
    if not ips:
        try:
            result = subprocess.run(
                ['powershell', '-NoProfile', '-Command',
                 "Get-NetIPAddress -AddressFamily IPv4 | "
                 "Where-Object { $_.IPAddress -notlike '127.*' -and "
                 "$_.IPAddress -notlike '169.254.*' } | "
                 "Select-Object -ExpandProperty IPAddress"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    ip = line.strip()
                    if ip and ip not in ips:
                        ips.append(ip)
        except Exception:
            pass

    return ips


# ═══════════════════════════════════════════════════════════════════════════
# Определение типа бумаги
# ═══════════════════════════════════════════════════════════════════════════
def get_paper_size_from_windows(printer_name: str) -> str:
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             f'Get-PrintConfiguration -PrinterName "{printer_name}" | '
             f'Select-Object -ExpandProperty PaperSize'],
            capture_output=True, text=True, timeout=8,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception as e:
        print(f'[PRINTER] paper size detect failed: {e}')
    return ''


def detect_printer_kind(printer_name: str) -> dict:
    if printer_name in PRINTER_INFO_CACHE:
        return PRINTER_INFO_CACHE[printer_name]

    paper = get_paper_size_from_windows(printer_name)
    paper_lower = paper.lower()
    name_lower = printer_name.lower()

    kind = None
    columns = 42
    description = paper or 'Unknown'

    office_sizes = {'a3': 120, 'a4': 80, 'a5': 56, 'a6': 40, 'letter': 80, 'legal': 80}
    for key, cols in office_sizes.items():
        if key in paper_lower:
            kind = 'a4'
            columns = cols
            description = paper.upper()
            break

    if not kind:
        if '58' in paper_lower or '58' in name_lower:
            kind = 'thermal'; columns = 32; description = 'Термо 58 мм'
        elif '80' in paper_lower or '80' in name_lower:
            kind = 'thermal'; columns = 42; description = 'Термо 80 мм'
        elif any(kw in name_lower for kw in ['pos', 'xprinter', 'thermal', 'receipt', 'rongta', 'gprinter']):
            kind = 'thermal'; columns = 42; description = 'Термо 80 мм'

    if not kind:
        kind = 'a4'; columns = 80; description = paper.upper() if paper else 'A4'

    info = {'kind': kind, 'columns': columns, 'paper_size': description}
    PRINTER_INFO_CACHE[printer_name] = info
    print(f'[PRINTER] {printer_name} → {kind} ({columns} колонок, {description})')
    return info


# ═══════════════════════════════════════════════════════════════════════════
# Список принтеров
# ═══════════════════════════════════════════════════════════════════════════
def list_printers_windows() -> list[str]:
    names: list[str] = []
    try:
        import win32print  # type: ignore[import]
        printers = win32print.EnumPrinters(2)
        for p in printers:
            printer_name = p[2]  # type: ignore[index]
            names.append(str(printer_name))
        if names:
            return names
    except Exception as e:
        print(f'[PRINTER] pywin32 не сработал: {e}')
        print('[PRINTER] Переключаюсь на PowerShell...')

    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             'Get-Printer | Select-Object -ExpandProperty Name'],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                line = line.strip()
                if line:
                    names.append(line)
    except Exception as e:
        print(f'[PRINTER] PowerShell не сработал: {e}')
    return names


def list_printers_unix() -> list[str]:
    try:
        result = subprocess.run(['lpstat', '-p'], capture_output=True, text=True, timeout=5)
        names: list[str] = []
        for line in result.stdout.splitlines():
            if line.startswith('printer '):
                parts = line.split()
                if len(parts) >= 2:
                    names.append(parts[1])
        return names
    except Exception as e:
        print(f'[PRINTER] lpstat failed: {e}')
        return []


def list_printers() -> list[str]:
    if platform.system() == 'Windows':
        return list_printers_windows()
    return list_printers_unix()


# ═══════════════════════════════════════════════════════════════════════════
# Отправка на принтер
# ═══════════════════════════════════════════════════════════════════════════
def send_thermal_windows(printer_name: str, data: bytes) -> None:
    import win32print  # type: ignore[import]
    printer = win32print.OpenPrinter(printer_name)
    try:
        win32print.StartDocPrinter(printer, 1, ('POS Thermal', None, 'RAW'))
        try:
            win32print.StartPagePrinter(printer)
            win32print.WritePrinter(printer, data)
            win32print.EndPagePrinter(printer)
        finally:
            win32print.EndDocPrinter(printer)
    finally:
        win32print.ClosePrinter(printer)


def send_thermal_unix(printer_name: str, data: bytes) -> None:
    subprocess.run(['lp', '-d', printer_name, '-o', 'raw'], input=data, check=True)


def send_a4_windows(printer_name: str, text: str, font_size: int = 10) -> None:
    # type: ignore
    import win32ui
    import win32con
    hDC = win32ui.CreateDC()
    try:
        hDC.CreatePrinterDC(printer_name)
        hDC.StartDoc('POS Cheque')
        logpixels_y = hDC.GetDeviceCaps(win32con.LOGPIXELSY)
        font_height = -int(font_size * logpixels_y / 72)
        font = win32ui.CreateFont({
            'name': 'Courier New', 'height': font_height, 'weight': 400,
            'charset': win32con.RUSSIAN_CHARSET,
        })
        hDC.SelectObject(font)
        printable_x = hDC.GetDeviceCaps(win32con.HORZRES)
        printable_y = hDC.GetDeviceCaps(win32con.VERTRES)
        offset_x = int(printable_x * 0.05)
        offset_y = int(printable_y * 0.05)
        line_height = int(abs(font_height) * 1.25)
        hDC.StartPage()
        y = offset_y
        for line in text.split('\n'):
            hDC.TextOut(offset_x, y, line)
            y += line_height
            if y > printable_y - line_height:
                hDC.EndPage()
                hDC.StartPage()
                y = offset_y
        hDC.EndPage()
        hDC.EndDoc()
    finally:
        try:
            hDC.DeleteDC()
        except Exception:
            pass


def send_a4_unix(printer_name: str, text: str) -> None:
    subprocess.run(['lp', '-d', printer_name, '-o', 'media=A4'],
                   input=text.encode('utf-8'), check=True)


def send_job(role: str, payload: dict) -> dict:
    name = ACTIVE_PRINTERS.get(role)
    if not name:
        raise RuntimeError(f'Принтер для "{role}" не выбран')

    info = detect_printer_kind(name)
    kind = info['kind']

    if kind == 'thermal':
        hex_data = payload.get('hex', '')
        if not hex_data:
            raise RuntimeError('Нет hex-данных для термопринтера')
        clean = hex_data.replace(' ', '')
        data = bytes.fromhex(clean)
        if platform.system() == 'Windows':
            send_thermal_windows(name, data)
        else:
            send_thermal_unix(name, data)
        return {'kind': 'thermal', 'bytes': len(data)}

    text = payload.get('text', '')
    if not text:
        raise RuntimeError('Нет текстовых данных для A4-принтера')
    if platform.system() == 'Windows':
        send_a4_windows(name, text)
    else:
        send_a4_unix(name, text)
    return {'kind': 'a4', 'chars': len(text)}


# ═══════════════════════════════════════════════════════════════════════════
# HTTP API
# ═══════════════════════════════════════════════════════════════════════════
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'os': platform.system(),
        'kitchen': ACTIVE_PRINTERS['kitchen'],
        'receipt': ACTIVE_PRINTERS['receipt'],
        'lan_sync': HAS_SOCK,
        'lan_clients': len(connected_clients),
    })


@app.route('/network-info', methods=['GET'])
def network_info():
    """Возвращает hostname и все локальные IPv4 адреса этого компьютера."""
    ips = get_local_ips()
    return jsonify({
        'hostname': socket.gethostname(),
        'local_ips': ips,
        'primary_ip': ips[0] if ips else None,
        'ports': {
            'http': PORT,
            'ws': SYNC_PORT,
        },
    })


@app.route('/sync-status', methods=['GET'])
def sync_status():
    """Возвращает статус LAN-синхронизации."""
    with clients_lock:
        count = len(connected_clients)
    return jsonify({
        'lan_sync_enabled': HAS_SOCK,
        'connected_clients': count,
        'is_hub_active': count > 0,
        'ws_port': SYNC_PORT,
        'http_port': PORT,
    })


@app.route('/printers', methods=['GET'])
def printers_list():
    return jsonify({
        'kitchen': ACTIVE_PRINTERS['kitchen'],
        'receipt': ACTIVE_PRINTERS['receipt'],
        'all': list_printers(),
    })


@app.route('/printer-info', methods=['GET'])
def printer_info():
    name = request.args.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'name required'}), 400
    info = detect_printer_kind(name)
    return jsonify({
        'success': True, 'name': name,
        'kind': info['kind'], 'columns': info['columns'],
        'paper_size': info['paper_size'],
    })


@app.route('/set-printer', methods=['POST'])
def set_printer():
    payload = request.get_json() or {}
    role = (payload.get('role') or '').strip()
    name = (payload.get('name') or '').strip()

    if role not in ('kitchen', 'receipt'):
        return jsonify({'success': False, 'error': 'role must be kitchen or receipt'}), 400
    if not name:
        return jsonify({'success': False, 'error': 'name required'}), 400

    available = list_printers()
    if name not in available:
        return jsonify({
            'success': False,
            'error': f'Принтер "{name}" не найден',
            'available': available,
        }), 404

    ACTIVE_PRINTERS[role] = name
    info = detect_printer_kind(name)
    print(f'[PRINTER] {role} → {name} ({info["kind"]}, {info["columns"]} колонок)')

    return jsonify({
        'success': True, 'role': role, 'printer': name,
        'kind': info['kind'], 'columns': info['columns'],
        'paper_size': info['paper_size'],
    })


@app.route('/print', methods=['POST'])
def print_raw():
    try:
        payload = request.get_json() or {}
        role = payload.get('role', 'kitchen')
        result = send_job(role, payload)
        return jsonify({'success': True, 'printer': ACTIVE_PRINTERS.get(role), **result})
    except Exception as e:
        print(f'[ERROR] Print failed: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════
# СТАРТ
# ═══════════════════════════════════════════════════════════════════════════
def main() -> None:
    print('=' * 62)
    print('  POS Print & Sync Server')
    print('=' * 62)
    print(f'  OS:        {platform.system()}')
    print(f'  Print:     http://127.0.0.1:{PORT}')
    if HAS_SOCK:
        print(f'  LAN Sync:  ws://0.0.0.0:{SYNC_PORT}/sync')
    else:
        print(f'  LAN Sync:  ВЫКЛЮЧЕН (pip install flask-sock)')

    local_ips = get_local_ips()
    if local_ips:
        print(f'  Мой IP:    {local_ips[0]}')
        for ip in local_ips[1:]:
            print(f'             {ip} (доп.)')

    available = list_printers()
    if not available:
        print('  [WARN] Принтеры не найдены')
    else:
        print(f'  Найдено принтеров: {len(available)}')
        for p in available:
            info = detect_printer_kind(p)
            print(f'    - {p} → {info["kind"]} ({info["columns"]} колонок)')

    if MANUAL_KITCHEN and MANUAL_KITCHEN in available:
        ACTIVE_PRINTERS['kitchen'] = MANUAL_KITCHEN
    if MANUAL_RECEIPT and MANUAL_RECEIPT in available:
        ACTIVE_PRINTERS['receipt'] = MANUAL_RECEIPT

    print('=' * 62)
    print('  Ctrl+C для остановки')
    print('=' * 62)
    print()

    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)


if __name__ == '__main__':
    main()