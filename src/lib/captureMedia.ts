export async function capturePhotoFromVideo(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture photo.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
  if (!blob) throw new Error('Could not capture photo.');

  return new File([blob], `photo-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
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
  const isChromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent);
  const webmCandidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  const mp4Candidates = ['video/mp4'];

  // Chromium MP4 MediaRecorder output is often not playable from a remote URL (fMP4 metadata).
  const candidates = isChromium
    ? webmCandidates
    : [...mp4Candidates, ...webmCandidates];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
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

export async function assertValidVideoContainer(blob: Blob): Promise<void> {
  const buf = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  const isMp4 = buf.length >= 8
    && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
  if (!isWebm && !isMp4) {
    throw new Error('Could not prepare video for upload. Please record again.');
  }
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
