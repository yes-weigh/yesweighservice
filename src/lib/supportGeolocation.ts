export interface GpsCoords {
  latitude: number;
  longitude: number;
}

export async function getCurrentGpsCoords(): Promise<GpsCoords | null> {
  if (!navigator.geolocation) return null;

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

export function formatGpsLabel(coords: GpsCoords | null, capturedAt = new Date()): string {
  const time = capturedAt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (!coords) {
    return `GPS unavailable · ${time}`;
  }

  const lat = `${Math.abs(coords.latitude).toFixed(5)}°${coords.latitude >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(coords.longitude).toFixed(5)}°${coords.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lng} · ${time}`;
}

export async function applyGpsOverlayToImage(
  file: File,
  label: string,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Could not process image.');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const fontSize = Math.max(14, Math.round(canvas.width * 0.028));
  const padding = Math.round(fontSize * 0.65);
  const lineHeight = Math.round(fontSize * 1.35);
  const lines = wrapOverlayText(label, Math.floor((canvas.width - padding * 2) / (fontSize * 0.55)));
  const barHeight = padding * 2 + lineHeight * lines.length;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, padding, canvas.height - barHeight + padding + index * lineHeight);
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => (result ? resolve(result) : reject(new Error('Could not save image.'))),
      'image/jpeg',
      0.9,
    );
  });

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'evidence';
  return new File([blob], `${baseName}-gps.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function wrapOverlayText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}
