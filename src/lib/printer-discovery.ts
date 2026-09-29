import { emitScanPrinters } from './socket';
import type { DiscoveredPrinter } from '@/types/database';

// ============================================================
// Проверка наличия WebUSB в браузере
// ============================================================
export function hasWebUsb(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

// ============================================================
// USB-принтеры, к которым браузеру уже давали доступ
// ============================================================
export async function listPairedUsbPrinters(): Promise<DiscoveredPrinter[]> {
  if (!hasWebUsb()) return [];
  try {
    const devices = await navigator.usb!.getDevices();
    return devices
      .map(toDiscoveredUsb)
      .filter((x): x is DiscoveredPrinter => x !== null);
  } catch {
    return [];
  }
}

// ============================================================
// Попросить у пользователя разрешение на новый USB-принтер
// ============================================================
export async function requestUsbPrinter(): Promise<DiscoveredPrinter | null> {
  if (!hasWebUsb()) return null;
  try {
    const device = await navigator.usb!.requestDevice({
      filters: [
        { classCode: 7 }, // Printer class
        { classCode: 7, subclassCode: 1, protocolCode: 1 }, // unidirectional
        { classCode: 7, subclassCode: 1, protocolCode: 2 }, // bidirectional
      ],
    });
    return toDiscoveredUsb(device);
  } catch {
    // Пользователь отменил выбор
    return null;
  }
}

// ============================================================
// Поиск устройства по сохранённому слоту (для печати)
// ============================================================
export async function findUsbDeviceBySlot(slot: {
  usb_vendor_id: number | null;
  usb_product_id: number | null;
  usb_serial: string;
}): Promise<USBDevice | null> {
  if (!hasWebUsb()) return null;
  if (!slot.usb_vendor_id || !slot.usb_product_id) return null;

  try {
    const devices = await navigator.usb!.getDevices();
    for (const d of devices) {
      if (d.vendorId !== slot.usb_vendor_id) continue;
      if (d.productId !== slot.usb_product_id) continue;
      if (slot.usb_serial && d.serialNumber !== slot.usb_serial) continue;
      return d;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ============================================================
// Объединение списков:
//   - USB (WebUSB) — из браузера
//   - Network + Windows — из сервера (сокет)
// ============================================================
export async function discoverAllPrinters(): Promise<{
  usb: DiscoveredPrinter[];
  network: DiscoveredPrinter[];
  networkError?: string;
}> {
  const usb = await listPairedUsbPrinters();

  let network: DiscoveredPrinter[] = [];
  let networkError: string | undefined;

  try {
    // Сервер возвращает и сетевые, и Windows-принтеры в одном массиве
    const all = await emitScanPrinters();
    network = all;
  } catch (e) {
    networkError = e instanceof Error ? e.message : 'scan failed';
  }

  return { usb, network, networkError };
}

// ============================================================
// Преобразование USBDevice → DiscoveredPrinter
// ============================================================
function toDiscoveredUsb(d: USBDevice): DiscoveredPrinter | null {
  const vid = d.vendorId.toString(16).padStart(4, '0');
  const pid = d.productId.toString(16).padStart(4, '0');
  const name =
    d.productName || d.manufacturerName || `USB Printer ${vid}:${pid}`;
  return {
    id: `usb:${d.vendorId}:${d.productId}:${d.serialNumber ?? ''}`,
    source: 'usb',
    name,
    vendorId: d.vendorId,
    productId: d.productId,
    serialNumber: d.serialNumber ?? '',
    manufacturer: d.manufacturerName ?? '',
  };
}