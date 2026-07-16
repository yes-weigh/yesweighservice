export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxBytes?: number;
}

const DEFAULTS: Required<CompressImageOptions> = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
  maxBytes: 900_000,
};

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not compress image.'))),
      'image/jpeg',
      quality,
    );
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not compress image.'))),
      'image/png',
    );
  });
}

/** Resize and re-encode photos before upload — keeps aspect ratio, no cropping. */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const { maxWidth, maxHeight, quality, maxBytes } = { ...DEFAULTS, ...options };

  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const needsResize = scale < 1;
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';

  if (file.type === 'image/png' && !needsResize && file.size <= maxBytes) {
    bitmap.close?.();
    return file;
  }

  if (file.type === 'image/jpeg' && !needsResize && file.size <= maxBytes) {
    bitmap.close?.();
    return file;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Could not process image.');
  }

  if (file.type !== 'image/png') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  if (file.type === 'image/png') {
    const blob = await canvasToPngBlob(canvas);
    return new File([blob], `${baseName}.png`, {
      type: 'image/png',
      lastModified: Date.now(),
    });
  }

  let q = quality;
  let blob = await canvasToJpegBlob(canvas, q);
  while (blob.size > maxBytes && q > 0.52) {
    q -= 0.08;
    blob = await canvasToJpegBlob(canvas, q);
  }

  return new File([blob], `${baseName}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}
