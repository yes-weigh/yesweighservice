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

/** Resize and re-encode photos before upload — keeps aspect ratio, no cropping. */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const { maxWidth, maxHeight, quality, maxBytes } = { ...DEFAULTS, ...options };

  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  if (file.size <= maxBytes && file.type === 'image/jpeg') {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
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

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let q = quality;
  let blob = await canvasToJpegBlob(canvas, q);
  while (blob.size > maxBytes && q > 0.52) {
    q -= 0.08;
    blob = await canvasToJpegBlob(canvas, q);
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${baseName}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}
