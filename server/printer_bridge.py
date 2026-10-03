"""
Kebab POS — Windows USB Printer Bridge.

Мини-HTTP-сервер, который принимает RAW-байты ESC/POS от Node.js
и пишет их в установленный Windows-принтер через win32print
(Windows spooler). Обходит проблему WebUSB с драйверами.

Поддерживает два режима печати (заголовок X-Datatype):
    RAW  — сырые ESC/POS байты (POS-принтеры, рулон 80mm)
    TEXT — текстовый документ, драйвер сам верстает A4 (L4160 и т.п.)

Установка:
    pip install pywin32

Запускается автоматически из server/index.js.
Вручную: python server/printer_bridge.py
"""
import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

try:
    import win32print
except ImportError:
    print("ERROR: pywin32 не установлен.", flush=True)
    print("Запустите: pip install pywin32", flush=True)
    sys.exit(1)

HOST = "127.0.0.1"
PORT = 9999

ALLOWED_DATATYPES = {"RAW", "TEXT", "XPS_PASS", "EMF"}


class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True


class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write("[bridge] " + (format % args) + "\n")
        sys.stderr.flush()

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    # ---------- GET ----------
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            return self._json(200, {"ok": True, "service": "printer-bridge"})

        if path == "/printers":
            try:
                flags = (
                    win32print.PRINTER_ENUM_LOCAL
                    | win32print.PRINTER_ENUM_CONNECTIONS
                )
                printers = win32print.EnumPrinters(flags, None, 2)
                try:
                    default_name = win32print.GetDefaultPrinter()
                except Exception:
                    default_name = ""
                result = []
                for p in printers:
                    result.append({
                        "name": p["pPrinterName"],
                        "port": p.get("pPortName", ""),
                        "driver": p.get("pDriverName", ""),
                        "is_default": p["pPrinterName"] == default_name,
                    })
                return self._json(200, {"ok": True, "printers": result})
            except Exception as e:
                traceback.print_exc()
                return self._json(500, {"ok": False, "error": str(e)})

        return self._json(404, {"ok": False, "error": "not found"})

    # ---------- POST ----------
    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/print":
            return self._json(404, {"ok": False, "error": "not found"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                return self._json(400, {"ok": False, "error": "empty body"})
            body = self.rfile.read(length)

            printer_name = self.headers.get("X-Printer-Name") or ""
            if not printer_name:
                printer_name = win32print.GetDefaultPrinter()

            if not printer_name:
                return self._json(400, {"ok": False, "error": "no printer name"})

            # ---- Тип данных: RAW (ESC/POS) или TEXT (Windows-драйвер) ----
            raw_datatype = (self.headers.get("X-Datatype") or "RAW").strip().upper()
            datatype = raw_datatype if raw_datatype in ALLOWED_DATATYPES else "RAW"

            print(
                f"[bridge] print -> '{printer_name}' "
                f"({len(body)} bytes, datatype={datatype})",
                flush=True,
            )

            hprinter = win32print.OpenPrinter(printer_name)
            try:
                win32print.StartDocPrinter(
                    hprinter, 1, ("Kebab POS Ticket", None, datatype)
                )
                try:
                    win32print.StartPagePrinter(hprinter)
                    win32print.WritePrinter(hprinter, body)
                    win32print.EndPagePrinter(hprinter)
                finally:
                    win32print.EndDocPrinter(hprinter)
            finally:
                win32print.ClosePrinter(hprinter)

            return self._json(
                200,
                {
                    "ok": True,
                    "bytes": len(body),
                    "printer": printer_name,
                    "datatype": datatype,
                },
            )
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"ok": False, "error": str(e)})


def main():
    print("[bridge] Windows USB Printer Bridge", flush=True)
    print(f"[bridge] Слушаю http://{HOST}:{PORT}", flush=True)
    print("[bridge] Endpoints:", flush=True)
    print("[bridge]   GET  /health", flush=True)
    print("[bridge]   GET  /printers", flush=True)
    print("[bridge]   POST /print   (X-Printer-Name + X-Datatype)", flush=True)
    print("", flush=True)
    try:
        server = ReusableHTTPServer((HOST, PORT), BridgeHandler)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] Остановлен.", flush=True)
    except OSError as e:
        print(f"[bridge] ОШИБКА: {e}", flush=True)
        print("[bridge] Порт 9999 занят? Убей старый процесс.", flush=True)


if __name__ == "__main__":
    main()