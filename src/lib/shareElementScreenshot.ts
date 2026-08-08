import { Capacitor } from '@capacitor/core';
import { toJpeg, toPng } from 'html-to-image';
import { WhatsAppShare } from 'whatsapp-share';
import { openWhatsAppWithText, uploadWhatsAppShareCard } from './whatsappShareCard';

export type ScreenshotFormat = 'png' | 'jpeg';

export type CaptureElementOptions = {
  backgroundColor?: string;
  fileName?: string;
  format?: ScreenshotFormat;
  /** JPEG quality 0–1 (default 0.92). Ignored for PNG. */
  quality?: number;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode image.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not encode image.'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(header)?.[1] || 'image/png';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function settleFrames(): Promise<void> {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

/** 1×1 transparent GIF — used when a remote image cannot be inlined. */
const IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export type PreparedScreenshot = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  /** Pre-encoded for native share so the tap path skips FileReader. */
  dataBase64?: string;
};

/**
 * Rasterize a full element (including overflow / scrolled content) to an image blob.
 */
export async function captureElementScreenshot(
  el: HTMLElement,
  options?: CaptureElementOptions,
): Promise<PreparedScreenshot> {
  const backgroundColor = options?.backgroundColor ?? '#13151b';
  const format: ScreenshotFormat = options?.format ?? 'png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const fileName = options?.fileName ?? `screenshot-${Date.now()}.${ext}`;
  const rasterize = format === 'jpeg' ? toJpeg : toPng;
  const quality = options?.quality ?? 0.92;

  el.classList.add('is-capturing');
  await settleFrames();
  if (document.fonts?.ready) await document.fonts.ready;

  try {
    const rect = el.getBoundingClientRect();
    const width = Math.ceil(Math.max(el.scrollWidth, rect.width, 1));
    const height = Math.ceil(Math.max(el.scrollHeight, rect.height, 1));
    // Start at 2× — sharper than 1×, much faster / safer than 3× on long SOs.
    const tryRatios = [2, 1.5];
    let dataUrl = '';
    let lastError: unknown;

    for (const pixelRatio of tryRatios) {
      try {
        dataUrl = await rasterize(el, {
          // Signed GCS URLs break if we append a cache-bust query param.
          cacheBust: false,
          // Keep signature query params on Firebase Storage URLs.
          includeQueryParams: true,
          // Cross-origin Google Fonts stylesheets throw SecurityError on cssRules.
          skipFonts: true,
          imagePlaceholder: IMAGE_PLACEHOLDER,
          onImageErrorHandler: () => undefined,
          pixelRatio,
          width,
          height,
          canvasWidth: Math.round(width * pixelRatio),
          canvasHeight: Math.round(height * pixelRatio),
          backgroundColor,
          ...(format === 'jpeg' ? { quality } : {}),
          style: {
            transform: 'none',
            width: `${width}px`,
            height: 'auto',
            maxWidth: 'none',
            margin: '0',
            boxSizing: 'border-box',
            overflow: 'visible',
          },
          filter: node => !(
            node instanceof HTMLElement
            && node.dataset.captureIgnore === '1'
          ),
        });
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!dataUrl) throw lastError ?? new Error('Could not capture screenshot.');
    return {
      blob: dataUrlToBlob(dataUrl),
      fileName,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    };
  } finally {
    el.classList.remove('is-capturing');
  }
}

/** Capture an element and trigger a file download. */
export async function downloadElementScreenshot(
  el: HTMLElement,
  options?: CaptureElementOptions,
): Promise<void> {
  const shot = await captureElementScreenshot(el, options);
  downloadBlob(shot.blob, shot.fileName);
}

/** Capture + optionally pre-encode base64 for native share (background warm path). */
export async function prepareElementScreenshot(
  el: HTMLElement,
  options?: CaptureElementOptions,
): Promise<PreparedScreenshot> {
  const shot = await captureElementScreenshot(el, options);
  if (!Capacitor.isNativePlatform()) return shot;
  return {
    ...shot,
    dataBase64: await blobToBase64(shot.blob),
  };
}

/** Share a PNG screenshot via native share sheet / Web Share / WhatsApp fallback. */
export async function shareScreenshotBlob(
  blob: Blob,
  options: {
    fileName: string;
    title: string;
    text?: string;
    dataBase64?: string;
  },
): Promise<void> {
  const fileName = options.fileName;
  const title = options.title;
  const text = String(options.text ?? title).trim() || title;
  const mimeType = blob.type || 'image/png';

  if (Capacitor.isNativePlatform()) {
    const dataBase64 = options.dataBase64 || await blobToBase64(blob);
    await WhatsAppShare.shareImage({
      dataBase64,
      fileName,
      mimeType,
    });
    return;
  }

  const file = new File([blob], fileName, { type: mimeType });
  const shareData: ShareData = {
    files: [file],
    title,
    text,
  };

  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  try {
    const imageUrl = await uploadWhatsAppShareCard(blob, fileName);
    openWhatsAppWithText([text, imageUrl].filter(Boolean).join('\n'));
    return;
  } catch {
    // fall through
  }

  downloadBlob(blob, fileName);
}

export async function captureAndShareElement(
  el: HTMLElement,
  options: {
    fileName: string;
    title: string;
    text?: string;
    backgroundColor?: string;
  },
): Promise<void> {
  const shot = await prepareElementScreenshot(el, {
    backgroundColor: options.backgroundColor,
    fileName: options.fileName,
  });
  await shareScreenshotBlob(shot.blob, {
    fileName: shot.fileName,
    title: options.title,
    text: options.text,
    dataBase64: shot.dataBase64,
  });
}
