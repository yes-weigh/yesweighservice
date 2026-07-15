/** Burn GPS + capture time onto logistics package photos. */

export interface LogisticsGeoFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  at: number;
}

const GEO_CACHE_TTL_MS = 2 * 60 * 1000;
const GEO_TIMEOUT_MS = 4_000;

let cachedFix: LogisticsGeoFix | null = null;
let inflightFix: Promise<LogisticsGeoFix | null> | null = null;

function formatCaptureTime(date = new Date()): string {
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatCoords(fix: LogisticsGeoFix): string {
  const latHem = fix.latitude >= 0 ? 'N' : 'S';
  const lngHem = fix.longitude >= 0 ? 'E' : 'W';
  const lat = Math.abs(fix.latitude).toFixed(6);
  const lng = Math.abs(fix.longitude).toFixed(6);
  const accuracy = fix.accuracyM != null && Number.isFinite(fix.accuracyM)
    ? ` ±${Math.round(fix.accuracyM)}m`
    : '';
  return `${lat}° ${latHem}, ${lng}° ${lngHem}${accuracy}`;
}

async function readGeolocation(timeoutMs: number): Promise<LogisticsGeoFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  return new Promise(resolve => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      position => {
        window.clearTimeout(timer);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          at: Date.now(),
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: GEO_CACHE_TTL_MS,
      },
    );
  });
}

/** Warm GPS so the first photo stamp is faster. */
export function prefetchLogisticsGeoFix(): void {
  void getLogisticsGeoFix().catch(() => undefined);
}

export async function getLogisticsGeoFix(options?: {
  timeoutMs?: number;
  force?: boolean;
}): Promise<LogisticsGeoFix | null> {
  const timeoutMs = options?.timeoutMs ?? GEO_TIMEOUT_MS;
  if (!options?.force && cachedFix && Date.now() - cachedFix.at < GEO_CACHE_TTL_MS) {
    return cachedFix;
  }
  if (inflightFix) return inflightFix;

  inflightFix = (async () => {
    const fix = await readGeolocation(timeoutMs);
    if (fix) cachedFix = fix;
    return fix;
  })();

  try {
    return await inflightFix;
  } finally {
    inflightFix = null;
  }
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Draw a bottom proof bar (local time + GPS) onto the captured image.
 * Runs off the main capture UI — caller awaits and stores the stamped data URL.
 */
export async function stampLogisticsPhotoDataUrl(
  file: File,
  options?: { capturedAt?: Date },
): Promise<string> {
  const capturedAt = options?.capturedAt ?? new Date();
  const [bitmap, geo] = await Promise.all([
    createImageBitmap(file),
    getLogisticsGeoFix(),
  ]);

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not stamp photo.');

    ctx.drawImage(bitmap, 0, 0, width, height);

    const line1 = formatCaptureTime(capturedAt);
    const line2 = geo ? formatCoords(geo) : 'GPS unavailable';
    const padX = Math.max(12, Math.round(width * 0.025));
    const padY = Math.max(10, Math.round(height * 0.018));
    const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.028));
    const lineGap = Math.round(fontSize * 0.35);
    const barHeight = padY * 2 + fontSize * 2 + lineGap;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.fillRect(0, height - barHeight, width, barHeight);

    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillText(line1, padX, height - barHeight + padY, width - padX * 2);

    ctx.font = `500 ${Math.round(fontSize * 0.92)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(
      line2,
      padX,
      height - barHeight + padY + fontSize + lineGap,
      width - padX * 2,
    );

    return canvasToJpegDataUrl(canvas, 0.88);
  } finally {
    bitmap.close?.();
  }
}
