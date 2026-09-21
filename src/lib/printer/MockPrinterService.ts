import type { PrinterService } from './PrinterService';
import { formatKitchenTicket, formatReceipt } from './PrinterService';
import type { Order, Language } from '@/lib/types';

export const MockPrinterService: PrinterService = {
  async printKitchenTicket(order: Order, lang: Language) {
    const ticket = formatKitchenTicket(order, lang);
    console.log('[MOCK PRINTER — Kitchen Ticket]\n' + ticket);
    alert(ticket);
  },

  async printReceipt(order: Order, lang: Language) {
    const receipt = formatReceipt(order, lang);
    console.log('[MOCK PRINTER — Receipt]\n' + receipt);
  },
};
