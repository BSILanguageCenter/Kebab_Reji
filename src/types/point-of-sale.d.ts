// src/types/point-of-sale.d.ts
// Объявления типов для библиотек, у которых нет встроенных .d.ts

declare module '@point-of-sale/receipt-printer-encoder' {
  export type EncoderLanguage =
    | 'esc-pos'
    | 'star-line'
    | 'star-prnt'
    | 'star-graphic';

  export type EncoderAlign = 'left' | 'center' | 'right';

  export interface EncoderOptions {
    language: EncoderLanguage;
    columns?: number;
    codepage?: string;
    imageMode?: 'raster' | 'graphics';
  }

  export default class ReceiptPrinterEncoder {
    constructor(options: EncoderOptions);
    initialize(): this;
    align(value: EncoderAlign): this;
    bold(value: boolean): this;
    italic(value: boolean): this;
    underline(value: boolean): this;
    invert(value: boolean): this;
    size(width: number, height?: number): this;
    font(value: 'a' | 'b' | 'c'): this;
    text(value: string, codepage?: string): this;
    line(value?: string): this;
    rule(options?: { style?: 'single' | 'double'; width?: number }): this;
    newline(): this;
    feed(lines?: number): this;
    cut(value?: 'full' | 'partial'): this;
    qrcode(value: string, options?: Record<string, unknown>): this;
    barcode(value: string, symbology: string, options?: Record<string, unknown>): this;
    encode(): Uint8Array;
  }
}