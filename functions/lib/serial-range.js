/**
 * Shared serial range parse/preview (mirrors src/lib/serialNumberAllotment.ts).
 */

function padNumeric(n, width) {
  const raw = String(n);
  return width > raw.length ? raw.padStart(width, '0') : raw;
}

export function parseSerialToken(raw) {
  const token = String(raw ?? '').trim();
  if (!token) return null;
  const match = /^(.*?)(\d+)$/.exec(token);
  if (!match) return null;
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return {
    prefix: match[1],
    n,
    width: match[2].length,
  };
}

function formatSerial(parsed, n) {
  return `${parsed.prefix}${padNumeric(n, parsed.width)}`;
}

export function compactSerialKey(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function previewSerialRange({ from, to, missingText = '' } = {}) {
  const fromRaw = String(from ?? '').trim();
  const toRaw = String(to ?? '').trim();
  const empty = {
    from: fromRaw,
    to: toRaw,
    missing: [],
    rangeSize: 0,
    missingCount: 0,
    count: 0,
    ignoredMissing: [],
    error: null,
  };

  if (!fromRaw && !toRaw && !String(missingText ?? '').trim()) return empty;
  if (!fromRaw || !toRaw) {
    return { ...empty, error: 'Enter both start and end serial numbers.' };
  }

  const start = parseSerialToken(fromRaw);
  const end = parseSerialToken(toRaw);
  if (!start || !end) {
    return { ...empty, error: 'Start and end must end in a number (e.g. YZ01420).' };
  }
  if (start.prefix !== end.prefix) {
    return { ...empty, error: 'Start and end must share the same prefix.' };
  }
  if (start.n > end.n) {
    return { ...empty, error: 'Start must be less than or equal to end.' };
  }

  const rangeSize = end.n - start.n + 1;
  if (rangeSize > 1_000_000) {
    return { ...empty, error: 'Range is too large. Split it into smaller allotments.' };
  }

  const width = Math.max(start.width, end.width);
  const canonical = { ...start, width };

  return {
    from: formatSerial(canonical, start.n),
    to: formatSerial(canonical, end.n),
    missing: [],
    rangeSize,
    missingCount: 0,
    count: rangeSize,
    ignoredMissing: [],
    error: null,
  };
}
