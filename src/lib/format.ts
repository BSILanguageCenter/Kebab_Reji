import type { OrderStatus, TableStatus, Language } from '@/lib/types';

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('en-US')}`;
}

export function formatTime(iso: string, lang: Language): string {
  return new Date(iso).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string, lang: Language): string {
  return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function getElapsedMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function getElapsedString(iso: string, lang: Language): string {
  const mins = getElapsedMinutes(iso);
  const label = lang === 'ru' ? ' мин.' : '分';
  return `${mins}${label}`;
}

export const statusColors: Record<OrderStatus, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  cooking: 'bg-orange-100 text-orange-700 border-orange-200',
  ready: 'bg-green-100 text-green-700 border-green-200',
  completed: 'bg-gray-100 text-gray-600 border-gray-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};

export const statusDotColors: Record<OrderStatus, string> = {
  new: 'bg-blue-500',
  cooking: 'bg-orange-500',
  ready: 'bg-green-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-red-500',
};

export const tableStatusColors: Record<TableStatus, string> = {
  free: 'bg-green-50 border-green-200 text-green-700',
  occupied: 'bg-orange-50 border-orange-200 text-orange-700',
  waiting_payment: 'bg-yellow-50 border-yellow-200 text-yellow-700',
};
