function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDdMmYyyy(date: Date): string {
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function formatTimeAmPm(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const h12 = hours % 12 || 12;
  const ampm = hours < 12 ? 'am' : 'pm';
  return `${h12}:${pad2(minutes)} ${ampm}`;
}

/**
 * Logistics UI timestamps: dd-mm-yyyy h:mm am/pm (local timezone).
 * Date-only YYYY-MM-DD values render as dd-mm-yyyy without inventing a clock time.
 */
export function formatLogisticsDateTime(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${pad2(day)}-${pad2(month)}-${year}`;
    }
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return trimmed;

  const date = new Date(ms);
  return `${formatDdMmYyyy(date)} ${formatTimeAmPm(date)}`;
}

/** Non-null display helper — falls back to em dash. */
export function formatLogisticsDateTimeLabel(value: string | null | undefined): string {
  return formatLogisticsDateTime(value) ?? '—';
}
