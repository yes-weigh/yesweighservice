function drawVideoFrameToCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture photo.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Instant preview URL plus async file from the same frozen frame. */
export function freezeVideoFrame(video: HTMLVideoElement): { dataUrl: string; toFile: () => Promise<File> } {
  const canvas = drawVideoFrameToCanvas(video);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return {
    dataUrl,
    toFile: async () => {
      const blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.92);
      });
      if (!blob) throw new Error('Could not capture photo.');
      return new File([blob], `photo-${Date.now()}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    },
  };
}

export async function capturePhotoFromVideo(video: HTMLVideoElement): Promise<File> {
  return freezeVideoFrame(video).toFile();
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop());
}

export function pickAudioMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return 'audio/webm';
  }
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    return 'audio/ogg;codecs=opus';
  }
  return '';
}

export function pickVideoMimeType(): string {
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isChromium = /Chrome|Chromium|Edg\//.test(ua);
  const mp4Candidates = [
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
  ];
  const webmCandidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];

  // Android Chrome WebM from MediaRecorder is often cluster-only (no EBML) and won't play remotely.
  if (isAndroid && isChromium) {
    for (const type of mp4Candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    for (const type of webmCandidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  // Desktop Chromium WebM is more reliable than fragmented MP4 for remote playback.
  const candidates = isChromium
    ? webmCandidates
    : [...mp4Candidates, ...webmCandidates];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function recommendedRecorderTimeslice(mimeType: string): number | undefined {
  if (!/Android/i.test(navigator.userAgent)) return undefined;
  if (mimeType.toLowerCase().includes('webm')) return 1000;
  return undefined;
}

export function createVideoMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = pickVideoMimeType();
  if (!mimeType) {
    throw new Error('Video recording is not supported on this device.');
  }

  return new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
}

export function createVideoFileFromBlob(blob: Blob, mimeType: string): File {
  const type = blob.type || mimeType || 'video/webm';
  return new File(
    [blob],
    `video-${Date.now()}.${videoFileExtension(type)}`,
    { type, lastModified: Date.now() },
  );
}

export async function stopMediaRecorder(recorder: MediaRecorder): Promise<void> {
  if (recorder.state !== 'recording') return;

  await new Promise<void>((resolve, reject) => {
    recorder.addEventListener('stop', () => resolve(), { once: true });
    recorder.addEventListener('error', () => reject(new Error('Recording failed.')), { once: true });
    try {
      recorder.requestData();
    } catch {
      // ignore — not all browsers need an explicit flush
    }
    recorder.stop();
  });
}

export function buildRecordingBlob(chunks: Blob[], mimeType: string): Blob {
  const parts = chunks.filter(chunk => chunk.size > 0);
  if (parts.length === 0) {
    throw new Error('Recording was empty.');
  }

  const type = mimeType || parts[0]?.type || 'video/webm';
  const blob = new Blob(parts, { type });
  if (blob.size < 200) {
    throw new Error('Recording was too short. Hold record for at least one second.');
  }
  return blob;
}

export function hasValidVideoContainerHeader(bytes: Uint8Array): boolean {
  if (bytes.length >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return true;
  }

  const limit = Math.min(bytes.length - 4, 512);
  for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] === 0x66 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x79 && bytes[i + 3] === 0x70) {
      return true;
    }
  }
  return false;
}

export async function assertValidVideoContainer(blob: Blob): Promise<void> {
  const buf = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  if (!hasValidVideoContainerHeader(buf)) {
    throw new Error('Could not prepare video for upload. Please record again.');
  }
}

export async function prepareVideoFileForUpload(
  file: File,
  recordedDurationMs?: number,
): Promise<File> {
  let blob: Blob = file;
  const header = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const hasWebmHeader = header.length >= 4
    && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;

  if (hasWebmHeader && blob.type.includes('webm') && recordedDurationMs && recordedDurationMs > 0) {
    const { default: fixWebmDuration } = await import('fix-webm-duration');
    blob = await fixWebmDuration(blob, recordedDurationMs, { logger: false });
  }

  await assertValidVideoContainer(blob);

  if (blob === file) return file;
  return new File([blob], file.name, { type: file.type, lastModified: Date.now() });
}

export async function finalizeMediaRecorder(
  recorder: MediaRecorder,
  existingChunks: Blob[] = [],
): Promise<Blob> {
  await stopMediaRecorder(recorder);
  const blob = buildRecordingBlob(existingChunks, recorder.mimeType);
  await assertValidVideoContainer(blob);
  return blob;
}

export async function validateVideoBlob(blob: Blob): Promise<boolean> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 8000);
      video.addEventListener('loadedmetadata', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
      video.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('invalid'));
      }, { once: true });
    });

    return video.duration > 0 && Number.isFinite(video.duration);
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function videoFileExtension(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime')) return 'mov';
  return 'webm';
}

export async function captureVideoPoster(file: File, timeoutMs = 12_000): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const onLoaded = () => resolve();
        const onError = () => reject(new Error('Could not read video.'));
        video.addEventListener('loadeddata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
      }),
      new Promise<void>((_, reject) => {
        window.setTimeout(() => reject(new Error('Poster capture timed out.')), timeoutMs);
      }),
    ]);

    if (video.duration > 0.12 && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(0.12, video.duration * 0.05);
      await new Promise<void>(resolve => {
        video.addEventListener('seeked', () => resolve(), { once: true });
      });
    }

    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
