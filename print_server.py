#!/usr/bin/env python3
"""
Kebab POS — Print Server + LAN Hub
- HTTP API :9999
- WebSocket hub :9998
- UDP discovery :9997 (broadcast в локальную сеть)
- Печать на системные и Wi-Fi принтеры
"""

import os
import sys
import json
import time
import socket
import platform
import threading
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from flask import Flask, jsonify, request

# ═══════════════════════════════════════════════════════════════════════════
# ОПЦИОНАЛЬНЫЕ ЗАВИСИМОСТИ
# ═══════════════════════════════════════════════════════════════════════════
CORS: Any = None
Sock: Any = None
ServiceBrowser: Any = None
Zeroconf: Any = None
ServiceListener: Any = None
win32print: Any = None

HAS_CORS = False
HAS_WS = False
HAS_ZEROCONF = False
HAS_WIN32PRINT = False

try:
    from flask_cors import CORS as _CORS  # type: ignore
    CORS = _CORS
    HAS_CORS = True
except ImportError:
    pass

try:
    from flask_sock import Sock as _Sock  # type: ignore
    Sock = _Sock
    HAS_WS = True
except ImportError:
    pass

try:
    from zeroconf import (  # type: ignore
        ServiceBrowser as _ServiceBrowser,
        Zeroconf as _Zeroconf,
        ServiceListener as _ServiceListener,
    )
    ServiceBrowser = _ServiceBrowser
    Zeroconf = _Zeroconf
    ServiceListener = _ServiceListener
    HAS_ZEROCONF = True
except ImportError:
    pass

IS_WINDOWS = platform.system() == 'Windows'
IS_MAC = platform.system() == 'Darwin'
IS_LINUX = platform.system() == 'Linux'

if IS_WINDOWS:
    try:
        import win32print as _win32print  # type: ignore
        win32print = _win32print
        HAS_WIN32PRINT = True
    except ImportError:
        pass


# ═══════════════════════════════════════════════════════════════════════════
# СОСТОЯНИЕ
# ═══════════════════════════════════════════════════════════════════════════
active_printers: dict[str, Optional[dict[str, Any]]] = {
    'kitchen': None,
    'receipt': None,
}

ws_clients: set[Any] = set()
peers: dict[str, Any] = {}
ws_lock = threading.Lock()

# ─── LAN hub (моё устройство как точка сбора) ──────────────────────────────
lan_hub: dict[str, Any] = {
    'active': False,
    'name': '',
    'password': '',
    'hub_ip': None,
    'created_at': 0.0,
}

# ─── LAN client (моё устройство как клиент чужого хаба) ────────────────────
lan_client: dict[str, Any] = {
    'joined': False,
    'name': '',
    'hub_ip': None,
    'hub_port': 9998,
    'has_password': False,
    'last_error': None,
}

UDP_PORT = 9997
_udp_socket: Optional[socket.socket] = None
_udp_thread: Optional[threading.Thread] = None
_udp_running = False


# ═══════════════════════════════════════════════════════════════════════════
# HTTP APP
# ═══════════════════════════════════════════════════════════════════════════
http_app = Flask('kebab_http')
if HAS_CORS and CORS is not None:
    CORS(http_app)


# ═══════════════════════════════════════════════════════════════════════════
# УТИЛИТЫ СЕТИ
# ═══════════════════════════════════════════════════════════════════════════
def get_primary_ip() -> Optional[str]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = str(s.getsockname()[0])
        s.close()
        return ip
    except OSError:
        return None


def get_my_subnet() -> Optional[str]:
    ip = get_primary_ip()
    if not ip:
        return None
    return '.'.join(ip.split('.')[:3])


# ═══════════════════════════════════════════════════════════════════════════
# UDP DISCOVERY
# ═══════════════════════════════════════════════════════════════════════════
def start_udp_listener() -> None:
    """Запускает поток, отвечающий на broadcast-запросы lan-discover."""
    global _udp_socket, _udp_thread, _udp_running
    if _udp_running:
        return
    _udp_running = True

    def _loop() -> None:
        global _udp_socket, _udp_running
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            s.bind(('', UDP_PORT))
        except OSError as e:
            print(f'[udp] bind failed: {e}')
            _udp_running = False
            return
        _udp_socket = s
        print(f'[udp] listening on 0.0.0.0:{UDP_PORT}')
        while _udp_running:
            try:
                data, addr = s.recvfrom(2048)
            except OSError:
                break
            try:
                msg = json.loads(data.decode('utf-8'))
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get('type') == 'lan-discover' and lan_hub['active']:
                with ws_lock:
                    client_count = len(ws_clients)
                reply = {
                    'type': 'lan-announce',
                    'name': lan_hub['name'],
                    'ip': lan_hub['hub_ip'],
                    'port': 9998,
                    'has_password': bool(lan_hub['password']),
                    'clients': client_count,
                }
                try:
                    s.sendto(json.dumps(reply).encode('utf-8'), addr)
                except OSError:
                    pass
        try:
            s.close()
        except OSError:
            pass

    _udp_thread = threading.Thread(target=_loop, daemon=True)
    _udp_thread.start()


def udp_discover(timeout: float = 2.0) -> list[dict[str, Any]]:
    """Рассылает broadcast и собирает ответы от активных LAN."""
    results: list[dict[str, Any]] = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(0.4)
    try:
        payload = json.dumps({'type': 'lan-discover'}).encode('utf-8')
        # Broadcast во всю подсеть
        try:
            s.sendto(payload, ('255.255.255.255', UDP_PORT))
        except OSError:
            pass

        deadline = time.time() + timeout
        seen: set[str] = set()
        while time.time() < deadline:
            try:
                data, _addr = s.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                msg = json.loads(data.decode('utf-8'))
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get('type') == 'lan-announce':
                key = f"{msg.get('ip')}:{msg.get('port')}"
                if key in seen:
                    continue
                seen.add(key)
                results.append(msg)
    finally:
        s.close()
    return results


# ═══════════════════════════════════════════════════════════════════════════
# LAN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════
@http_app.route('/lan/create', methods=['POST'])
def lan_create():
    data: dict[str, Any] = request.get_json() or {}
    name = (data.get('name') or '').strip()
    password = (data.get('password') or '').strip()

    if not name:
        return jsonify({'success': False, 'error': 'name required'}), 400

    ip = get_primary_ip()
    if not ip:
        return jsonify({
            'success': False,
            'error': 'cannot determine local IP',
        }), 500

    lan_hub['active'] = True
    lan_hub['name'] = name
    lan_hub['password'] = password
    lan_hub['hub_ip'] = ip
    lan_hub['created_at'] = time.time()

    start_udp_listener()

    return jsonify({
        'success': True,
        'name': name,
        'ip': ip,
        'port': 9998,
        'has_password': bool(password),
        'clients': 0,
    })


@http_app.route('/lan/stop', methods=['POST'])
def lan_stop():
    lan_hub['active'] = False
    lan_hub['name'] = ''
    lan_hub['password'] = ''
    lan_hub['hub_ip'] = None
    lan_hub['created_at'] = 0.0
    return jsonify({'success': True})


@http_app.route('/lan/status', methods=['GET'])
def lan_status():
    with ws_lock:
        count = len(ws_clients)
    return jsonify({
        'active': lan_hub['active'],
        'name': lan_hub['name'],
        'ip': lan_hub['hub_ip'],
        'port': 9998,
        'has_password': bool(lan_hub['password']),
        'clients': count,
    })


@http_app.route('/lan/discover', methods=['POST'])
def lan_discover():
    try:
        lans = udp_discover(timeout=2.0)
        return jsonify({'success': True, 'lans': lans})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@http_app.route('/lan/client-state', methods=['GET'])
def lan_client_state():
    return jsonify(lan_client)


@http_app.route('/lan/client-set', methods=['POST'])
def lan_client_set():
    """Сохраняет состояние клиента в Python (для info-целей)."""
    data: dict[str, Any] = request.get_json() or {}
    lan_client['joined'] = bool(data.get('joined'))
    lan_client['name'] = data.get('name') or ''
    lan_client['hub_ip'] = data.get('hub_ip')
    lan_client['hub_port'] = int(data.get('hub_port') or 9998)
    lan_client['has_password'] = bool(data.get('has_password'))
    lan_client['last_error'] = data.get('last_error')
    return jsonify({'success': True})


# ═══════════════════════════════════════════════════════════════════════════
# СИСТЕМНЫЕ ПРИНТЕРЫ
# ═══════════════════════════════════════════════════════════════════════════
def list_system_printers() -> list[str]:
    printers: list[str] = []
    try:
        if IS_WINDOWS and HAS_WIN32PRINT and win32print is not None:
            flags = (
                win32print.PRINTER_ENUM_LOCAL
                | win32print.PRINTER_ENUM_CONNECTIONS
            )
            for p in win32print.EnumPrinters(flags, None, 2):
                printers.append(p['pPrinterName'])
        elif IS_MAC or IS_LINUX:
            out = subprocess.check_output(
                ['lpstat', '-a'], text=True, timeout=5
            )
            for line in out.splitlines():
                if line.strip():
                    printers.append(line.split()[0])
    except Exception as e:
        print(f'[print_server] list_system_printers failed: {e}')
    return printers


def detect_printer_info(name: str) -> dict[str, Any]:
    name_lower = name.lower()
    if 'a4' in name_lower or 'office' in name_lower or 'laser' in name_lower:
        return {'kind': 'a4', 'columns': 80, 'paper_size': 'A4'}
    return {'kind': 'thermal', 'columns': 42, 'paper_size': '80mm'}


@http_app.route('/health', methods=['GET'])
def health():
    kitchen = active_printers['kitchen']
    receipt = active_printers['receipt']
    return jsonify({
        'kitchen': kitchen['name'] if kitchen else None,
        'receipt': receipt['name'] if receipt else None,
    })


@http_app.route('/printers', methods=['GET'])
def printers():
    kitchen = active_printers['kitchen']
    receipt = active_printers['receipt']
    return jsonify({
        'kitchen': kitchen['name'] if kitchen else None,
        'receipt': receipt['name'] if receipt else None,
        'all': list_system_printers(),
    })


@http_app.route('/printer-info', methods=['GET'])
def printer_info():
    name = request.args.get('name')
    if not name:
        return jsonify({'success': False, 'error': 'name required'}), 400
    info = detect_printer_info(name)
    return jsonify({'success': True, **info})


@http_app.route('/set-printer', methods=['POST'])
def set_printer():
    data: dict[str, Any] = request.get_json() or {}
    role = data.get('role')
    name = data.get('name')
    printer_type = data.get('type', 'system')
    ip = data.get('ip')
    port = data.get('port', 9100)

    if role not in ('kitchen', 'receipt') or not name:
        return jsonify({
            'success': False, 'error': 'role and name required'
        }), 400

    if printer_type == 'wifi':
        if not ip:
            return jsonify({
                'success': False, 'error': 'ip required for wifi'
            }), 400
        info: dict[str, Any] = {
            'name': name, 'type': 'wifi', 'ip': ip, 'port': port,
            'kind': 'thermal', 'columns': 42, 'paper_size': '80mm',
        }
    else:
        base = detect_printer_info(name)
        info = {'name': name, 'type': 'system', **base}

    active_printers[role] = info
    return jsonify({'success': True, **info})


# ═══════════════════════════════════════════════════════════════════════════
# ПЕЧАТЬ
# ═══════════════════════════════════════════════════════════════════════════
def print_system(name: str, raw_bytes: bytes) -> None:
    if IS_WINDOWS and HAS_WIN32PRINT and win32print is not None:
        hprinter = win32print.OpenPrinter(name)
        try:
            win32print.StartDocPrinter(
                hprinter, 1, ('POS job', None, 'RAW')
            )
            try:
                win32print.StartPagePrinter(hprinter)
                win32print.WritePrinter(hprinter, raw_bytes)
                win32print.EndPagePrinter(hprinter)
            finally:
                win32print.EndDocPrinter(hprinter)
        finally:
            win32print.ClosePrinter(hprinter)
    else:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(raw_bytes)
            tmp = f.name
        try:
            subprocess.run(
                ['lp', '-d', name, '-o', 'raw', tmp],
                check=True, timeout=10,
            )
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def print_wifi(ip: str, port: int, raw_bytes: bytes) -> None:
    with socket.create_connection((ip, port), timeout=5) as s:
        s.sendall(raw_bytes)


@http_app.route('/print', methods=['POST'])
def print_endpoint():
    data: dict[str, Any] = request.get_json() or {}
    role = data.get('role')
    hex_str = data.get('hex', '')

    if role not in ('kitchen', 'receipt'):
        return jsonify({'success': False, 'error': 'invalid role'}), 400

    printer = active_printers.get(role)
    if not printer:
        return jsonify({
            'success': False, 'error': f'{role} printer not set'
        }), 400

    try:
        raw_bytes = bytes.fromhex(hex_str) if hex_str else b''
    except ValueError as e:
        return jsonify({'success': False, 'error': f'bad hex: {e}'}), 400

    if not raw_bytes:
        return jsonify({'success': False, 'error': 'empty payload'}), 400

    try:
        if printer['type'] == 'wifi':
            print_wifi(printer['ip'], printer['port'], raw_bytes)
        else:
            print_system(printer['name'], raw_bytes)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@http_app.route('/print-raw', methods=['POST'])
def print_raw():
    data: dict[str, Any] = request.get_json() or {}
    ip = data.get('ip')
    port = data.get('port', 9100)
    hex_str = data.get('hex', '')

    if not ip or not hex_str:
        return jsonify({
            'success': False, 'error': 'ip and hex required'
        }), 400

    try:
        raw_bytes = bytes.fromhex(hex_str)
        print_wifi(ip, port, raw_bytes)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════
# ПОИСК WI-FI ПРИНТЕРОВ (mDNS + scan)
# ═══════════════════════════════════════════════════════════════════════════
def probe_tcp(ip: str, port: int = 9100, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def discover_scan(port: int = 9100) -> list[dict[str, Any]]:
    subnet = get_my_subnet()
    if not subnet:
        return []
    result: list[dict[str, Any]] = []
    ips = [f'{subnet}.{i}' for i in range(1, 255)]
    with ThreadPoolExecutor(max_workers=64) as ex:
        futures = {ex.submit(probe_tcp, ip, port): ip for ip in ips}
        for fut, ip in futures.items():
            try:
                if fut.result():
                    result.append({
                        'name': ip, 'ip': ip, 'port': port, 'source': 'scan',
                    })
            except Exception:
                pass
    return result


def _build_mdns_listener_class() -> Any:
    if not HAS_ZEROCONF or ServiceListener is None:
        return None

    class _MdnsListener(ServiceListener):  # type: ignore
        def __init__(self) -> None:
            self.found: list[dict[str, Any]] = []

        def add_service(self, zc: Any, type_: str, name: str) -> None:
            info = zc.get_service_info(type_, name)
            if not info:
                return
            addrs = info.parsed_addresses()
            if addrs:
                ip_str = str(addrs[0])
                self.found.append({
                    'name': name.replace(f'.{type_}', ''),
                    'ip': ip_str,
                    'port': info.port or 9100,
                    'source': 'mdns',
                })

        def remove_service(self, zc: Any, type_: str, name: str) -> None:
            pass

        def update_service(self, zc: Any, type_: str, name: str) -> None:
            pass

    return _MdnsListener


def discover_mdns(timeout: float = 2.5) -> list[dict[str, Any]]:
    if not HAS_ZEROCONF or Zeroconf is None or ServiceBrowser is None:
        return []
    listener_cls = _build_mdns_listener_class()
    if listener_cls is None:
        return []
    zc = Zeroconf()
    listener = listener_cls()
    try:
        ServiceBrowser(zc, '_ipp._tcp.local.', listener)
        ServiceBrowser(zc, '_printer._tcp.local.', listener)
        ServiceBrowser(zc, '_pdl-datastream._tcp.local.', listener)
        time.sleep(timeout)
    finally:
        zc.close()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for p in listener.found:
        key = str(p['ip'])
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def discover_all_wifi() -> list[dict[str, Any]]:
    mdns = discover_mdns(timeout=2.5)
    seen = {str(p['ip']) for p in mdns}
    scan = discover_scan(port=9100)
    for p in scan:
        if str(p['ip']) not in seen:
            seen.add(str(p['ip']))
            mdns.append(p)
    return mdns


@http_app.route('/wifi-printers', methods=['GET'])
def wifi_printers():
    try:
        return jsonify({'success': True, 'printers': discover_all_wifi()})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════
# СЕТЕВАЯ ИНФОРМАЦИЯ
# ═══════════════════════════════════════════════════════════════════════════
@http_app.route('/network-info', methods=['GET'])
def network_info():
    hostname = socket.gethostname()
    local_ips: list[str] = []
    try:
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = str(info[4][0])
            if ip not in local_ips and not ip.startswith('127.'):
                local_ips.append(ip)
    except socket.gaierror:
        pass
    primary = get_primary_ip()
    if primary and primary not in local_ips:
        local_ips.insert(0, primary)
    return jsonify({
        'hostname': hostname,
        'local_ips': local_ips,
        'primary_ip': local_ips[0] if local_ips else None,
        'ports': {'http': 9999, 'ws': 9998, 'udp': 9997},
    })


# ═══════════════════════════════════════════════════════════════════════════
# WEBSOCKET HUB (порт 9998)
# ═══════════════════════════════════════════════════════════════════════════
ws_app = Flask('kebab_ws')
sock: Any = None


def broadcast_client_count() -> None:
    with ws_lock:
        count = len(ws_clients)
        targets = list(ws_clients)
    msg = json.dumps({'type': 'client-count', 'count': count})
    for peer in targets:
        try:
            peer.send(msg)
        except Exception:
            pass


if HAS_WS and Sock is not None:
    sock = Sock(ws_app)

    @sock.route('/sync')
    def sync_endpoint(ws: Any) -> None:
        # Первое сообщение — hello с паролем
        try:
            first = ws.receive()
        except Exception:
            return
        if first is None:
            return
        try:
            hello = json.loads(first)
        except Exception:
            try:
                ws.close()
            except Exception:
                pass
            return

        if not isinstance(hello, dict) or hello.get('type') != 'hello':
            try:
                ws.close()
            except Exception:
                pass
            return

        # Проверка пароля (только если hub активен)
        if lan_hub['active']:
            expected = lan_hub['password'] or ''
            provided = hello.get('password') or ''
            if expected and provided != expected:
                try:
                    ws.send(json.dumps({'type': 'auth-failed'}))
                except Exception:
                    pass
                try:
                    ws.close()
                except Exception:
                    pass
                return

        peer_id = str(hello.get('peer') or f'peer-{int(time.time())}')

        with ws_lock:
            ws_clients.add(ws)
            peers[peer_id] = ws

        try:
            ws.send(json.dumps({
                'type': 'hello-ok',
                'peer_id': peer_id,
                'hub': lan_hub['name'],
                'clients': len(ws_clients),
            }))
        except Exception:
            pass

        broadcast_client_count()
        print(f'[ws] client {peer_id} connected (total: {len(ws_clients)})')

        try:
            while True:
                msg = ws.receive()
                if msg is None:
                    break
                with ws_lock:
                    others = [c for c in ws_clients if c is not ws]
                for peer in others:
                    try:
                        peer.send(msg)
                    except Exception:
                        pass
        except Exception as e:
            print(f'[ws] error: {e}')
        finally:
            with ws_lock:
                ws_clients.discard(ws)
                peers.pop(peer_id, None)
            broadcast_client_count()
            print(f'[ws] client {peer_id} disconnected '
                  f'(total: {len(ws_clients)})')


# ═══════════════════════════════════════════════════════════════════════════
# ЗАПУСК
# ═══════════════════════════════════════════════════════════════════════════
def run_http() -> None:
    from werkzeug.serving import make_server
    server = make_server('0.0.0.0', 9999, http_app, threaded=True)
    print('[http] listening on 0.0.0.0:9999')
    server.serve_forever()


def run_ws() -> None:
    from werkzeug.serving import make_server
    server = make_server('0.0.0.0', 9998, ws_app, threaded=True)
    print('[ws]   listening on 0.0.0.0:9998')
    server.serve_forever()


if __name__ == '__main__':
    print('╔══════════════════════════════════════════╗')
    print('║  Kebab POS — Print Server + LAN Hub      ║')
    print('╚══════════════════════════════════════════╝')
    print(f'  Platform:   {platform.system()} {platform.release()}')
    print(f'  Python:     {sys.version.split()[0]}')
    print(f'  win32print: {HAS_WIN32PRINT}')
    print(f'  flask-sock: {HAS_WS}')
    print(f'  zeroconf:   {HAS_ZEROCONF}')
    print(f'  UDP port:   {UDP_PORT} (LAN discovery)')
    print()

    if not HAS_WS:
        print('⚠  flask-sock не установлен — LAN отключён')
        print('   pip install flask-sock\n')

    threads = [threading.Thread(target=run_http, daemon=True)]
    if HAS_WS:
        threads.append(threading.Thread(target=run_ws, daemon=True))

    for t in threads:
        t.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print('\n[server] shutting down…')