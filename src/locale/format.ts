import { translations, defaultLang, type Lang } from './config';

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('en-US')}`;
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatTimeAgo(
  dateStr: string,
  lang: Lang = defaultLang
): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);

  const dict = translations[lang] ?? translations[defaultLang];
  const justNow = dict.timeAgoJustNow;
  const minutesTpl = dict.timeAgoMinutes;
  const hoursTpl = dict.timeAgoHours;

  if (mins < 1) return justNow;
  if (mins < 60) return minutesTpl.replace('{n}', String(mins));
  const hrs = Math.floor(mins / 60);
  return hoursTpl.replace('{n}', String(hrs));
}