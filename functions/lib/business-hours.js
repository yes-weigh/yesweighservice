const IST = 'Asia/Kolkata';

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  return {
    weekday: parts.find(p => p.type === 'weekday')?.value ?? '',
    hour: Number(parts.find(p => p.type === 'hour')?.value ?? -1),
    minute: Number(parts.find(p => p.type === 'minute')?.value ?? -1),
  };
}

/** Mon–Sat 09:00–18:00 IST (last run at 18:00, not 18:30). */
export function isCatalogSyncWindow(date = new Date()) {
  const { weekday, hour, minute } = istParts(date);
  if (weekday === 'Sun') return false;
  if (hour < 9 || hour > 18) return false;
  if (hour === 18 && minute > 0) return false;
  return true;
}

/** Working days Mon–Sat, 09:30–17:30 IST. */
export function isKotakBankFeedWindow(date = new Date()) {
  const { weekday, hour, minute } = istParts(date);
  if (weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= (9 * 60 + 30) && mins <= (17 * 60 + 30);
}
