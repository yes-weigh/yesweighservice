const IST = 'Asia/Kolkata';

/** Mon–Sat 09:00–18:00 IST (last run at 18:00, not 18:30). */
export function isCatalogSyncWindow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? -1);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? -1);

  if (weekday === 'Sun') return false;
  if (hour < 9 || hour > 18) return false;
  if (hour === 18 && minute > 0) return false;
  return true;
}
