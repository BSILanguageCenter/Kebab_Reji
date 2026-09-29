// ============================================================
// Печать ESC/POS через WebUSB (браузер)
// ============================================================

const USB_CLASS_PRINTER = 7;

export async function printBufferViaUsb(
  device: USBDevice,
  buffer: Uint8Array
): Promise<void> {
  try {
    await device.open();
  } catch {
    // Может быть уже открыт — это ок
  }

  try {
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const cfg = device.configuration;
    if (!cfg) throw new Error('Устройство не имеет конфигурации');

    let ifaceNumber = -1;
    let endpointNumber = -1;

    // 1) Приоритет: интерфейс класса Printer (7) с bulk OUT
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass !== USB_CLASS_PRINTER) continue;
        const outEp = alt.endpoints.find(
          (e) => e.direction === 'out' && e.type === 'bulk'
        );
        if (outEp) {
          ifaceNumber = iface.interfaceNumber;
          endpointNumber = outEp.endpointNumber;
          break;
        }
      }
      if (endpointNumber !== -1) break;
    }

    // 2) Fallback: любой bulk OUT
    if (endpointNumber === -1) {
      for (const iface of cfg.interfaces) {
        for (const alt of iface.alternates) {
          const outEp = alt.endpoints.find(
            (e) => e.direction === 'out' && e.type === 'bulk'
          );
          if (outEp) {
            ifaceNumber = iface.interfaceNumber;
            endpointNumber = outEp.endpointNumber;
            break;
          }
        }
        if (endpointNumber !== -1) break;
      }
    }

    if (ifaceNumber === -1 || endpointNumber === -1) {
      throw new Error('Не найден bulk OUT endpoint');
    }

    // Захватываем интерфейс
    let claimed = false;
    try {
      await device.claimInterface(ifaceNumber);
      claimed = true;
    } catch (e) {
      throw new Error(
        `Не удалось захватить интерфейс ${ifaceNumber}: ${
          e instanceof Error ? e.message : 'unknown'
        }`
      );
    }

    try {
      // Разбиваем на чанки по 8 КБ (WebUSB обычно не любит больше)
      const CHUNK = 8192;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const chunk = buffer.slice(i, i + CHUNK);
        const res = await device.transferOut(endpointNumber, chunk);
        if (res.status !== 'ok') {
          throw new Error(`Ошибка передачи данных: ${res.status}`);
        }
      }
    } finally {
      if (claimed) {
        try {
          await device.releaseInterface(ifaceNumber);
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    try {
      await device.close();
    } catch {
      /* ignore */
    }
  }
}

// ============================================================
// base64 → Uint8Array
// ============================================================
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}